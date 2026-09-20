import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Clutter.EVENT_STOP === 1 (GLib TRUE). We use the literal to avoid importing
// Clutter, which is unavailable in the prefs process.
const EVENT_STOP = 1;
const EVENT_PROPAGATE = 0;

// Earlier versions seeded every widget with this identical geometry, which
// stacked them all on top of each other. Treat it as "never positioned".
const LEGACY_SEED = { x: 860, y: 500, width: 200, height: 80 };

// Modifier keys that let a widget be moved from anywhere; the ids are what the
// `drag-modifier` setting stores.
export const DRAG_MODIFIERS = [
  { id: 'alt', label: 'Alt', mask: 'MOD1_MASK' },
  { id: 'super', label: 'Super', mask: 'SUPER_MASK' },
  { id: 'ctrl', label: 'Ctrl', mask: 'CONTROL_MASK' },
  { id: 'shift', label: 'Shift', mask: 'SHIFT_MASK' },
];
export const DEFAULT_DRAG_MODIFIER = 'alt';

const DATA_DIR = GLib.get_user_data_dir();
const STORAGE_PATH = `${DATA_DIR}/gnome-desktop-widgets/layout.json`;

function _readJSON(path) {
  const file = Gio.File.new_for_path(path);
  if (!file.query_exists(null))
    return {};
  try {
    const [success, contents] = file.load_contents(null);
    if (!success) return {};
    const raw = new TextDecoder().decode(contents);
    return JSON.parse(raw);
  } catch (e) {
    log(`DesktopWidgets layout-manager: cannot read ${path}: ${e}`);
    return {};
  }
}

function _writeJSON(path, obj) {
  const file = Gio.File.new_for_path(path);
  try {
    file.replace_contents(JSON.stringify(obj, null, 2), null, false, Gio.FileCreateFlags.NONE, null);
  } catch (e) {
    log(`DesktopWidgets layout-manager: cannot write ${path}: ${e}`);
  }
}

export class LayoutManager {
  // options (shell process only): { Clutter, settings }. Clutter is passed in
  // because it is unavailable in the prefs process, which only edits layout.
  constructor(options = {}) {
    this._Clutter = options.Clutter ?? null;
    this._settings = options.settings ?? null;
    const saved = _readJSON(STORAGE_PATH) || {};
    this._layout = saved.widgets || {};
    this._meta = saved.meta || { mode: 'absolute', snapToGrid: true, gridSize: 20 };
    this._dragging = {};
    this._widgetHooks = {};
    this._seeded = 0;
    this._activeDrag = null;
    this._pendingClick = null;
  }

  destroy() {
    this._endDrag(false);
    this._widgetHooks = {};
  }

  // Forget a widget that was deleted for good.
  remove(widgetId) {
    delete this._layout[widgetId];
    delete this._widgetHooks[widgetId];
    this._save();
  }

  registerWidgetHooks(widgetId, hooks = {}) {
    this._widgetHooks[widgetId] = hooks;
  }

  _callWidgetHook(widgetId, name, ...args) {
    const hooks = this._widgetHooks[widgetId];
    if (hooks && typeof hooks[name] === 'function') {
      try {
        hooks[name](...args);
      } catch (e) {
        log(`DesktopWidgets layout-manager hook ${name} failed for ${widgetId}: ${e}`);
      }
    }
  }

  _save() {
    _writeJSON(STORAGE_PATH, { widgets: this._layout, meta: this._meta });
  }

  getLayout(widgetId, defaults) {
    if (this._layout[widgetId]) return this._layout[widgetId];
    return {
      x: defaults?.x ?? 20,
      y: defaults?.y ?? 20,
      width: defaults?.width ?? 200,
      height: defaults?.height ?? 80,
      layer: 0,
    };
  }

  setLayout(widgetId, layout) {
    const finalLayout = { ...this.getLayout(widgetId), ...layout };
    if (this._meta.snapToGrid) {
      finalLayout.x = this._snap(finalLayout.x);
      finalLayout.y = this._snap(finalLayout.y);
      finalLayout.width = this._snap(finalLayout.width);
      finalLayout.height = this._snap(finalLayout.height);
    }
    this._layout[widgetId] = finalLayout;
    this._save();
  }

  _snap(value) {
    const grid = Math.max(1, this._meta.gridSize || 20);
    return Math.round(value / grid) * grid;
  }

  setMode(mode) {
    if (mode !== 'absolute' && mode !== 'grid') return;
    this._meta.mode = mode;
    this._save();
  }

  setSnapToGrid(enabled) {
    this._meta.snapToGrid = !!enabled;
    this._save();
  }

