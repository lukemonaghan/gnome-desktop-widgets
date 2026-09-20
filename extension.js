/* GNOME Desktop Widgets MVP runtime */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { getRegistry } from './store.js';
import { WidgetInstance } from './widget-engine.js';
import { LayoutManager } from './layout-manager.js';
import { installDefaultWidgets } from './default-library.js';

export default class DesktopWidgetsExtension extends Extension {
  constructor(metadata) {
    super(metadata);
    this._registry = null;
    this._layout = null;
    this._settings = null;
    this._widgets = {};
    this._registryMonitor = null;
    this._syncSourceId = 0;
  }

  // Desktop widgets belong above the wallpaper but below application windows.
  _widgetParent() {
    return Main.layoutManager._backgroundGroup ?? Main.uiGroup;
  }

  _startWidget(widget) {
    const engine = new WidgetInstance(widget);
    engine._layoutCallback = (id, layout) => {
      this._layout.setLayout(id, layout);
    };
    this._layout.registerWidgetHooks(widget.id, {
      onClick: () => engine.click(),
      isDragRegion: (actor) => engine.isDragRegion(actor),
    });
    engine._actions = {
      create: (id) => this._createInstance(id),
      remove: (id) => this._removeInstance(id),
      count: (id) => this._familyEnabled(id).length,
    };

    // Called for the initial actor and again whenever the widget is reloaded.
    engine.onActorReady = (actor) => {
      this._layout.apply(widget.id, actor, widget);
      this._widgetParent().add_child(actor);
    };

    this._widgets[widget.id] = engine;
    engine.enable();
  }

  _familyEnabled(id) {
    return this._registry.getFamily(id).filter((w) => w.enabled);
  }

  // Add another copy of a widget just below and to the right of the original.
  _createInstance(id) {
    this._registry.reload();
    const layout = this._widgets[id]?._getCurrentLayout() ?? {};
    try {
      this._registry.cloneWidget(id, {
        x: layout.x !== undefined ? layout.x + 30 : undefined,
        y: layout.y !== undefined ? layout.y + 30 : undefined,
        width: layout.width,
        height: layout.height,
      });
    } catch (e) {
      log(`Desktop Widgets: cannot create another ${id}: ${e}`);
      return;
    }
    this._queueSync();
  }

  // Delete an instance. The last one is kept so there is always one left.
  _removeInstance(id) {
    this._registry.reload();
    if (this._familyEnabled(id).length <= 1) return false;

    const widget = this._registry.getWidget(id);
    if (widget?.cloneOf) {
      this._registry.removeWidget(id);
      this._layout.remove(id);
    } else {
      // The original owns the script folder, so hide it instead
      this._registry.setEnabled(id, false);
    }
    this._queueSync();
    return true;
  }

  // Start/stop widgets to match registry.json. The prefs window runs in a
  // separate process and only edits that file, so we watch it for changes.
  _syncWithRegistry() {
    if (!this._registry) return;
    this._registry.reload();

    const wanted = new Map();
    for (const w of this._registry.getAllWidgets())
      if (w.enabled) wanted.set(w.id, w);

    for (const id of Object.keys(this._widgets)) {
      if (wanted.has(id)) continue;
      this._widgets[id].destroy();
      delete this._widgets[id];
    }

    for (const [id, widget] of wanted) {
      if (this._widgets[id]) continue;
      try {
        this._startWidget(widget);
      } catch (e) {
        log(`Desktop Widgets: failed to start widget ${id}: ${e}`);
        this._widgets[id]?.destroy();
        delete this._widgets[id];
      }
    }
  }

  // A single write emits several events; coalesce them. Also keeps a widget
  // from being destroyed from inside one of its own click handlers.
  _queueSync() {
    if (this._syncSourceId) GLib.source_remove(this._syncSourceId);
    this._syncSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
      this._syncSourceId = 0;
      this._syncWithRegistry();
      return GLib.SOURCE_REMOVE;
    });
  }

  _watchRegistry() {
    try {
      const file = Gio.File.new_for_path(this._registry.getPath());
      this._registryMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
      this._registryMonitor.connect('changed', () => this._queueSync());
    } catch (e) {
      log(`Desktop Widgets: cannot watch registry: ${e}`);
    }
  }

  enable() {
    log('Desktop Widgets enabling');
    this._registry = getRegistry();
    installDefaultWidgets();
    this._settings = this.getSettings();
    this._layout = new LayoutManager({ Clutter, settings: this._settings });

    for (const widget of this._registry.getAllWidgets()) {
      if (!widget.enabled) continue;
      try {
        this._startWidget(widget);
      } catch (e) {
        log(`Desktop Widgets: failed to start widget ${widget.id}: ${e}`);
        this._widgets[widget.id]?.destroy();
        delete this._widgets[widget.id];
      }
    }

    this._watchRegistry();

    log('Desktop Widgets enabled');
  }

  disable() {
    log('Desktop Widgets disabling');

    if (this._syncSourceId) {
      GLib.source_remove(this._syncSourceId);
      this._syncSourceId = 0;
    }
    this._registryMonitor?.cancel();
    this._registryMonitor = null;

    for (const engine of Object.values(this._widgets))
      engine.destroy();
    this._widgets = {};

    this._layout?.destroy();
    this._layout = null;
    this._settings = null;
    this._registry = null;

    log('Desktop Widgets disabled');
  }
}
