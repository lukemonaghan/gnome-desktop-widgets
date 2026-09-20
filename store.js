import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const APP_ID = 'gnome-desktop-widgets';
const USER_DATA_DIR = GLib.get_user_data_dir();
const BASE_PATH = `${USER_DATA_DIR}/${APP_ID}`;
const WIDGETS_DIR = `${BASE_PATH}/widgets`;
const REGISTRY_PATH = `${BASE_PATH}/registry.json`;

function _deleteRecursive(file) {
  if (!file.query_exists(null)) return;
  const type = file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  if (type === Gio.FileType.DIRECTORY) {
    const enumerator = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = enumerator.next_file(null))) {
      _deleteRecursive(file.get_child(info.get_name()));
    }
  }
  file.delete(null);
}

function _ensureDirectory(path) {
  const file = Gio.File.new_for_path(path);
  if (!file.query_exists(null)) {
    file.make_directory_with_parents(null);
  }
  return file;
}

function _readJSON(path) {
  const file = Gio.File.new_for_path(path);
  if (!file.query_exists(null))
    return null;

  try {
    const [success, contents] = file.load_contents(null);
    if (!success) return null;
    const raw = new TextDecoder().decode(contents);
    return JSON.parse(raw);
  } catch (e) {
    log(`DesktopWidgets store: failed to read ${path}: ${e}`);
    return null;
  }
}

function _writeJSON(path, obj) {
  const file = Gio.File.new_for_path(path);
  const data = JSON.stringify(obj, null, 2);
  try {
    file.replace_contents(data, null, false, Gio.FileCreateFlags.NONE, null);
  } catch (e) {
    log(`DesktopWidgets store: failed to write ${path}: ${e}`);
  }
}

export class WidgetRegistry {
  constructor() {
    _ensureDirectory(BASE_PATH);
    _ensureDirectory(WIDGETS_DIR);
    this._widgets = {};
    this._load();
  }

  _load() {
    const saved = _readJSON(REGISTRY_PATH);
    if (saved && saved.widgets) {
      this._widgets = saved.widgets;
    } else {
      this._widgets = {};
      this._save();
    }
  }

  _save() {
    _writeJSON(REGISTRY_PATH, { widgets: this._widgets });
  }

  // Re-read registry.json (another process, e.g. prefs, may have changed it).
  reload() {
    const saved = _readJSON(REGISTRY_PATH);
    if (saved && saved.widgets) this._widgets = saved.widgets;
  }

  getPath() {
    return REGISTRY_PATH;
  }

  getAllWidgets() {
    return Object.values(this._widgets);
  }

  getWidget(id) {
    return this._widgets[id] || null;
  }

  setWidget(id, widgetInfo) {
    const existing = this._widgets[id] || {};
    const history = existing.history ? existing.history.slice() : [];
    const snapshot = JSON.parse(JSON.stringify(widgetInfo));
    snapshot.timestamp = Date.now();
    if (existing.id) {
      history.push(snapshot);
    }

    this._widgets[id] = { ...widgetInfo, history };
    this._save();
  }

  getWidgetHistory(id) {
    const widget = this._widgets[id];
    if (!widget) return [];
    return widget.history || [];
  }

  rollbackWidget(id, index = null) {
    const widget = this._widgets[id];
    if (!widget || !widget.history || widget.history.length === 0) {
      throw new Error(`No history available for widget ${id}`);
    }

    let entry;
    if (index === null) {
      entry = widget.history[widget.history.length - 1];
    } else {
      if (index < 0 || index >= widget.history.length) {
        throw new Error(`Invalid history index ${index} for widget ${id}`);
      }
      entry = widget.history[index];
    }

    const manifestCopy = JSON.parse(JSON.stringify(entry));
    delete manifestCopy.timestamp;

    // preserve installed location + enabled flag defaults
    manifestCopy.installedPath = widget.installedPath;
    manifestCopy.sourcePath = widget.sourcePath;
    manifestCopy.enabled = widget.enabled;

    this._widgets[id] = { ...manifestCopy, history: widget.history };
    this._save();
    return this._widgets[id];
  }

