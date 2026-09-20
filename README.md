# GNOME Desktop Widgets

A GNOME Shell extension (GNOME 45–50) that puts small scripted widgets on the
desktop, above the wallpaper and below application windows. Widgets are plain
JavaScript files that build St (Shell toolkit) actors.

- [Install and develop](#install-and-develop)
- [Using widgets](#using-widgets)
- [Writing a widget](#writing-a-widget)
  - [Folder layout and manifest](#folder-layout-and-manifest)
  - [Script hooks](#script-hooks)
  - [`ctx` — the rendering context](#ctx--the-rendering-context)
  - [`api` — the widget API](#api--the-widget-api)
  - [Moving, dragging and clicking](#moving-dragging-and-clicking)
  - [Keyboard input](#keyboard-input)
  - [Multiple instances](#multiple-instances)
  - [Sandbox, trust and permissions](#sandbox-trust-and-permissions)
  - [Complete example](#complete-example)
- [Files on disk](#files-on-disk)
- [Limitations](#limitations)

## Install and develop

```bash
./install.sh --enable      # copy to ~/.local/share/gnome-shell/extensions, compile schemas, enable
```

- **Widget scripts hot reload.** The shell watches each widget's folder; saving
  `widget.js` re-renders that widget. `install.sh` also refreshes the installed
  copies of the bundled widgets, so editing `default-widgets/*/index.js` and
  running it again is enough.
- **Extension modules do not.** Changes to `extension.js`, `widget-engine.js`,
  `layout-manager.js` and friends need a new shell process: log out and in on
  Wayland, or Alt+F2 → `r` on X11. Changed bundled manifests
  (`default-widgets/*/metadata.json`) are re-installed when
  `DEFAULTS_VERSION` in `default-library.js` is bumped.
- **Logs:** `journalctl --user -b -f | grep -i DesktopWidgets`. Errors thrown by
  a widget's `render`, `update` or `onClick` are logged there and never crash
  the shell.

## Using widgets

Open the extension's preferences to enable widgets, import your own (folder,
`.zip`, `.tar`/`.tgz`), add sticky notes, and change layout settings.

| Setting | Meaning |
|---|---|
| **Drag Key** | Alt (default), Super, Ctrl or Shift. Hold it and drag anywhere on a widget to move it. Hold it and drag from the bottom-right 16 px corner to resize. |
| Placement Mode | `absolute` or `grid` |
| Snap to Grid / Grid Size | Positions and sizes are rounded to this many pixels when a drag ends |

Without the drag key, a click goes to the widget itself. A widget can offer
[drag regions](#moving-dragging-and-clicking) that move it with a plain drag.

## Writing a widget

### Folder layout and manifest

```
my-widget/
  widget.json      # or manifest.json
  widget.js        # the script named by "script"
  assets/          # optional
```

`widget.json`:

```json
{
  "id": "my-widget",
  "display_name": "My Widget",
  "description": "What it does.",
  "type": "text",
  "script": "widget.js",
  "bg_color": "#00000080",
  "text_color": "#ffffff",
  "drag_region": "background",
  "x": 40, "y": 40, "width": 240, "height": 100,
  "permissions": [],
  "enabled": true,
  "version": "1.0",
  "author": "You",
  "tags": ["example"]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique id; also the name of the widget's data folder |
| `display_name` | yes | Name shown in preferences |
| `script` | no | Script file, relative to the widget folder. Without it the widget is static (see `text` / `image`) |
| `type` | no | `text` (default) or `image`; only used by script-less widgets |
| `text` | no | Script-less widget: text shown in a wrapping label |
| `image` | no | Script-less `image` widget: a `file://` URI |
| `bg_color` | no | Any CSS colour, e.g. `#ffe066` or `rgba(0,0,0,0.5)` |
| `text_color` | no | Default text colour. Set it when `bg_color` is light — the shell theme's text is near-white |
| `drag_region` | no | `"background"` makes the whole widget draggable without the drag key. Default: none |
| `x`, `y`, `width`, `height` | no | Initial geometry in pixels. After the first run the position saved in `layout.json` wins |
| `permissions` | no | `"network"` and/or `"filesystem"` (see [Sandbox](#sandbox-trust-and-permissions)) |
| `trusted` | no | Skips the sandbox checks and permissions. See the warning below |
| `enabled` | no | Whether the widget starts enabled (default `true`) |
| `version`, `author`, `tags`, `description` | no | Shown in preferences |

The base look of a widget is a 10 px rounded box with `8px 12px` padding, the
`bg_color` and the `text_color`. `ctx.setStyle()` replaces all of it.

### Script hooks

The script is a plain script (no `import`/`export`). Define any of these
**top-level functions**; the engine picks them up by name. Top-level `var`s are
your widget's in-memory state and live as long as the widget is loaded.

| Hook | Called | Arguments | Notes |
|---|---|---|---|
| `render(ctx, api)` | Once, when the widget starts or its folder changes | `ctx`, `api` | Build actors and add them to `ctx.box`. May **return a function**: it is called as cleanup when the widget stops. |
| `update(ctx, api)` | Every second while the widget is enabled | `ctx`, `api` | Driven by one shared timer. Keep it cheap. For another interval use `api.timer.register`. |
| `onClick(ctx, api)` | A click (press and release without moving) on a plain part of the widget or in a drag region | `ctx`, `api` | Not called for clicks on buttons or entries (they handle their own) or for drag-key presses. |
| `onDestroy()` | When the widget stops (disabled, reloaded, removed) | none | Runs after the function returned by `render`. Timers from `api.timer` are cleared automatically afterwards. |

Lifecycle: `render` → (`update` every second, `onClick` on clicks) → cleanup
returned by `render` → `onDestroy`. A hot reload runs all of it again from
`render`. Persisted `api.state` survives; top-level `var`s do not.

### `ctx` — the rendering context

| Member | Description |
|---|---|
| `ctx.box` | The widget's root `St.BoxLayout` (vertical, clips to its size). Add your actors here. |
| `ctx.St`, `ctx.Clutter`, `ctx.Gio`, `ctx.GLib`, `ctx.Pango` | The GObject libraries |
| `ctx.setStyle(css)` | Replace the root box's inline CSS (background, padding, radius…) |
| `ctx.addClass(name)` / `ctx.removeClass(name)` | Style classes on the root box |
| `ctx.setSize(w, h)` | Resize the widget and save the new size |
| `ctx.setDragRegion(actor, enabled = true)` | Mark `actor` as a region that moves the widget with a plain drag. Makes the actor reactive. Pass `false` to unmark. |

### `api` — the widget API

**`api.system`** — refreshed once a second; `null` until the first reading or when unavailable.

| Call | Returns |
|---|---|
| `api.system.cpu()` | CPU usage, 0–100 |
| `api.system.memory()` | `{ total, free, used, usedPercent }` (`total`/`free`/`used` in kB) |
| `api.system.battery()` | `{ percentage, state, timeToEmpty, timeToFull }` — `state` is the UPower enum (1 charging, 2 discharging, 4 fully charged); times are in seconds. `null` on machines without a battery |

**`api.state`** — small JSON values saved per widget instance in
`widgets/<id>/state.json`, written on every `set`.

| Call | Description |
|---|---|
| `api.state.get(key)` | The stored value, or `undefined` |
| `api.state.set(key, value)` | Store any JSON-serialisable value |

**`api.timer`** — timers that stop when the widget stops.

| Call | Description |
|---|---|
| `api.timer.register(fn, intervalMs)` | Repeat `fn` every `intervalMs`. Returns an id. An exception in `fn` cancels the timer. |
| `api.timer.clear(id)` | Cancel a timer |

**`api.widget`**

| Call | Description |
|---|---|
| `api.widget.setPosition(x, y)` | Move the widget and save it |
| `api.widget.setSize(w, h)` | Resize the widget and save it |
| `api.widget.getLayout()` | `{ x, y, width, height }` |
| `api.widget.log(msg)` | Write to the shell log, prefixed with the widget id |
| `api.widget.notify(title, body)` | Currently only writes to the shell log; no on-screen notification |

**`api.input`** — see [Keyboard input](#keyboard-input).

**`api.instances`** — see [Multiple instances](#multiple-instances).

**`api.network`** — needs `"network"` in `permissions`. Otherwise every call throws.

| Call | Returns |
|---|---|
| `api.network.fetch(url, { method, headers })` | `{ ok, status, body }` (body is text). `ok` is true for 2xx; `status` is 0 on failure. **Synchronous: it blocks the whole shell until the request finishes.** No request body support. |
| `api.network.fetchJSON(url)` | The parsed JSON, or `null` on any failure |

**`api.fs`** — needs `"filesystem"` in `permissions`. Paths are relative to the
widget's own data folder (`widgets/<id>/data/`); missing folders are created on write.
Paths are not sanitised, so never pass untrusted input containing `..`.

| Call | Returns |
|---|---|
| `api.fs.readFile(path)` | File contents as text, or `null` |
| `api.fs.writeFile(path, content)` | Nothing; failures are logged |
| `api.fs.exists(path)` | `true` / `false` |

### Moving, dragging and clicking

The rules, in order, for a left-button press on a widget:

1. **Drag key held** → the widget moves (or resizes when the press is in the
   bottom-right 16 px corner), wherever the press landed — even on a button or
   text entry. Nothing is clicked.
2. Otherwise the engine walks up from the actor under the pointer to the
   widget's root box. The **nearest** match wins:
   - a **control** (an actor with `can_focus`, a text entry, anything with a
     `clutter_text`) → the control handles the press itself;
   - a **drag region** (`ctx.setDragRegion`, or `"drag_region": "background"`)
     → a drag begins. Released without moving, it counts as a click and calls
     `onClick`.
3. Anything else → the press passes through untouched, and a click calls `onClick`.

So a button inside a drag region is still a button. A dragged widget is snapped
to the grid and saved to `layout.json` when you let go.

```js
function render(ctx, api) {
  var St = ctx.St;
  var title = new St.Label({ text: 'My widget' });
  ctx.setDragRegion(title);          // drag by the title only
  ctx.box.add_child(title);
  // or: ctx.setDragRegion(ctx.box); // drag by anything that isn't a control
}
```

Non-reactive actors such as `St.Label` are never the target of a press; the
event lands on the nearest reactive parent. `setDragRegion` sets `reactive` on
the actor you give it for that reason.

### Keyboard input

Widgets sit below windows, so a text entry only gets keys while the widget
holds a modal grab.

| Call | Description |
|---|---|
| `api.input.grab(focusActor, onRelease)` | Take the keyboard and focus `focusActor`. `onRelease(byUser)` is optional. Returns `true` if the grab was taken. |
| `api.input.release()` | Give the keyboard back |

The grab also ends on **Escape** or a click outside the widget. Typical use:

```js
entry.clutter_text.connect('button-press-event', function () {
  api.input.grab(entry);
  return false;                      // let the entry handle the click as well
});
entry.clutter_text.connect('activate', function () { /* Enter pressed */ });
```

Return a cleanup from `render` that calls `api.input.release()` so a reload
never leaves a grab behind.

### Multiple instances

Instances share one script but have their own id, state and position (the
sticky note uses this).

| Call | Description |
|---|---|
| `api.instances.create()` | Add another copy just below and to the right of this one |
| `api.instances.remove()` | Delete this instance; returns `false` and does nothing if it is the last one. The original is hidden rather than deleted, since it owns the script folder |
| `api.instances.count()` | How many instances are on the desktop |

Changes are applied about 200 ms later, not from inside your click handler.

### Sandbox, trust and permissions

Untrusted scripts are checked for these tokens before running (comments are
ignored); a script containing any of them is refused:

`require` `imports` `global` `process` `eval` `Function` `XMLHttpRequest` `spawn`

Scripts also get a small set of globals: `console.log/warn/error`,
`setTimeout`/`clearTimeout`, `Date`, `Math`, `JSON`, `Number`, `String`,
`Boolean`, `Array`, `Object`, `RegExp`, `Map`, `Set`, `Promise`, `parseInt`,
`parseFloat`, `isNaN`, `isFinite`, `TextDecoder`, `TextEncoder`. Everything else
comes from `ctx` and `api`.

> **This is a filter, not isolation.** Widget code runs inside the GNOME Shell
> process and can reach anything the shell can, and a determined script can
> get around a token check. Only install widgets you trust.
>
> Widgets imported from a folder **under your home directory** are marked
> `trusted` automatically, which skips the token check and grants network and
> filesystem access. The bundled widgets are not trusted.

### Complete example

A clicker with a drag handle, saved state, a timer and a button.

`widget.json`

```json
{
  "id": "clicker",
  "display_name": "Clicker",
  "script": "widget.js",
  "bg_color": "#1e1e2ecc",
  "text_color": "#ffffff",
  "width": 220,
  "height": 100
}
```

`widget.js`

```js
var count = 0;
var label;
var since;

function render(ctx, api) {
  var St = ctx.St;
  count = api.state.get('count') || 0;

  var title = new St.Label({ text: '⠿ Clicker', style: 'font-weight: bold;' });
  ctx.setDragRegion(title);
  ctx.box.add_child(title);

  label = new St.Label({ text: '' });
  ctx.box.add_child(label);

  var btn = new St.Button({ label: 'Add one', can_focus: true });
  btn.connect('clicked', function () {
    count++;
    api.state.set('count', count);
    refresh();
  });
  ctx.box.add_child(btn);

  since = 0;
  api.timer.register(function () { since++; refresh(); }, 5000);
  refresh();

  return function cleanup() { api.widget.log('stopping at ' + count); };
}

function refresh() {
  label.set_text('Count: ' + count + '  (' + since * 5 + 's up)');
}

function update(ctx, api) { /* runs every second; nothing to do here */ }

function onClick(ctx, api) { api.widget.log('background clicked'); }

function onDestroy() { /* last chance to release anything you own */ }
```

## Files on disk

Under `$XDG_DATA_HOME/gnome-desktop-widgets/` (usually `~/.local/share/…`):

| Path | Contents |
|---|---|
| `registry.json` | Every widget's manifest and whether it is enabled |
| `layout.json` | Saved positions and sizes, plus placement mode, snap and grid size |
| `widgets/<id>/` | An imported widget's files |
| `widgets/<id>/state.json` | `api.state` for that instance |
| `widgets/<id>/data/` | `api.fs` root for that instance |
| `default-library/widgets/<id>/` | Installed copies of the bundled widgets |

The Drag Key is a GSettings key: `dconf`/`gsettings` path
`org.gnome.shell.extensions.gnome-desktop-widgets drag-modifier`
(`alt`, `super`, `ctrl` or `shift`).

## Limitations

- There are no script hooks for drag, resize or focus; only the four in
  [Script hooks](#script-hooks). Widgets have a fixed size unless they call
  `setSize`, and are not told when the user resizes them.
- `update` runs at 1 Hz only. `setTimeout` timers are not cancelled when the
  widget stops; prefer `api.timer`.
- `api.network.fetch` blocks the shell while it runs. Keep requests rare and
  small, or avoid them in `update`.
- Widgets must not depend on state held in top-level `var`s across a reload.
  Use `api.state`.
- The bundled Weather, Calendar Agenda and RSS News widgets show sample data
  only; Search Launcher and Media Controls only mimic their controls. They are
  starting points for real implementations.
