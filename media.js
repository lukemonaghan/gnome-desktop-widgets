import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Now-playing information and transport control for whatever media player is
// running, through MPRIS (org.mpris.MediaPlayer2.*) on the session bus. Exposed
// to widgets as api.media (permission "media"). Kept free of Shell imports.
//
// One shared poller serves every widget: it asks the bus once a second while at
// least one widget is subscribed. Nothing here blocks; every call is async.

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const PROPS = 'org.freedesktop.DBus.Properties';

const POLL_MS = 1000;

const poller = {
  _subscribers: new Set(),
  _timerId: 0,
  _busy: false,
  _snapshot: null,      // last reading, see _read()
  _takenAt: 0,          // when it was taken, to carry Position forward

  subscribe(owner) {
    this._subscribers.add(owner);
    if (this._timerId) return;
    this._poll();
    this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
      this._poll();
      return GLib.SOURCE_CONTINUE;
    });
  },

  unsubscribe(owner) {
    this._subscribers.delete(owner);
    if (this._subscribers.size > 0 || !this._timerId) return;
    GLib.source_remove(this._timerId);
    this._timerId = 0;
    this._snapshot = null;
  },

  // What is on now: the playing player, else the first one there is
  current() {
    const s = this._snapshot;
    if (!s) return null;
    let position = s.position;
    if (s.status === 'Playing') {
      position += (GLib.get_monotonic_time() - this._takenAt) / 1e6;
      if (s.length > 0) position = Math.min(position, s.length);
    }
    return { ...s, position };
  },

  _poll() {
    if (this._busy) return;
    this._busy = true;
    const done = (snapshot) => {
      this._busy = false;
      this._snapshot = snapshot;
      this._takenAt = GLib.get_monotonic_time();
    };

    Gio.DBus.session.call(
      'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
      null, null, Gio.DBusCallFlags.NONE, 1000, null,
      (conn, res) => {
        let names = [];
        try {
          names = conn.call_finish(res).deepUnpack()[0].filter((n) => n.startsWith(PREFIX));
        } catch (e) {
          done(null);
          return;
        }
        this._readAll(names, done);
      });
  },

  // Read every player, keep the one that is playing (or the first)
  _readAll(names, done) {
    if (names.length === 0) { done(null); return; }
    const found = [];
    let pending = names.length;
    names.forEach((name) => {
      Gio.DBus.session.call(
        name, PATH, PROPS, 'GetAll', new GLib.Variant('(s)', [PLAYER]), null,
        Gio.DBusCallFlags.NONE, 1000, null,
        (conn, res) => {
          try {
            const props = conn.call_finish(res).recursiveUnpack()[0];
            found.push(this._read(name, props));
          } catch (e) { /* player went away mid-poll */ }
          if (--pending > 0) return;
          found.sort((a, b) => a.name.localeCompare(b.name));
          done(found.find((p) => p.status === 'Playing') ?? found.find((p) => p.status === 'Paused') ??
            found[0] ?? null);
        });
    });
  },

  _read(name, props) {
    const meta = props.Metadata ?? {};
    const artists = meta['xesam:artist'];
    return {
      name,
      player: name.slice(PREFIX.length).replace(/\.instance\d+$/, ''),
      status: props.PlaybackStatus ?? 'Stopped',
      title: meta['xesam:title'] ?? '',
      artist: Array.isArray(artists) ? artists.join(', ') : (artists ?? ''),
      album: meta['xesam:album'] ?? '',
      artUrl: meta['mpris:artUrl'] ?? '',
      length: Number(meta['mpris:length'] ?? 0) / 1e6,
      position: Number(props.Position ?? 0) / 1e6,
      canPrevious: !!props.CanGoPrevious,
      canNext: !!props.CanGoNext,
      canPlay: props.CanPlay !== false,
    };
  },

  command(method, iface = PLAYER) {
    const target = this._snapshot?.name;
    if (!target) return;
    Gio.DBus.session.call(
      target, PATH, iface, method, null, null, Gio.DBusCallFlags.NONE, 1000, null,
      (conn, res) => {
        try { conn.call_finish(res); } catch (e) {
          log(`DesktopWidgets media ${method} failed: ${e.message}`);
        }
        // Show the new state without waiting for the next tick
        this._busy = false;
        this._poll();
      });
  },
};

// The media half of the widget API. One per widget; stop() drops its
// subscription when the widget stops.
export class WidgetMedia {
  constructor() {
    this._subscribed = false;
  }

  stop() {
    if (!this._subscribed) return;
    this._subscribed = false;
    poller.unsubscribe(this);
  }

  api() {
    const use = () => {
      if (this._subscribed) return;
      this._subscribed = true;
      poller.subscribe(this);
    };
    return {
      // { player, status: 'Playing'|'Paused'|'Stopped', title, artist, album,
      //   artUrl, length, position (seconds), canPrevious, canNext, canPlay },
      // or null when no player is running. The first call starts the polling
      // (and returns null until the first reading arrives).
      get: () => { use(); return poller.current(); },
      playPause: () => poller.command('PlayPause'),
      next: () => poller.command('Next'),
      previous: () => poller.command('Previous'),
      // Bring the player's window to the front
      raise: () => poller.command('Raise', 'org.mpris.MediaPlayer2'),
    };
  }
}
