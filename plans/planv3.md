# GNOME Desktop Widgets — Plan v3

## Vision

A widget system where each widget is a self-contained package with its own render logic, powered by the GNOME rendering engine (St/Clutter), with a clean API for system data and network access. Widgets are individually positioned and sized on the desktop and managed through a central registry.

---

## 1. Widget Package Format

Each widget is a folder containing:

```
my-widget/
  metadata.json   — identity, layout defaults, permissions
  index.js        — render function + update logic
  assets/         — (optional) icons, images, stylesheets
```

### 1.1 metadata.json

```json
{
  "id": "my-widget",
  "display_name": "My Widget",
  "description": "Does something cool.",
  "version": "1.0",
  "author": "Name",
  "tags": ["utility"],

  "script": "index.js",

  "x": 100,
  "y": 200,
  "width": 300,
  "height": 150,

  "permissions": ["network", "filesystem"],

  "bg_color": "#00000080",
  "enabled": false
}
```

| Field | Required | Purpose |
|-------|----------|---------|
| `id` | yes | Unique widget identifier |
| `display_name` | yes | Human-readable name |
| `script` | yes | Entry point file |
| `x`, `y` | no | Default position on desktop (px) |
| `width`, `height` | no | Default size (px) |
| `permissions` | no | API capabilities (`network`, `filesystem`) |

### 1.2 index.js Contract

Every widget script receives two objects and must implement a `render()` function:

```js
// Called once when the widget mounts. `ctx` is the GNOME rendering
// context (St/Clutter actors). `api` provides system data & utilities.
function render(ctx, api) {
  const label = new ctx.St.Label({ text: 'Hello' });
  ctx.box.add_child(label);

  // Return a cleanup function (optional)
  return () => label.destroy();
}

// Called on each system tick (~1s) with fresh data.
function update(ctx, api) {
  const cpu = api.system.cpu();
  ctx.box.get_children()[0].set_text(`CPU: ${Math.round(cpu)}%`);
}
```

| Export | Required | When called |
|--------|----------|-------------|
| `render(ctx, api)` | **yes** | Once, when widget is enabled/mounted |
| `update(ctx, api)` | no | Every system-poll tick (~1 s) |
| `onClick(ctx, api)` | no | On click/tap |
| `onDestroy()` | no | When widget is disabled/removed |

---

## 2. Rendering Context (`ctx`)

The render context gives widgets direct access to GNOME's toolkit so they can build real UI — not just text labels.

```js
ctx = {
  // Toolkit namespaces
  St,          // Shell Toolkit (labels, buttons, boxes, icons, entries, etc.)
  Clutter,     // Scene graph (animations, transforms, effects)
  Gio,         // File I/O, icons, app launching
  GLib,        // Timers, mainloop, path utils
  Pango,       // Text layout & font control

  // Pre-built container for this widget (St.BoxLayout)
  box,         // The root actor — add children here

  // Helpers
  setStyle(css),          // Apply inline CSS to the root box
  addClass(name),         // Add a CSS class to root box
  setSize(w, h),          // Resize the widget
}
```

### What widgets can do with `ctx`

- Build complex layouts with `St.BoxLayout`, `St.Bin`, `St.Widget`
- Use `St.Label`, `St.Button`, `St.Entry`, `St.Icon`, `St.DrawingArea`
- Apply CSS classes and inline styles
- Animate with `Clutter.PropertyTransition`
- Draw with Cairo via `St.DrawingArea`
- Load icons via `Gio.icon_new_for_string()`

### Security boundary

Widgets that declare `"permissions": []` (or omit it) get the full `ctx` but **no** network or filesystem access via `api`. The sandbox blocks `imports`, `require`, `eval`, and direct global access. Widgets with `"trusted": true` bypass the sandbox entirely (local-only installs).

---

## 3. Widget API (`api`)

System data and utilities — no direct GI imports needed.

### 3.1 System Data (polled every ~1s)

```js
api.system.cpu()          // number (0–100) or null
api.system.memory()       // { total, free, used, usedPercent } (KB) or null
api.system.battery()      // { percentage, state, timeToEmpty, timeToFull } or null
```

### 3.2 Network (requires `"permissions": ["network"]`)

```js
api.network.fetch(url, options)   // Returns { ok, status, body } (sync, sandboxed)
api.network.fetchJSON(url)        // Shorthand → parsed JSON body
```

Implementation: proxied through `Soup` (libsoup3) in the extension process. Widgets never get raw socket access.

### 3.3 Filesystem (requires `"permissions": ["filesystem"]`)

```js
api.fs.readFile(path)       // Returns string contents or null
api.fs.writeFile(path, str) // Write string to file
api.fs.exists(path)         // boolean
```

Paths are sandboxed to the widget's own data directory (`~/.local/share/gnome-desktop-widgets/widgets/{id}/data/`).