  removeWidget(id) {
    const widget = this._widgets[id];
    delete this._widgets[id];

    // Clones share their original's script folder; only delete it once
    // nothing else in the registry still points at it.
    const shared = widget?.installedPath &&
      this.getAllWidgets().some((w) => w.installedPath === widget.installedPath);
    if (widget && widget.installedPath && !shared)
      _deleteRecursive(Gio.File.new_for_path(widget.installedPath));

    // Per-widget saved state (state.json etc.)
    _deleteRecursive(Gio.File.new_for_path(`${WIDGETS_DIR}/${id}`));
    this._save();
  }

  // The id of the widget a clone was made from (or the widget's own id).
  getFamilyId(id) {
    const widget = this._widgets[id];
    return widget?.cloneOf || id;
  }

  // Every widget in the same family, the original included.
  getFamily(id) {
    const familyId = this.getFamilyId(id);
    return this.getAllWidgets().filter((w) => (w.cloneOf || w.id) === familyId);
  }

  // Create another instance of a widget that shares its script but has its
  // own id, state and position. Used for things like multiple sticky notes.
  cloneWidget(sourceId, overrides = {}) {
    const familyId = this.getFamilyId(sourceId);
    const base = this._widgets[familyId] || this._widgets[sourceId];
    if (!base) throw new Error(`Widget ${sourceId} not found`);

    let n = 2;
    while (this._widgets[`${familyId}-${n}`]) n++;

    const clone = JSON.parse(JSON.stringify(base));
    delete clone.history;
    clone.id = `${familyId}-${n}`;
    clone.cloneOf = familyId;
    clone.display_name = `${(base.display_name || familyId).replace(/ \d+$/, '')} ${n}`;
    clone.enabled = true;
    clone.x = overrides.x ?? (base.x || 0) + 30 * (n - 1);
    clone.y = overrides.y ?? (base.y || 0) + 30 * (n - 1);
    if (overrides.width) clone.width = overrides.width;
    if (overrides.height) clone.height = overrides.height;

    this.setWidget(clone.id, clone);
    return this._widgets[clone.id];
  }

