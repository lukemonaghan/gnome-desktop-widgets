# GNOME Desktop Widgets Plan v2

## 1) Vision

- Continue building the GNOME Shell extension with a KWGT-like widget ecosystem.
- Add rich default widget library + example export, and an "endless desktop" monitor mode for large canvas panning.
- Keep core goals: declarative widget packaging, secure sandbox, multi-monitor layout, state persistence.

## 2) v2 Core feature expansions

### 2.1 Default widget library (built-in/fallback)
- Preload a curated library at install-time (or first-run) with 10-20 ready-to-use widgets. ✅
- Widget examples include:
  - [x] Analog clock
  - [x] Digital clock
  - [x] Monthly calendar
  - [x] Weather summary
  - [x] Sticky note
  - [x] Todo list
  - [x] System monitor (CPU/RAM/Disk)
  - [x] Network throughput
  - [x] Battery status
  - [x] Media controls
  - [x] RSS news feed
  - [x] Countdown timer
  - [x] World clock (multi-zone)
  - [x] Calendar agenda
  - [x] Pomodoro timer
  - [x] Quote-of-the-day
  - [x] Simple image slideshow
  - [x] Search launcher
- Provide metadata (name, description, tags, author, version) for filtering and search. ✅
- Allow direct enable/disable and duplication from library. ✅

### 2.2 Library export as ZIP example package
- UI button: "Export default library" or per-widget: "Export to ZIP". ✅
- Export format:
  - `widget.json` manifest
  - `template.*`, `script.*`, `assets/`
  - Optional readme and preview image.
- Provide an `examples` package with all default widgets zipped to `~/.local/share/gnome-desktop-widgets/examples/widgets-export.zip`. ✅
- Users can use export as baseline for creating custom widgets and for sharing. ✅

### 2.3 Endless (whiteboard) monitor mode
- New monitor placement mode: `endless` (free canvas) as alternative to `grid`/`absolute`.
- Behavior:
  - Continuous pan by mouse-drag edge gesture, hotkeys (e.g., Ctrl+Alt+Arrows), or touch gestures.
  - Zoom option (e.g., 50%-200%) for large layouts.
  - Then place widgets anywhere on the infinite coordinate plane.
- Persist coordinate system per-monitor in settings/storage.
- Snap/grid in endless mode with optional local snap origin and guides.
- Multi-monitor interaction:
  - Expand across connected displays.
  - Optional "pinned viewport" to traditional monitor boundary or snap back to active display.

### 2.4 Existing plan alignment
- Keep all prior features: repository, import/export, lifecycle, layout, sandboxing, authoring APIs, UX flow.
- Add these v2 items to roadmap and architecture with minimal regressions.

## 3) UX and user flows (v2)

### 3.1 Default library onboarding
1. First run: prompt to install default widget library.
2. Open library panel with category tabs and quick preview.
3. Select widget → choose place on desktop or install in library.
4. User can click "Export selected widget" or "Export all examples".

### 3.2 Endless monitor setup
1. In prefs: Monitor layout mode selector (normal/absolute/endless).
2. Choose monitor, enable "Endless mode".
3. Use toolbar: Pan/zoom controls, reset view, smart align.
4. Widgets persist with `x/y` in infinite plane; panning state saves to restore viewport.

## 4) Architecture (v2)

### 4.1 Data model updates
- `layout-store` entries include `mode` (`grid|absolute|endless`), `canvasOffset{x,y}`, `zoom`.
- Widget entries include `widgetSource: default|user|remote` for library distinction.
- Example package registry for `examples.zip` and exported artifacts.

### 4.2 File structure updates
- Add default widget templates under `~/.local/share/gnome-desktop-widgets/default-library/`.
- Add config values in `settings.json`:
  - `defaultWidgetsInstalled`, `endlessCanvas` settings.

### 4.3 Engine updates
- Layout manager supports endless panning coordinate transform before actor binding.
- `widget-engine` attaches to large scroll container and updates actor global transform.
- Manage active viewport with threshold to load/unload off-screen widgets for perf.

## 5) Roadmap + milestones (v2)
1. Implement default library data + UI insert/import.
2. Implement export-to-zip mechanics and sample package generation.
3. Implement endless monitor mode pivot (canvas transforms + panning controls).
4. Add per-widget persistence for endless coordinates and auto-resume.
5. Document in README and user guide (v2 release notes).

## 6) Testing
- Unit tests for loader + exporter paths.
- UI tests for library add/remove, export, endless panning+widget save/restore.
- Performance tests with 100+ widgets in endless mode (cull off-screen).

## 7) Notes
- Policy: maintain sandbox compatibility for default widgets.
- Exported sample sets should avoid requiring privileged APIs unless explicitly granted.