  setGridSize(size) {
    this._meta.gridSize = Math.max(1, Number(size) || 20);
    this._save();
  }

  getMode() {
    return this._meta.mode;
  }

  isSnapToGrid() {
    return !!this._meta.snapToGrid;
  }

  getGridSize() {
    return this._meta.gridSize;
  }

  autoArrange(widgetInfoList) {
    const margin = this._meta.gridSize || 20;
    let currentX = margin;
    let currentY = margin;
    let maxHeight = 0;

    const screenWidth = (typeof global !== 'undefined' && global.display)
      ? global.display.get_primary_monitor().width
      : 1920;

    widgetInfoList.forEach((info) => {
      const layout = this.getLayout(info.id);
      const width = layout.width || 200;
      const height = layout.height || 80;

      if (currentX + width + margin > screenWidth) {
        currentX = margin;
        currentY += maxHeight + margin;
        maxHeight = 0;
      }

      this.setLayout(info.id, { x: currentX, y: currentY, width, height });

      maxHeight = Math.max(maxHeight, height);
      currentX += width + margin;
    });
  }

  alignWidgets(widgetInfoList, alignment) {
    const primaryMonitor = (typeof global !== 'undefined' && global.display)
      ? global.display.get_primary_monitor()
      : null;
    const screenWidth = primaryMonitor ? primaryMonitor.width : 1920;
    const screenHeight = primaryMonitor ? primaryMonitor.height : 1080;

    widgetInfoList.forEach((info) => {
      const layout = this.getLayout(info.id);
      if (!layout) return;
      let x = layout.x;
      let y = layout.y;

      if (alignment === 'left') x = 20;
      else if (alignment === 'right') x = screenWidth - (layout.width || 200) - 20;
      else if (alignment === 'top') y = 20;
      else if (alignment === 'bottom') y = screenHeight - (layout.height || 80) - 20;
      else if (alignment === 'center') {
        x = Math.max(20, Math.round((screenWidth - (layout.width || 200)) / 2));
        y = Math.max(20, Math.round((screenHeight - (layout.height || 80)) / 2));
      }

      this.setLayout(info.id, { x, y });
    });
  }

  _isLegacySeed(layout) {
    return layout && Object.keys(LEGACY_SEED).every((k) => layout[k] === LEGACY_SEED[k]);
  }

  apply(widgetId, actor, manifest) {
    const saved = this._layout[widgetId];
    if (!saved || (this._isLegacySeed(saved) && manifest?.x !== undefined)) {
      // Fall back to a cascade so widgets without a manifest position
      // don't all land on the same spot.
      const offset = 20 + this._seeded++ * 30;
      delete this._layout[widgetId];
      this.setLayout(widgetId, this.getLayout(widgetId, {
        x: manifest?.x ?? offset,
        y: manifest?.y ?? offset,
        width: manifest?.width,
        height: manifest?.height,
      }));
    }

    if (actor) {
      const layout = this.getLayout(widgetId);
      if (this._meta.mode === 'grid' && this._meta.snapToGrid)
        actor.set_position(this._snap(layout.x), this._snap(layout.y));
      else
        actor.set_position(layout.x, layout.y);
      if (layout.width) actor.set_size(layout.width, layout.height);
      this._makeDraggableResizer(widgetId, actor);
    }
  }

  _dragModifierMask() {
    const id = this._settings?.get_string('drag-modifier') ?? DEFAULT_DRAG_MODIFIER;
    const entry = DRAG_MODIFIERS.find((m) => m.id === id)
      ?? DRAG_MODIFIERS.find((m) => m.id === DEFAULT_DRAG_MODIFIER);
    return this._Clutter.ModifierType[entry.mask];
  }

  // Motion/release are tracked on the stage for the duration of a drag so the
  // gesture keeps working when the pointer outruns or leaves the actor.
  _endDrag(commit) {
    const drag = this._activeDrag;
    if (!drag) return;
    this._activeDrag = null;

    global.stage.disconnect(drag.stageEventId);
    drag.actor.disconnect(drag.destroyId);

    if (!commit) return;

    if (!drag.moved) {
      // A key-assisted press is a move gesture, not a click on the widget
      if (!drag.viaModifier) this._callWidgetHook(drag.widgetId, 'onClick');
      return;
    }

    // Persist (and snap) once, instead of on every motion event
    this.setLayout(drag.widgetId, {
      x: drag.actor.x,
      y: drag.actor.y,
      width: drag.actor.width,
      height: drag.actor.height,
    });
    const layout = this.getLayout(drag.widgetId);
    drag.actor.set_position(layout.x, layout.y);
    drag.actor.set_size(layout.width, layout.height);
    this._callWidgetHook(drag.widgetId, 'onDragEnd', layout);
  }

