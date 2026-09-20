import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { getRegistry } from './store.js';

// Resolve the extension's own directory from this module's URL
const EXTENSION_DIR = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const DEFAULT_WIDGETS_SRC = `${EXTENSION_DIR}/default-widgets`;

function _readFile(path) {
  const file = Gio.File.new_for_path(path);
  if (!file.query_exists(null)) return null;
  const [ok, contents] = file.load_contents(null);
  if (!ok) return null;
  return new TextDecoder().decode(contents);
}

function _writeFile(path, content) {
  const f = Gio.File.new_for_path(path);
  f.replace_contents(content, null, false, Gio.FileCreateFlags.NONE, null);
}

function _scanDefaultWidgets() {
  const widgets = [];
  const srcDir = Gio.File.new_for_path(DEFAULT_WIDGETS_SRC);
  if (!srcDir.query_exists(null)) return widgets;

  const enumerator = srcDir.enumerate_children(
    'standard::name,standard::type',
    Gio.FileQueryInfoFlags.NONE,
    null
  );

  let info;
  while ((info = enumerator.next_file(null))) {
    if (info.get_file_type() !== Gio.FileType.DIRECTORY) continue;

    const name = info.get_name();
    const metadataPath = `${DEFAULT_WIDGETS_SRC}/${name}/metadata.json`;
    const raw = _readFile(metadataPath);
    if (!raw) continue;

    try {
      const metadata = JSON.parse(raw);
      metadata._srcDir = `${DEFAULT_WIDGETS_SRC}/${name}`;
      widgets.push(metadata);
    } catch (e) {
      log(`DesktopWidgets: failed to parse ${metadataPath}: ${e}`);
    }
  }

  return widgets;
}

export function getDefaultWidgets() {
  return _scanDefaultWidgets();
}

// Bump when the bundled widgets change (script API, geometry, ...) so already
// installed copies are refreshed on the next enable.
const DEFAULTS_VERSION = '5';

export function installDefaultWidgets() {
  const registry = getRegistry();
  const installedKey = `${GLib.get_user_data_dir()}/gnome-desktop-widgets/.default-installed`;
  if (_readFile(installedKey) === DEFAULTS_VERSION)
    return registry.getAllWidgets().filter((w) => w.widgetSource === 'default');

  const destRoot = `${GLib.get_user_data_dir()}/gnome-desktop-widgets/default-library/widgets`;
  const rootDir = Gio.File.new_for_path(destRoot);
  if (!rootDir.query_exists(null)) {
    rootDir.make_directory_with_parents(null);
  }

  for (const widget of _scanDefaultWidgets()) {
    const srcDir = widget._srcDir;
    const widgetDir = `${destRoot}/${widget.id}`;
    const widgetDirFile = Gio.File.new_for_path(widgetDir);
    if (!widgetDirFile.query_exists(null)) {
      widgetDirFile.make_directory_with_parents(null);
    }

    // Keep the user's choice of which widgets are on
    const existing = registry.getWidget(widget.id);

    // Copy metadata as widget.json (without internal _srcDir field)
    const manifest = { ...widget, widgetSource: 'default' };
    delete manifest._srcDir;
    if (existing) manifest.enabled = existing.enabled;
    _writeFile(`${widgetDir}/widget.json`, JSON.stringify(manifest, null, 2));

    // Copy the index.js script as widget.js
    const scriptName = widget.script || 'index.js';
    const scriptSrc = _readFile(`${srcDir}/${scriptName}`);
    if (scriptSrc) {
      _writeFile(`${widgetDir}/widget.js`, scriptSrc);
    }

    const widgetCopy = {
      ...manifest,
      script: 'widget.js',
      installedPath: widgetDir,
      sourcePath: widgetDir,
    };
    registry.setWidget(widgetCopy.id, widgetCopy);
  }

  _writeFile(installedKey, DEFAULTS_VERSION);

  return registry.getAllWidgets().filter((w) => w.widgetSource === 'default');
}
