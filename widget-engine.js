import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GdkPixbuf from 'gi://GdkPixbuf';
import Shell from 'gi://Shell';
import UPowerGlib from 'gi://UPowerGlib?version=1.0';
import { GrabHelper } from 'resource:///org/gnome/shell/ui/grabHelper.js';
import { WidgetSandbox } from './sandbox.js';
import { WidgetNetwork, cacheDirFor } from './network.js';
import { WidgetMedia } from './media.js';
import { createRichText } from './rich-text.js';
import { createUi } from './ui-kit.js';

// ---------------------------------------------------------------------------
// Shared 1-second system poller — single GLib timer for all widget instances.
// ---------------------------------------------------------------------------
const _systemPoller = {
  _subscribers: new Set(),
  _timerId: 0,
  _cpuStats: { idle: 0, total: 0 },
  _upClient: null,
  _cache: { cpu: null, memory: null, battery: null },

  subscribe(instance) {
    this._subscribers.add(instance);
    if (this._timerId === 0) this._start();
  },

  unsubscribe(instance) {
    this._subscribers.delete(instance);
    if (this._subscribers.size === 0) this._stop();
  },

  _start() {
    this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      this._poll();
      this._notify();
      return this._subscribers.size > 0 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
    });
  },

  _stop() {
    if (this._timerId) {
      GLib.source_remove(this._timerId);
      this._timerId = 0;
    }
    this._upClient = null;
  },

  _poll() {
    this._cache.cpu = this._getCpuUsage();
    this._cache.memory = this._getMemoryInfo();
    this._cache.battery = this._getBatteryInfo();
  },

  _notify() {
    for (const inst of this._subscribers) {
      try {
        inst._onSystemPoll(this._cache);
      } catch (e) {
        log(`DesktopWidgets system poller notify failed for ${inst.manifest.id}: ${e}`);
      }
    }
  },

  _readProcStat() {
    try {
      const [ok, contents] = GLib.file_get_contents('/proc/stat');
      if (!ok) return null;
      const lines = new TextDecoder().decode(contents).split('\n');
      const cpu = lines[0].split(/\s+/).slice(1).map(Number);
      return { idle: cpu[3], total: cpu.reduce((a, b) => a + b, 0) };
    } catch { return null; }
  },

  _getCpuUsage() {
    const stat = this._readProcStat();
    if (!stat) return null;
    const prev = this._cpuStats;
    if (!prev.total) { this._cpuStats = stat; return 0; }
    const idleDelta = stat.idle - prev.idle;
    const totalDelta = stat.total - prev.total;
    this._cpuStats = stat;
    if (totalDelta <= 0) return 0;
    return Math.max(0, Math.min(100, (100 * (totalDelta - idleDelta)) / totalDelta));
  },

  _getMemoryInfo() {
    try {
      const [ok, contents] = GLib.file_get_contents('/proc/meminfo');
      if (!ok) return null;
      const data = {};
      for (const line of new TextDecoder().decode(contents).split('\n')) {
        const parts = line.split(':');
        if (parts.length < 2) continue;
        data[parts[0].trim()] = Number(parts[1].trim().split(' ')[0]);
      }
      const total = data.MemTotal || 0;
      const free = (data.MemFree || 0) + (data.Buffers || 0) + (data.Cached || 0);
      const used = total - free;
      return { total, free, used, usedPercent: total ? (used / total) * 100 : 0 };
    } catch { return null; }
  },

  _getBatteryInfo() {
    try {
      if (!this._upClient) this._upClient = UPowerGlib.Client.new();
      const battery = this._upClient.get_devices()
        .find((d) => d.kind === UPowerGlib.DeviceKind.BATTERY);
      if (!battery) return null;
      return {
        percentage: battery.percentage,
        state: battery.state,
        timeToEmpty: battery.time_to_empty,
        timeToFull: battery.time_to_full,
      };
    } catch { return null; }
  },
};

// ---------------------------------------------------------------------------
// Per-widget state persistence
// ---------------------------------------------------------------------------
function _statePathFor(widgetId) {
  return `${GLib.get_user_data_dir()}/gnome-desktop-widgets/widgets/${widgetId}/state.json`;
}

