import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

// Kept free of Shell imports so it can be exercised with plain `gjs`.

const DEFAULT_USER_AGENT = 'gnome-desktop-widgets/1.0';
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const CACHE_KEEP_FILES = 100;

export function cacheDirFor(widgetId) {
  return `${GLib.get_user_cache_dir()}/gnome-desktop-widgets/${widgetId}`;
}

// The network half of the widget API. One per widget instance; cancelAll()
// aborts everything still in flight when the widget stops.
export class WidgetNetwork {
  constructor(widgetId, cacheDir = cacheDirFor(widgetId)) {
    this._id = widgetId;
    this._cacheDir = cacheDir;
    this._session = null;
    this._cancellable = null;
  }

  cancelAll() {
    this._cancellable?.cancel();
    this._cancellable = null;
  }

  destroy() {
    this.cancelAll();
    this._session = null;
  }

  api() {
    return {
      fetch: (url, options) => this._fetchSync(url, options),
      fetchJSON: (url, options) => {
        const result = this._fetchSync(url, options);
        if (!result.ok || !result.body) return null;
        try { return JSON.parse(result.body); } catch { return null; }
      },
      fetchAsync: (url, options, callback) => this._fetchAsync(url, options, callback),
      fetchJSONAsync: (url, options, callback) => this._fetchJSONAsync(url, options, callback),
      download: (url, options, callback) => this._download(url, options, callback),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────
  _getSession() {
    if (!this._session) this._session = new Soup.Session();
    return this._session;
  }

  _getCancellable() {
    if (!this._cancellable) this._cancellable = new Gio.Cancellable();
    return this._cancellable;
  }

  _message(url, options) {
    const message = Soup.Message.new((options && options.method) || 'GET', url);
    if (!message) return null;
    const headers = message.get_request_headers();
    headers.replace('User-Agent', DEFAULT_USER_AGENT);
    if (options && options.headers) {
      for (const [k, v] of Object.entries(options.headers))
        headers.replace(k, String(v));
    }
    return message;
  }

  // (options, callback) may be given as (callback) alone
  _args(options, callback) {
    return typeof options === 'function' ? [null, options] : [options, callback];
  }

  _deliver(callback, ...args) {
    if (typeof callback !== 'function') return;
    try {
      callback(...args);
    } catch (e) {
      log(`DesktopWidgets [${this._id}] network callback failed: ${e}`);
    }
  }

  // Always calls back from the main loop, never re-entrantly
  _later(fn) {
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { fn(); return GLib.SOURCE_REMOVE; });
  }

  // Sends the request; done({ ok, status, bytes }) is not called if the
  // widget stopped in the meantime.
  _send(url, options, done) {
    let message = null;
    try { message = this._message(url, options); } catch (e) {
      log(`DesktopWidgets [${this._id}] bad request ${url}: ${e}`);
    }
    if (!message) {
      this._later(() => done({ ok: false, status: 0, bytes: null }));
      return;
    }

    this._getSession().send_and_read_async(
      message, GLib.PRIORITY_DEFAULT, this._getCancellable(), (session, res) => {
        let bytes = null;
        try {
          bytes = session.send_and_read_finish(res);
        } catch (e) {
          if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
          log(`DesktopWidgets [${this._id}] request failed for ${url}: ${e}`);
          done({ ok: false, status: 0, bytes: null });
          return;
        }
        const status = message.get_status();
        done({ ok: status >= 200 && status < 300, status, bytes });
      });
  }

  // ── blocking (kept for simple scripts; freezes the shell while it runs) ──
  _fetchSync(url, options) {
    try {
      const message = this._message(url, options);
      if (!message) return { ok: false, status: 0, body: null };
      const bytes = this._getSession().send_and_read(message, null);
      const status = message.get_status();
      const body = bytes ? new TextDecoder().decode(bytes.get_data()) : '';
      return { ok: status >= 200 && status < 300, status, body };
    } catch (e) {
      log(`DesktopWidgets network fetch failed: ${e}`);
      return { ok: false, status: 0, body: null };
    }
  }

  // ── non-blocking ───────────────────────────────────────────────────
  _fetchAsync(url, options, callback) {
    [options, callback] = this._args(options, callback);
    this._send(url, options, ({ ok, status, bytes }) => {
      const body = bytes ? new TextDecoder().decode(bytes.get_data()) : null;
      this._deliver(callback, { ok, status, body });
    });
  }

  _fetchJSONAsync(url, options, callback) {
    [options, callback] = this._args(options, callback);
    this._fetchAsync(url, options, (result) => {
      let data = null;
      if (result.ok && result.body) {
        try { data = JSON.parse(result.body); } catch { data = null; }
      }
      this._deliver(callback, data, result);
    });
  }

  // Saves the response body in the widget's cache folder; callback gets
  // { ok, status, path, cached }. The same URL is only fetched once
  // (and the folder is shared by all copies of a widget).
  _download(url, options, callback) {
    [options, callback] = this._args(options, callback);

    const extension = (url.split('?')[0].match(/\.([A-Za-z0-9]{1,5})$/) || [])[1];
    const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1) +
      (extension ? `.${extension}` : '');
    const path = `${this._cacheDir}/${name}`;
    const file = Gio.File.new_for_path(path);

    if (file.query_exists(null)) {
      // Serving a file counts as using it, so pruning drops what is used least
      try {
        file.set_attribute_uint64('time::modified', Math.floor(GLib.get_real_time() / 1e6),
          Gio.FileQueryInfoFlags.NONE, null);
      } catch { /* a read-only cache still serves */ }
      this._later(() => this._deliver(callback, { ok: true, status: 200, path, cached: true }));
      return;
    }

    this._send(url, options, ({ ok, status, bytes }) => {
      if (!ok || !bytes || bytes.get_size() === 0 || bytes.get_size() > MAX_DOWNLOAD_BYTES) {
        this._deliver(callback, { ok: false, status, path: null, cached: false });
        return;
      }
      try {
        const dir = Gio.File.new_for_path(this._cacheDir);
        if (!dir.query_exists(null)) dir.make_directory_with_parents(null);
        // Write under a temporary name so a half-written file is never served
        const tmp = Gio.File.new_for_path(`${path}.part`);
        tmp.replace_contents(bytes.get_data(), null, false, Gio.FileCreateFlags.NONE, null);
        tmp.move(file, Gio.FileCopyFlags.OVERWRITE, null, null);
        this._prune();
      } catch (e) {
        log(`DesktopWidgets [${this._id}] cannot cache ${url}: ${e}`);
        this._deliver(callback, { ok: false, status, path: null, cached: false });
        return;
      }
      this._deliver(callback, { ok: true, status, path, cached: false });
    });
  }

  // Keep the cache folder from growing without bound: drop the oldest files
  _prune() {
    try {
      const dir = Gio.File.new_for_path(this._cacheDir);
      const en = dir.enumerate_children('standard::name,time::modified',
        Gio.FileQueryInfoFlags.NONE, null);
      const files = [];
      let info;
      while ((info = en.next_file(null)))
        files.push({ name: info.get_name(), time: info.get_modification_date_time().to_unix() });
      files.sort((a, b) => b.time - a.time);
      for (const f of files.slice(CACHE_KEEP_FILES))
        dir.get_child(f.name).delete(null);
    } catch (e) {
      log(`DesktopWidgets [${this._id}] cache prune failed: ${e}`);
    }
  }
}