  exportWidget(id, outputPath) {
    const widget = this.getWidget(id);
    if (!widget || !widget.installedPath) {
      throw new Error(`Widget ${id} not found or not installed`);
    }
    const sourceDir = Gio.File.new_for_path(widget.installedPath);
    if (!sourceDir.query_exists(null)) {
      throw new Error(`Widget install path ${widget.installedPath} not found`);
    }

    const tmpDir = GLib.dir_make_tmp('gnome-desktop-widgets-export-XXXXXX', null);
    const tmpWidgetDir = `${tmpDir}/${widget.id}`;
    const tmpWidgetDirFile = Gio.File.new_for_path(tmpWidgetDir);
    tmpWidgetDirFile.make_directory_with_parents(null);

    const manifestSrc = sourceDir.get_child('widget.json');
    const scriptSrc = sourceDir.get_child(widget.script || 'widget.js');

    if (manifestSrc.query_exists(null)) {
      manifestSrc.copy(tmpWidgetDirFile.get_child('widget.json'), Gio.FileCopyFlags.OVERWRITE, null, null, null);
    }

    if (scriptSrc.query_exists(null)) {
      scriptSrc.copy(tmpWidgetDirFile.get_child(widget.script || 'widget.js'), Gio.FileCopyFlags.OVERWRITE, null, null, null);
    }

    // include assets folder if present
    const assetsSrc = sourceDir.get_child('assets');
    if (assetsSrc.query_exists(null)) {
      // copy asset directory recursively
      const copyRecursively = (srcDir, dstDir) => {
        if (!dstDir.query_exists(null)) dstDir.make_directory_with_parents(null);
        const enumerator = srcDir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null))) {
          const name = info.get_name();
          const childSrc = srcDir.get_child(name);
          const childDst = dstDir.get_child(name);
          if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            copyRecursively(childSrc, childDst);
          } else {
            childSrc.copy(childDst, Gio.FileCopyFlags.OVERWRITE, null, null, null);
          }
        }
      };
      copyRecursively(assetsSrc, tmpWidgetDirFile.get_child('assets'));
    }
    const absOutput = GLib.build_filenamev([GLib.get_home_dir(), outputPath]);
    const command = `tar -czf ${GLib.shell_quote(absOutput)} -C ${GLib.shell_quote(tmpDir)} ${GLib.shell_quote(widget.id)}`;
    const [success, stdout, stderr, exit] = GLib.spawn_command_line_sync(command);
    if (!success || exit !== 0) {
      throw new Error(`Failed to export widget ${id}: ${stderr}`);
    }
    return absOutput;
  }

  setEnabled(id, enabled) {
    if (this._widgets[id]) {
      this._widgets[id].enabled = enabled;
      this._save();
    }
  }

  getWidgetsDir() {
    return WIDGETS_DIR;
  }

  getWidgetContentPath(id) {
    return `${WIDGETS_DIR}/${id}`;
  }

  exportLibrary(outputPath) {
    const widgets = this.getAllWidgets().filter((w) => w.widgetSource === 'default');
    if (widgets.length === 0) {
      throw new Error('No default library widgets available to export');
    }

    const tmpDir = GLib.dir_make_tmp('gnome-desktop-widgets-lib-XXXXXX', null);
    if (!tmpDir) {
      throw new Error('Unable to create temporary directory for export');
    }

    for (const widget of widgets) {
      const widgetDir = `${tmpDir}/${widget.id}`;
      const dirFile = Gio.File.new_for_path(widgetDir);
      dirFile.make_directory_with_parents(null);
      const manifestPath = `${widgetDir}/widget.json`;
      const manifestFile = Gio.File.new_for_path(manifestPath);
      manifestFile.replace_contents(JSON.stringify(widget, null, 2), null, false, Gio.FileCreateFlags.NONE, null);
      // no template/script/assets for builtin module placeholder
    }

    const absOutput = GLib.build_filenamev([GLib.get_home_dir(), outputPath]);
    const command = `tar -czf ${GLib.shell_quote(absOutput)} -C ${GLib.shell_quote(tmpDir)} .`;
    const [success, stdout, stderr, exit] = GLib.spawn_command_line_sync(command);
    if (!success || exit !== 0) {
      throw new Error(`Failed to export default library: ${stderr}`);
    }

    return absOutput;
  }

  addWidget(manifest, sourcePath) {
    if (!manifest || !manifest.id) {
      throw new Error('Invalid manifest. id is required');
    }
    const id = manifest.id;
    const widgetDir = `${WIDGETS_DIR}/${id}`;
    const widgetDirFile = Gio.File.new_for_path(widgetDir);

    if (widgetDirFile.query_exists(null)) {
      // overwrite by deleting recursively first
      _deleteRecursive(widgetDirFile);
    }

    const sourceFile = Gio.File.new_for_path(sourcePath);
    sourceFile.copy(widgetDirFile, Gio.FileCopyFlags.ALL_METADATA, null, null, null);

    manifest.enabled = manifest.enabled !== false;
    manifest.sourcePath = sourcePath;
    manifest.installedPath = widgetDir;
    this._widgets[id] = manifest;
    this._save();
    return manifest;
  }
}

// Module-level singleton so all callers share one in-memory registry
// and avoid concurrent file writes.
let _registryInstance = null;
export function getRegistry() {
  if (!_registryInstance) {
    _registryInstance = new WidgetRegistry();
  }
  return _registryInstance;
}