### 3.4 Timers

```js
const id = api.timer.register(callback, intervalMs)
api.timer.clear(id)
```

Backed by `GLib.timeout_add`. Automatically cleaned up on widget disable.

### 3.5 State Persistence

```js
api.state.set(key, value)   // Persisted across sessions
api.state.get(key)           // Retrieve saved value
```

### 3.6 Widget Self-Control

```js
api.widget.setPosition(x, y)
api.widget.setSize(width, height)
api.widget.getLayout()           // { x, y, width, height }
api.widget.log(message)
api.widget.notify(title, body)   // Desktop notification
```

---

## 4. Default Widget Library

Ships with the extension under `default-widgets/`. Installed to user data on first run.

### 4.1 Included Widgets

| Widget | Type | Updates | Key APIs |
|--------|------|---------|----------|
| Digital Clock | time display | 1s timer | `ctx.St.Label` |
| Analog Clock | visual clock | 1s timer | `ctx.St.DrawingArea` (Cairo) |
| World Clock | multi-timezone | 1m timer | `ctx.St.Label`, `Date` |
| Monthly Calendar | date grid | 1h timer | `ctx.St.Label` |
| System Monitor | CPU/RAM | poll | `api.system.cpu()`, `.memory()` |
| Battery Status | charge level | poll | `api.system.battery()` |
| Network Throughput | up/down speed | poll | `api.system` or `/proc/net/dev` |
| Weather Summary | conditions | 30m fetch | `api.network.fetchJSON()` |
| Todo / Sticky Note | editable list | — | `api.state`, `ctx.St.Entry` |
| Calendar Agenda | day events | 1h | `api.state` |
| Pomodoro Timer | work/break | 1s | `api.timer`, `ctx.St.Label` |
| Countdown Timer | configurable | 1s | `api.timer` |
| Media Controls | play/pause | — | `ctx.St.Button`, `onClick` |
| RSS News Feed | headlines | 15m fetch | `api.network.fetchJSON()` |
| Quote of the Day | daily quote | 1h | `api.state` |
| Image Slideshow | rotating images | poll | `ctx.St.Icon`, `Gio` |
| Search Launcher | quick launch | — | `ctx.St.Entry` |

### 4.2 Export for Customization

Any default widget can be exported from the prefs UI as a folder or zip. The exported package is a complete, editable widget that the user can modify and re-import.

---

## 5. Widget Import & Management

### 5.1 Import Sources

| Source | Method |
|--------|--------|
| Folder | Select folder containing `metadata.json` + `index.js` |
| ZIP / tar.gz | Archive unpacked, validated, installed |
| Remote URL | Downloaded, unpacked, installed |

### 5.2 Import Flow

```
User selects source
  → Validate (metadata.json exists, has id + display_name)
  → Copy to ~/.local/share/gnome-desktop-widgets/widgets/{id}/
  → Register in registry.json
  → Widget appears in prefs sidebar (disabled by default)
  → User enables → render() called → widget appears on desktop
```

### 5.3 Widget Lifecycle

```
Import/Install → Registered (disabled)
  → Enable  → render(ctx, api) called, actor added to desktop
  → Tick    → update(ctx, api) called each second (if defined)
  → Click   → onClick(ctx, api) called
  → Drag    → position updated in layout.json
  → Resize  → size updated in layout.json
  → Disable → onDestroy() called, actor removed
  → Remove  → files deleted, unregistered
```

---

## 6. Positioning & Layout

### 6.1 Per-Widget Positioning

- Each widget has its own `x`, `y`, `width`, `height` stored in `layout.json`
- Default values come from `metadata.json`
- User drags to reposition → saved automatically
- User resizes via bottom-right handle → saved automatically

### 6.2 Layout Modes

| Mode | Behavior |
|------|----------|
| **Absolute** | Free pixel-perfect placement anywhere on screen |
| **Grid** | Snap to configurable grid (default 20px) |

### 6.3 Layout Persistence

```json
// ~/.local/share/gnome-desktop-widgets/layout.json
{
  "meta": { "mode": "absolute", "snapToGrid": true, "gridSize": 20 },
  "widgets": {
    "default-digital-clock": { "x": 40, "y": 40, "width": 280, "height": 100, "layer": 0 },
    "default-system-monitor": { "x": 40, "y": 180, "width": 260, "height": 80, "layer": 0 }
  }
}
```

### 6.4 Prefs UI Controls

- Auto-arrange: pack all widgets left-to-right with margins
- Align: left / right / center / top / bottom
- Reset: restore widget to its `metadata.json` default position

---

## 7. Architecture

### 7.1 File Structure

