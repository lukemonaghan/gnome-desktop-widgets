// Network Throughput Widget
// Live download/upload speed, summed over every interface except loopback
// (read from /proc/net/dev once a second), with a 60 second graph for each.

var UI;
var T;
var HISTORY = 60;
var prev = null;
var down = { history: [] };
var up = { history: [] };
var scale = 1;
var bits = false;    // show bits per second instead of bytes

function formatRate(bytes) {
  if (bits) {
    var b = bytes * 8;
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' Mb/s';
    if (b >= 1e3) return (b / 1e3).toFixed(1) + ' kb/s';
    return Math.round(b) + ' b/s';
  }
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB/s';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB/s';
  return Math.round(bytes) + ' B/s';
}

function readTotals(ctx) {
  try {
    var res = ctx.GLib.file_get_contents('/proc/net/dev');
    if (!res[0]) return null;
    var rx = 0;
    var tx = 0;
    var lines = new TextDecoder().decode(res[1]).split('\n').slice(2);
    lines.forEach(function (line) {
      var parts = line.split(':');
      if (parts.length < 2 || parts[0].trim() === 'lo') return;
      var f = parts[1].trim().split(/\s+/).map(Number);
      rx += f[0] || 0;
      tx += f[8] || 0;
    });
    return { rx: rx, tx: tx };
  } catch (e) {
    return null;
  }
}

// One direction: an arrow, a caption and rate on the left, the graph on the right
function makeRow(ctx, side, title, icon, color) {
  var St = ctx.St;
  var row = new St.BoxLayout({ x_expand: true, y_expand: true, style: 'spacing: 12px;' });

  side.icon = new St.Icon({
    icon_name: icon, icon_size: 16, y_align: ctx.Clutter.ActorAlign.CENTER,
    style: 'color: ' + color + ';',
  });
  side.text = new St.BoxLayout({ vertical: true, y_align: ctx.Clutter.ActorAlign.CENTER, width: 84 });
  var text = side.text;
  side.caption = UI.label(title, T.caption);
  text.add_child(side.caption);
  side.rate = UI.label('--', '');
  text.add_child(side.rate);
  side.graph = UI.sparkline({ height: 16, color: color, y_expand: true, y_align: ctx.Clutter.ActorAlign.FILL });

  row.add_child(side.icon);
  row.add_child(text);
  row.add_child(side.graph);
  return row;
}

function push(side, value) {
  side.history.push(value);
  if (side.history.length > HISTORY) side.history.shift();
  side.rate.text = formatRate(value);
  // Scale to the recent peak, but never let an idle line look like a storm
  var peak = Math.max.apply(null, side.history.concat([10240]));
  side.graph.setValues(side.history.length < 2 ? [0, value] : side.history, peak);
}

function render(ctx, api) {
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel);
  prev = null;
  down = { history: [] };
  up = { history: [] };
  bits = api.state.get('bits') === true;

  ctx.box.add_child(makeRow(ctx, down, 'DOWNLOAD', 'go-down-symbolic', T.accent.teal));
  ctx.box.add_child(makeRow(ctx, up, 'UPLOAD', 'go-up-symbolic', T.accent.orange));
  layout(288, 160);

  api.menu.set(function () {
    return [
      { label: 'Bits per second', checked: bits,
        onSelect: function () { bits = !bits; api.state.set('bits', bits); } },
      { label: 'Clear graphs', onSelect: function () {
        down.history = [];
        up.history = [];
        down.graph.setValues([]);
        up.graph.setValues([]);
      } },
      { separator: true },
      { label: 'Network settings', enabled: appInstalled(ctx, 'org.gnome.Settings.desktop'),
        onSelect: function () { openApp(ctx, api, 'org.gnome.Settings.desktop'); } },
    ];
  });
}

// Open a desktop app by its .desktop id, if it is installed
function appInstalled(ctx, id) {
  try { return !!ctx.Gio.DesktopAppInfo.new(id); } catch (e) { return false; }
}

function openApp(ctx, api, id) {
  try {
    var info = ctx.Gio.DesktopAppInfo.new(id);
    if (info) info.launch([], null);
  } catch (e) {
    api.widget.log('Cannot open ' + id + ': ' + e);
  }
}

function layout(w, h) {
  scale = UI.scale(w, h, 288, 160);
  [down, up].forEach(function (side) {
    side.icon.icon_size = Math.round(16 * scale);
    side.text.set_width(Math.round(84 * scale));
    side.caption.set_style(T.caption + ' ' + UI.pt(8, scale));
    side.rate.set_style(UI.pt(11, scale) + ' font-weight: bold;');
  });
}

function onResize(ctx, api, w, h) {
  layout(w, h);
}

function update(ctx, api) {
  var now = readTotals(ctx);
  if (!now) {
    down.rate.text = up.rate.text = 'n/a';
    return;
  }
  if (prev) {
    // Counters reset if an interface disappears; never show negative speeds
    push(down, Math.max(0, now.rx - prev.rx));
    push(up, Math.max(0, now.tx - prev.tx));
  }
  prev = now;
}