  // What a press on `source` should do when no drag key is held:
  //   'drag'   — inside a drag region the widget declared
  //   'widget' — on a control (button, text entry) that handles the press
  //   'plain'  — anywhere else; a click there is reported to onClick
  // The nearest match walking up from the source wins, so a button inside a
  // drag region still behaves as a button.
  _classifyPress(widgetId, actorObject, source) {
    const hooks = this._widgetHooks[widgetId];
    for (let node = source; node; node = node.get_parent()) {
      if (node.can_focus || node.clutter_text || typeof node.get_editable === 'function')
        return 'widget';
      if (hooks?.isDragRegion?.(node)) return 'drag';
      if (node === actorObject) break;
    }
    return 'plain';
  }

  _startDrag(widgetId, actorObject, event, viaModifier) {
    // A drag that never saw its release must not block every later click
    if (this._activeDrag) this._endDrag(false);

    const Clutter = this._Clutter;
    const [stageX, stageY] = event.get_coords();
    const [, localX, localY] = actorObject.transform_stage_point(stageX, stageY);

    const drag = {
      widgetId,
      actor: actorObject,
      viaModifier,
      // 16px resize zone bottom-right, only reachable with the drag key held
      // so it can never steal clicks from the widget's own controls
      resize: viaModifier && localX >= actorObject.width - 16 && localY >= actorObject.height - 16,
      startX: stageX,
      startY: stageY,
      origX: actorObject.x,
      origY: actorObject.y,
      origW: actorObject.width,
      origH: actorObject.height,
      moved: false,
    };

    // Captured on the stage so no actor (or modal grab target) sees these first
    drag.stageEventId = global.stage.connect('captured-event', (_stage, ev) => {
      const type = ev.type();
      if (type === Clutter.EventType.BUTTON_RELEASE) {
        this._endDrag(true);
        return EVENT_STOP;
      }
      if (type !== Clutter.EventType.MOTION) return EVENT_PROPAGATE;

      const [x, y] = ev.get_coords();
      const dx = x - drag.startX;
      const dy = y - drag.startY;

      // Small jitter during a click must not count as a drag
      if (!drag.moved && Math.hypot(dx, dy) < 4) return EVENT_STOP;
      if (!drag.moved) {
        drag.moved = true;
        this._callWidgetHook(widgetId, 'onDragStart');
      }

      if (drag.resize) {
        const width = Math.max(64, Math.round(drag.origW + dx));
        const height = Math.max(32, Math.round(drag.origH + dy));
        actorObject.set_size(width, height);
        this._callWidgetHook(widgetId, 'onResize', { width, height });
      } else {
        const newX = Math.round(drag.origX + dx);
        const newY = Math.round(drag.origY + dy);
        actorObject.set_position(newX, newY);
        this._callWidgetHook(widgetId, 'onDrag', { x: newX, y: newY });
      }
      return EVENT_STOP;
    });

    // If the widget is destroyed mid-drag (e.g. hot reload), drop the drag
    drag.destroyId = actorObject.connect('destroy', () => this._endDrag(false));

    this._activeDrag = drag;
  }

  _makeDraggableResizer(widgetId, actor) {
    const Clutter = this._Clutter;
    actor.reactive = true;

    // Captured (not bubbled) so a key-assisted press can take over even from
    // a text entry, and so plain presses reach the widget's controls untouched.
    actor.connect('captured-event', (actorObject, event) => {
      const type = event.type();

      if (type === Clutter.EventType.BUTTON_PRESS) {
        if (event.get_button() !== 1) return EVENT_PROPAGATE;

        if (event.get_state() & this._dragModifierMask()) {
          this._pendingClick = null;
          this._startDrag(widgetId, actorObject, event, true);
          return EVENT_STOP;
        }

        const kind = this._classifyPress(widgetId, actorObject, event.get_source());
        if (kind === 'drag') {
          this._pendingClick = null;
          this._startDrag(widgetId, actorObject, event, false);
          return EVENT_STOP;
        }
        this._pendingClick = kind === 'plain' ? widgetId : null;
        return EVENT_PROPAGATE;
      }

      if (type === Clutter.EventType.BUTTON_RELEASE) {
        // A release on the widget itself also ends the drag, in case the
        // stage never sees it (e.g. a modal grab took the pointer).
        if (this._activeDrag?.widgetId === widgetId) {
          this._endDrag(true);
          return EVENT_STOP;
        }
        if (this._pendingClick === widgetId) {
          this._pendingClick = null;
          this._callWidgetHook(widgetId, 'onClick');
        }
      }
      return EVENT_PROPAGATE;
    });
  }
}