```
gnome-desktop-widgets/
  extension.js          — GNOME Shell entry point, lifecycle
  widget-engine.js      — WidgetInstance: actor creation, sandbox, system poller
  sandbox.js            — Secure execution environment for widget scripts
  store.js              — WidgetRegistry: persistent manifest storage
  layout-manager.js     — Position/size persistence, drag/resize
  default-library.js    — Scan & install default-widgets/
  importer.js           — Import from folder/archive/URL
  prefs.js              — GTK4/Adw preferences UI
  metadata.json         — GNOME Shell extension metadata
  schemas/              — GSettings schema
  default-widgets/      — Built-in widget packages
    digital-clock/
      metadata.json
      index.js
    system-monitor/
      metadata.json
      index.js
    ...
```

### 7.2 Data Flow

```
extension.js enable()
  ├─ installDefaultWidgets()     — copy default-widgets/ → user data
  ├─ getRegistry()               — load registry.json
  ├─ new LayoutManager()         — load layout.json
  └─ for each enabled widget:
     ├─ new WidgetInstance(manifest)
     │   ├─ new WidgetSandbox()  — prepare safe execution context
     │   ├─ load index.js        — parse widget script
     │   ├─ build ctx            — { St, Clutter, Gio, GLib, Pango, box, ... }
     │   ├─ build api            — { system, network, fs, timer, state, widget }
     │   └─ call render(ctx, api)
     ├─ layout.apply()           — set position/size, wire drag/resize
     └─ add actor to desktop
```

### 7.3 System Poller

Single `GLib.timeout_add` at 1s interval, shared across all widgets:
- Reads `/proc/stat` (CPU), `/proc/meminfo` (memory), UPower (battery)
- Calls `update(ctx, api)` on each subscribed widget
- Widgets see fresh data via `api.system.*`

---

## 8. Implementation Tasks

### Phase 1: Rendering Context Refactor
- [x] Refactor `WidgetInstance.createActor()` to build `ctx` object with St, Clutter, Gio, GLib, Pango + the root box
- [x] Update `WidgetSandbox` to pass `ctx` and `api` to widget scripts
- [x] Change widget script contract from hook-based (`widget.onInit`) to function-based (`render(ctx, api)`, `update(ctx, api)`)
- [x] Update all 17 default widgets to new `render(ctx, api)` / `update(ctx, api)` contract
- [ ] Ensure backward compat: if widget exports old-style hooks, wrap them

### Phase 2: API Expansion
- [x] Implement `api.network.fetch()` / `fetchJSON()` via Soup (permission-gated)
- [x] Implement `api.fs.readFile()` / `writeFile()` / `exists()` (sandboxed to widget data dir)
- [x] Implement `api.state.set()` / `get()` with persistent storage per widget
- [x] Implement `api.widget.setPosition()` / `setSize()` / `getLayout()`

### Phase 3: Import & Export Polish
- [ ] Validate `index.js` has a `render` export on import
- [ ] "Export widget" creates a clean folder/zip with metadata.json + index.js + assets
- [ ] "Export default library" zips all default widgets
- [ ] Remote URL import (download → unpack → validate → install)

### Phase 4: Layout & Positioning
- [ ] Ensure each widget's metadata.json position seeds layout.json on first run
- [ ] Reset-to-default-position action in prefs UI
- [ ] Per-widget layer/z-index control
- [ ] Multi-monitor awareness (detect monitor bounds, constrain per-monitor)

### Phase 5: Prefs UI
- [ ] Widget preview in prefs (render thumbnail or screenshot)
- [ ] Search/filter widgets by tag
- [ ] Drag-to-reorder in sidebar
- [ ] Position/size spinners for precise placement
- [ ] Permission display per widget

---

## 9. Security Model

| Scope | Default | With Permission |
|-------|---------|-----------------|
| St / Clutter rendering | ✅ Always | — |
| System data (cpu/mem/bat) | ✅ Always | — |
| Timers | ✅ Always | — |
| State persistence | ✅ Always | — |
| Network (HTTP) | ❌ Blocked | `"permissions": ["network"]` |
| Filesystem | ❌ Blocked | `"permissions": ["filesystem"]` |
| Raw GI imports | ❌ Blocked | `"trusted": true` (local only) |
| eval / Function() | ❌ Blocked | `"trusted": true` |

---

## 10. Storage Paths

| What | Path |
|------|------|
| Extension source | `~/.local/share/gnome-shell/extensions/gnome-desktop-widgets@lukem/` |
| Widget installs | `~/.local/share/gnome-desktop-widgets/widgets/{id}/` |
| Default lib copy | `~/.local/share/gnome-desktop-widgets/default-library/widgets/{id}/` |
| Registry | `~/.local/share/gnome-desktop-widgets/registry.json` |
| Layout | `~/.local/share/gnome-desktop-widgets/layout.json` |
| Widget state | `~/.local/share/gnome-desktop-widgets/widgets/{id}/state.json` |
| Widget data dir | `~/.local/share/gnome-desktop-widgets/widgets/{id}/data/` |
