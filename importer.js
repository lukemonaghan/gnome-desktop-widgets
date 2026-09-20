import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { WidgetRegistry, getRegistry } from './store.js';

function _resolveManifest(folder) {
  const candidateFiles = ['widget.json', 'manifest.json'];
  for (const name of candidateFiles) {
    const path = `${folder}/${name}`;
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null)) {
      try {
        const [success, contents] = file.load_contents(null);
        if (!success) continue;
        const raw = new TextDecoder().decode(contents);
        return JSON.parse(raw);
      } catch (e) {
        log(`DesktopWidgets importer: failed to parse ${path}: ${e}`);
        throw e;
      }
    }
  }
  throw new Error('Manifest file(widget.json/manifest.json) not found');
}

function _copyFolderRecursive(srcPath, dstPath) {
  const src = Gio.File.new_for_path(srcPath);
  const dst = Gio.File.new_for_path(dstPath);

  if (!dst.query_exists(null)) {
    dst.make_directory_with_parents(null);
  }

  const enumerator = src.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
  let info;
  while ((info = enumerator.next_file(null))) {
    const name = info.get_name();
    const childSrc = src.get_child(name);
    const childDst = dst.get_child(name);
    const type = info.get_file_type();

    if (type === Gio.FileType.DIRECTORY) {
      _copyFolderRecursive(childSrc.get_path(), childDst.get_path());
    } else if (type === Gio.FileType.REGULAR || type === Gio.FileType.SYMBOLIC_LINK) {
      try {
        childSrc.copy(childDst, Gio.FileCopyFlags.OVERWRITE, null, null, null);
      } catch (e) {
        log(`DesktopWidgets importer: failed to copy ${childSrc.get_path()} to ${childDst.get_path()}: ${e}`);
      }
    }
  }
}

export function importFromFolder(folderPath) {
  const manifest = _resolveManifest(folderPath);
  if (!manifest.id || !manifest.display_name) {
    throw new Error('Manifest must include id and display_name.');
  }

  const registry = getRegistry();

  const destination = `${registry.getWidgetsDir()}/${manifest.id}`;
  _copyFolderRecursive(folderPath, destination);

  manifest.enabled = manifest.enabled !== false;
  manifest.trusted = manifest.trusted || folderPath.startsWith(GLib.get_home_dir());
  manifest.sourcePath = folderPath;
  manifest.installedPath = destination;
  registry.setWidget(manifest.id, manifest);

  return manifest;
}

export function validateFolder(folderPath) {
  try {
    _resolveManifest(folderPath);
    return true;
  } catch (_) {
    return false;
  }
}

export function importFromArchive(archivePath) {
  const temp = GLib.dir_make_tmp('gnome-desktop-widgets-XXXXXX', null);
  if (!temp) {
    throw new Error('Could not create temporary directory for archive import');
  }

  const extension = archivePath.split('.').pop().toLowerCase();
  let command;

  if (extension === 'zip') {
    command = `unzip -q ${GLib.shell_quote(archivePath)} -d ${GLib.shell_quote(temp)}`;
  } else if (extension === 'tar' || extension === 'tgz' || extension === 'tar.gz') {
    command = `tar -xzf ${GLib.shell_quote(archivePath)} -C ${GLib.shell_quote(temp)}`;
  } else {
    throw new Error('Unsupported archive format; use .zip/.tar/.tgz');
  }

  const [success, stdout, stderr, exit] = GLib.spawn_command_line_sync(command);
  if (!success || exit !== 0) {
    throw new Error(`Failed to unpack archive: ${stderr}`);
  }

  // assume root of temp is folder to import; if root has one folder, descend
  const tempDir = Gio.File.new_for_path(temp);
  const enumerator = tempDir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
  let entry;
  let candidate = temp;
  while ((entry = enumerator.next_file(null))) {
    if (entry.get_file_type() === Gio.FileType.DIRECTORY) {
      candidate = `${temp}/${entry.get_name()}`;
      break;
    }
  }

  return importFromFolder(candidate);
}

export function importFromRemote(uri) {
  const tempDir = GLib.dir_make_tmp('gnome-desktop-widgets-remote-XXXXXX', null);
  if (!tempDir) {
    throw new Error('Could not create temporary directory for remote import');
  }

  const tmpFile = `${tempDir}/download`; // no extension, determine from uri
  const command = `curl -L --fail -o ${GLib.shell_quote(tmpFile)} ${GLib.shell_quote(uri)}`;
  const [success, stdout, stderr, exit] = GLib.spawn_command_line_sync(command);
  if (!success || exit !== 0) {
    throw new Error(`Failed to download widget from URI: ${stderr}`);
  }

  let source = tmpFile;
  if (/\.(zip|tar|tgz|tar\.gz)(\?.*)?$/.test(uri)) {
    return importFromArchive(tmpFile);
  }

  // if remote URI points to a directory archive path? try import from extracted candidate
  try {
    return importFromArchive(tmpFile);
  } catch (e) {
    throw new Error(`Unsupported remote package format for URI ${uri}`);
  }
}