function _loadState(widgetId) {
  try {
    const file = Gio.File.new_for_path(_statePathFor(widgetId));
    if (!file.query_exists(null)) return {};
    const [ok, contents] = file.load_contents(null);
    if (!ok) return {};
    return JSON.parse(new TextDecoder().decode(contents));
  } catch { return {}; }
}

export function saveWidgetState(widgetId, state) {
  _saveState(widgetId, state);
}

function _saveState(widgetId, state) {
  try {
    const path = _statePathFor(widgetId);
    const dir = Gio.File.new_for_path(GLib.path_get_dirname(path));
    if (!dir.query_exists(null)) dir.make_directory_with_parents(null);
    const file = Gio.File.new_for_path(path);
    file.replace_contents(JSON.stringify(state, null, 2), null, false, Gio.FileCreateFlags.NONE, null);
  } catch (e) {
    log(`DesktopWidgets: failed to save state for ${widgetId}: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Sandboxed filesystem helpers
// ---------------------------------------------------------------------------
function _widgetDataDir(widgetId) {
  return `${GLib.get_user_data_dir()}/gnome-desktop-widgets/widgets/${widgetId}/data`;
}

// ---------------------------------------------------------------------------
// WidgetInstance — one per enabled widget
// ---------------------------------------------------------------------------
export class WidgetInstance {
  constructor(manifest) {
    this.manifest = manifest;
    this.enabled = false;
    this.actor = null;
    this._sandbox = null;
    this._fileMonitor = null;
    this._timers = {};
    this._nextTimerId = 1;
    this._lastSystemData = { cpu: null, memory: null, battery: null };
    this._persistedState = _loadState(manifest.id);
    this._ctx = null;
    this._api = null;
    this._network = null;
    this._media = null;
    this._menuItems = null;
    this._resizeSourceId = 0;
    this.onActorReady = null;
    this._reloadSourceId = 0;
    this._grabHelper = null;
    this._dragRegions = new WeakSet();
    // Filled in by the extension: { create, remove, count }
    this._actions = {};
  }

  // ── Build the rendering context (ctx) ──────────────────────────────
  _buildCtx(box) {
    return {
      St,
      Clutter,
      Gio,
      GLib,
      Pango,
      GdkPixbuf,

      box,

      setStyle: (css) => box.set_style(css),
      addClass: (name) => box.add_style_class_name(name),
      removeClass: (name) => box.remove_style_class_name(name),
      // Moving a widget needs the drag key (see Preferences), unless the press
      // lands in a drag region. Mark a label, header or ctx.box (the whole
      // background) to let it move the widget with a plain click-and-drag.
      // Buttons and text entries inside a region keep handling their own clicks.
      setDragRegion: (actor, enabled = true) => {
        if (enabled) {
          actor.reactive = true;
          this._dragRegions.add(actor);
        } else {
          this._dragRegions.delete(actor);
        }
      },
      // Text with inline images (e.g. "{G}" as a symbol); see README
      createRichText: (text, options) => createRichText(text, options),

      // Design tokens plus rings, bars, graphs and free drawing; see README
      ui: createUi(),

      // Absolute path of a file in the widget's assets/ folder (null if the
      // name tries to leave it)
      assetPath: (name) => {
        const rel = String(name);
        if (rel.startsWith('/') || rel.split('/').includes('..') || !this.manifest.installedPath)
          return null;
        return `${this.manifest.installedPath}/assets/${rel}`;
      },
      setSize: (w, h) => {
        box.set_size(w, h);
        if (this._layoutCallback) {
          this._layoutCallback(this.manifest.id, {
            ...this._getCurrentLayout(),
            width: w,
            height: h,
          });
        }
      },
    };
  }

  // ── Build the widget API (api) ─────────────────────────────────────
  _buildApi() {
    const permissions = new Set(this.manifest.permissions || []);
    const trusted = !!this.manifest.trusted;

    const api = {
      // --- System data (always available) ---
      system: {
        cpu: () => this._lastSystemData.cpu,
        memory: () => this._lastSystemData.memory,
        battery: () => this._lastSystemData.battery,
      },

      // --- Keyboard input ---
      // Widgets live below the windows, so a text entry only receives keys
      // while the widget holds a modal grab. grab(entry) focuses the entry;
      // the grab ends on Escape, a click outside the widget, or release().
      input: {
        grab: (focusActor, onRelease) => {
          if (!this.actor) return false;
          if (!this._grabHelper) {
            this._grabHelper = new GrabHelper(this.actor,
              { actionMode: Shell.ActionMode.NORMAL });
          }
          return this._grabHelper.grab({
            actor: this.actor,
            focus: focusActor,
            onUngrab: (byUser) => {
              // The modal stack restores the previous key focus after this
              // callback; drop focus afterwards so a stale entry focus
              // can't swallow the next click.
              GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                const focus = global.stage.key_focus;
                if (this.actor && focus && this.actor.contains(focus))
                  global.stage.set_key_focus(null);
                return GLib.SOURCE_REMOVE;
              });
              if (!onRelease) return;
              try { onRelease(byUser); } catch (e) {
                log(`DesktopWidgets input release handler failed: ${e}`);
              }
            },
          });
        },
        release: () => {
          if (this._grabHelper?.grabbed)
            this._grabHelper.ungrab({ actor: this.actor });
        },
      },

      // --- Timers ---
      timer: {
        register: (fn, intervalMs) => {
          const id = this._nextTimerId++;
          const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            try { fn(); } catch (e) {
              log(`DesktopWidgets timer callback failed: ${e}`);
              return GLib.SOURCE_REMOVE;
            }
            return this.enabled ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
          });
          this._timers[id] = sourceId;
          return id;
        },
        clear: (id) => {
          if (this._timers[id]) {
            GLib.source_remove(this._timers[id]);
            delete this._timers[id];
          }
        },
      },

      // --- State persistence ---
      state: {
        get: (key) => this._persistedState[key],
        set: (key, value) => {
          this._persistedState[key] = value;
          _saveState(this.manifest.id, this._persistedState);
        },
      },

      // --- Widget self-control ---
      widget: {
        setPosition: (x, y) => {
          if (this.actor) this.actor.set_position(x, y);
          if (this._layoutCallback) {
            this._layoutCallback(this.manifest.id, {
              ...this._getCurrentLayout(),
              x, y,
            });
          }
        },
        setSize: (w, h) => {
          if (this.actor) this.actor.set_size(w, h);
          if (this._layoutCallback) {
            this._layoutCallback(this.manifest.id, {
              ...this._getCurrentLayout(),
              width: w, height: h,
            });
          }
        },
        getLayout: () => this._getCurrentLayout(),
        log: (msg) => log(`DesktopWidgets [${this.manifest.id}]: ${msg}`),
        notify: (title, body) => {
          log(`DesktopWidgets [${this.manifest.id} notification] ${title}: ${body || ''}`);
        },
      },

      // --- Multiple instances of this widget (e.g. sticky notes) ---
      instances: {
        // Add another copy of this widget. `initialState` (a plain object) is
        // what the copy's api.state starts with; leave it out for a blank one.
        create: (initialState) => this._actions.create?.(this.manifest.id, initialState),
        // Delete this instance; refused (false) when it is the last one
        remove: () => this._actions.remove?.(this.manifest.id) ?? false,
        // How many instances of this widget are currently on the desktop
        count: () => this._actions.count?.(this.manifest.id) ?? 1,
      },

      // --- Right-click menu ---
      // menu.set(items) or menu.set(() => items): the function form is called
      // on every right click, so labels and check marks can follow the state.
      menu: {
        set: (items) => { this._menuItems = items; },
      },

      // --- Now playing (permission-gated) ---
      media: this._buildMediaApi(permissions, trusted),

      // --- Network (permission-gated) ---
      network: this._buildNetworkApi(permissions, trusted),

      // --- Filesystem (permission-gated) ---
      fs: this._buildFsApi(permissions, trusted),
    };

    return api;
  }

  _buildMediaApi(permissions, trusted) {
    if (!(trusted || permissions.has('media'))) {
      const blocked = () => { throw new Error('Media access requires "media" permission'); };
      return { get: blocked, playPause: blocked, next: blocked, previous: blocked, raise: blocked };
    }
    this._media = new WidgetMedia();
    return this._media.api();
  }

  _buildNetworkApi(permissions, trusted) {
    const allowed = trusted || permissions.has('network');
    const blocked = () => { throw new Error('Network access requires "network" permission'); };

    if (!allowed) {
      return {
        fetch: blocked, fetchJSON: blocked,
        fetchAsync: blocked, fetchJSONAsync: blocked, download: blocked,
      };
    }

    this._network = new WidgetNetwork(this.manifest.id, cacheDirFor(this.manifest.cloneOf || this.manifest.id));
    return this._network.api();
  }

  _buildFsApi(permissions, trusted) {
    const allowed = trusted || permissions.has('filesystem');
    const blocked = () => { throw new Error('Filesystem access requires "filesystem" permission'); };

    if (!allowed) {
      return { readFile: blocked, writeFile: blocked, exists: blocked };
    }

    const dataDir = _widgetDataDir(this.manifest.id);

    return {
      readFile: (relativePath) => {
        try {
          const fullPath = GLib.build_filenamev([dataDir, relativePath]);
          const file = Gio.File.new_for_path(fullPath);
          if (!file.query_exists(null)) return null;
          const [ok, contents] = file.load_contents(null);
          if (!ok) return null;
          return new TextDecoder().decode(contents);
        } catch (e) {
          log(`DesktopWidgets fs.readFile failed: ${e}`);
          return null;
        }
      },
      writeFile: (relativePath, content) => {
        try {
          const fullPath = GLib.build_filenamev([dataDir, relativePath]);
          const dir = Gio.File.new_for_path(GLib.path_get_dirname(fullPath));
          if (!dir.query_exists(null)) dir.make_directory_with_parents(null);
          const file = Gio.File.new_for_path(fullPath);
          file.replace_contents(content, null, false, Gio.FileCreateFlags.NONE, null);
        } catch (e) {
          log(`DesktopWidgets fs.writeFile failed: ${e}`);
        }
      },
      exists: (relativePath) => {
        try {
          const fullPath = GLib.build_filenamev([dataDir, relativePath]);
          return Gio.File.new_for_path(fullPath).query_exists(null);
        } catch { return false; }
      },
    };
  }

  _getCurrentLayout() {
    if (!this.actor) return { x: 0, y: 0, width: 200, height: 80 };
    const pos = this.actor.get_position();
    return {
      x: pos[0], y: pos[1],
      width: this.actor.get_width(),
      height: this.actor.get_height(),
    };
  }

  // ── Actor creation ─────────────────────────────────────────────────
  createActor() {
    const box = new St.BoxLayout({
      style_class: 'desktop-widget-box',
      reactive: true,
      vertical: true,
      clip_to_allocation: true,
    });

    // Base look: widgets that want something else call ctx.setStyle()
    const css = ['border-radius: 10px', 'padding: 8px 12px'];
    if (this.manifest.bg_color) css.push(`background-color: ${this.manifest.bg_color}`);
    if (this.manifest.text_color) css.push(`color: ${this.manifest.text_color}`);
    box.set_style(`${css.join('; ')};`);

    // Build ctx and api
    this._menuItems = null;
    this._ctx = this._buildCtx(box);
    this._api = this._buildApi();

    // Setup sandbox with ctx and api
    this._sandbox = new WidgetSandbox(this.manifest, this._api, this._ctx);

    // Load and execute widget script
    this._loadScript();

    this.actor = box;

    // onResize(ctx, api, width, height): whenever the widget's size changes
    // (the user resizing it, a layout being applied, setSize). Coalesced into
    // one call per frame so a drag does not flood the script.
    const notifyResize = () => {
      if (this._resizeSourceId) return;
      this._resizeSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        this._resizeSourceId = 0;
        if (this.actor === box && this._sandbox)
          this._sandbox.callOnResize(box.get_width(), box.get_height());
        return GLib.SOURCE_REMOVE;
      });
    };
    box.connect('notify::width', notifyResize);
    box.connect('notify::height', notifyResize);

    // "drag_region": "background" — the whole widget moves with a plain drag
    if (this.manifest.drag_region === 'background') this._ctx.setDragRegion(box);

    // Call render(ctx, api) — the widget populates the box
    if (this._sandbox) this._sandbox.callRender();
    else if (!this.manifest.script) this._renderStatic(box);

    // Let the owner position and parent the actor (also after reload())
    if (this.onActorReady) this.onActorReady(box);
    notifyResize();

    return box;
  }

  // Script-less widgets: show the manifest's "text" or "image" as-is
  _renderStatic(box) {
    const { text, image, type } = this.manifest;
    try {
      if (type === 'image' && image) {
        const size = Math.max(16, Math.min(
          (this.manifest.width || 200) - 24, (this.manifest.height || 200) - 16));
        box.add_child(new St.Icon({
          gicon: new Gio.FileIcon({ file: Gio.File.new_for_uri(image) }),
          icon_size: size,
        }));
      } else if (text) {
        const label = new St.Label({ text, x_expand: true });
        label.clutter_text.set_line_wrap(true);
        box.add_child(label);
      }
    } catch (e) {
      log(`DesktopWidgets: cannot render static widget ${this.manifest.id}: ${e}`);
    }
  }

  // The items for a right click, as set through api.menu.set()
  getContextMenu() {
    try {
      const items = typeof this._menuItems === 'function' ? this._menuItems() : this._menuItems;
      return Array.isArray(items) ? items : [];
    } catch (e) {
      log(`DesktopWidgets [${this.manifest.id}] context menu failed: ${e}`);
      return [];
    }
  }

  isDragRegion(actor) {
    return this._dragRegions.has(actor);
  }

  // Invoked by the layout manager for a press-release that was not a drag.
  click() {
    if (this._sandbox) this._sandbox.callOnClick();
  }

  _loadScript() {
    if (!this.manifest.script || !this.manifest.installedPath || !this._sandbox) return;

    try {
      const scriptPath = `${this.manifest.installedPath}/${this.manifest.script}`;
      const file = Gio.File.new_for_path(scriptPath);
      if (!file.query_exists(null)) return;
      const [success, contents] = file.load_contents(null);
      if (!success) return;
      const source = new TextDecoder().decode(contents);
      this._sandbox.loadScript(source);
    } catch (e) {
      log(`DesktopWidgets could not load widget script: ${e}`);
      this._sandbox = null;
    }
  }

  _setupFileMonitor() {
    if (this._fileMonitor || !this.manifest.installedPath) return;

    try {
      const dir = Gio.File.new_for_path(this.manifest.installedPath);
      this._fileMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
      this._fileMonitor.connect('changed', () => {
        // A single save emits several events; coalesce them.
        if (this._reloadSourceId) GLib.source_remove(this._reloadSourceId);
        this._reloadSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
          this._reloadSourceId = 0;
          log(`DesktopWidgets widget ${this.manifest.id} folder changed; reloading.`);
          this.reload();
          return GLib.SOURCE_REMOVE;
        });
      });
    } catch (e) {
      log(`DesktopWidgets: cannot watch widget folder ${this.manifest.installedPath}: ${e}`);
      this._fileMonitor = null;
    }
  }

  enable() {
    if (this.enabled) return;
    if (!this.actor) this.createActor();
    this.enabled = true;
    _systemPoller.subscribe(this);
    this._setupFileMonitor();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    _systemPoller.unsubscribe(this);

    // Drop any keyboard grab before the actor goes away
    if (this._grabHelper?.grabbed) this._grabHelper.ungrab({ actor: this.actor });
    this._grabHelper = null;

    // Call onDestroy / cleanup
    if (this._sandbox) this._sandbox.callOnDestroy();

    // Clear all timers
    for (const sourceId of Object.values(this._timers)) {
      GLib.source_remove(sourceId);
    }
    this._timers = {};

    // Requests still in flight must not call back into a stopped widget
    this._network?.cancelAll();
    this._media?.stop();
    if (this._resizeSourceId) {
      GLib.source_remove(this._resizeSourceId);
      this._resizeSourceId = 0;
    }
  }

  _onSystemPoll(data) {
    this._lastSystemData = data;
    try {
      if (this._sandbox) this._sandbox.callUpdate();
    } catch (e) {
      log(`DesktopWidgets widget error in update: ${e}`);
      this.disable();
    }
  }

  reload() {
    const wasEnabled = this.enabled;
    this.disable();
    if (this.actor) {
      this.actor.destroy();
      this.actor = null;
    }
    this._sandbox = null;
    this._ctx = null;
    this._api = null;
    if (wasEnabled) {
      this.enable();
    }
  }

  destroy() {
    if (this._reloadSourceId) {
      GLib.source_remove(this._reloadSourceId);
      this._reloadSourceId = 0;
    }
    this.disable();
    if (this._fileMonitor) {
      this._fileMonitor.cancel();
      this._fileMonitor = null;
    }
    if (this._network) {
      this._network.destroy();
      this._network = null;
    }
    this._media?.stop();
    if (this.actor) {
      this.actor.destroy();
      this.actor = null;
    }
  }
}
