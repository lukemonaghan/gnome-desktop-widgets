// System Monitor Widget
// CPU with a 60 second history graph, plus clock speed, temperature, load
// average, memory, swap, disk and uptime. Every stat can be switched off from
// the right-click menu, and the widget grows or shrinks to fit what is shown.

var UI;
var T;
var C;                 // the ctx, for restyling from onResize
var HISTORY = 60;
var DESIGN_W = 288;
var CHROME = 30;       // card padding and border, which do not scale
var GAP = 8;           // space between stats
var scale = 1;
var cpuHistory = [];
var cpuCount = 1;
var tempPath = null;
var rows = {};

// kind: graph (title, value, history graph), bar (title, value, bar) or
// stat (title and value only). h is the design height in px.
var ROWS = [
  { id: 'cpu', kind: 'graph', h: 64, on: true, title: 'CPU', menu: 'CPU usage', color: 'green', update: updateCpu },
  { id: 'freq', kind: 'stat', h: 24, on: false, title: 'CLOCK SPEED', menu: 'Clock speed', update: updateFreq },
  { id: 'temp', kind: 'stat', h: 24, on: true, title: 'TEMPERATURE', menu: 'Temperature', update: updateTemp },
  { id: 'load', kind: 'stat', h: 24, on: true, title: 'LOAD AVERAGE', menu: 'Load average', update: updateLoad },
  { id: 'memory', kind: 'bar', h: 36, on: true, title: 'MEMORY', menu: 'Memory', color: 'blue', update: updateMemory },
  { id: 'swap', kind: 'bar', h: 36, on: true, title: 'SWAP', menu: 'Swap', color: 'purple', update: updateSwap },
  { id: 'disk', kind: 'bar', h: 36, on: false, title: 'DISK', menu: 'Disk', color: 'teal', update: updateDisk },
  { id: 'uptime', kind: 'stat', h: 24, on: false, title: 'UPTIME', menu: 'Uptime', update: updateUptime },
];

// Green when idle, warming to orange and red under load
function loadColor(pct) {
  return pct < 60 ? T.accent.green : pct < 85 ? T.accent.orange : T.accent.red;
}

function readText(path) {
  try {
    var res = C.GLib.file_get_contents(path);
    return res[0] ? new TextDecoder().decode(res[1]) : null;
  } catch (e) {
    return null;
  }
}

// Gigabytes from a size in gigabytes, with a decimal only while it helps
function gb(g) {
  return g >= 100 ? String(Math.round(g)) : g.toFixed(1);
}

function usage(usedGb, totalGb) {
  return gb(usedGb) + ' / ' + gb(totalGb) + ' GB';
}

// The CPU package temperature sensor: hwmon first, then a thermal zone
function findTempPath() {
  try {
    var dir = C.GLib.Dir.open('/sys/class/hwmon', 0);
    var name;
    while ((name = dir.read_name()) !== null) {
      var sensor = (readText('/sys/class/hwmon/' + name + '/name') || '').trim();
      if (['coretemp', 'k10temp', 'zenpower', 'cpu_thermal'].indexOf(sensor) >= 0)
        return '/sys/class/hwmon/' + name + '/temp1_input';
    }
  } catch (e) { /* no hwmon */ }
  try {
    var zones = C.GLib.Dir.open('/sys/class/thermal', 0);
    var zone;
    while ((zone = zones.read_name()) !== null) {
      if (zone.indexOf('thermal_zone') !== 0) continue;
      var type = (readText('/sys/class/thermal/' + zone + '/type') || '').trim();
      if (type === 'x86_pkg_temp') return '/sys/class/thermal/' + zone + '/temp';
    }
  } catch (e) { /* no thermal zones */ }
  return null;
}

function buildRow(def) {
  var St = C.St;
  var row = { def: def, color: '' };
  row.actor = new St.BoxLayout({
    vertical: true, x_expand: true, y_expand: def.kind === 'graph', style: 'spacing: 6px;',
  });
  var head = new St.BoxLayout({ x_expand: true });
  row.title = UI.label(def.title, T.caption, { x_expand: true });
  row.value = UI.label('--', '');
  head.add_child(row.title);
  head.add_child(row.value);
  row.actor.add_child(head);

  if (def.kind === 'graph') {
    row.graph = UI.sparkline({ height: 36, max: 100, color: T.accent[def.color], y_expand: true });
    row.actor.add_child(row.graph);
  } else if (def.kind === 'bar') {
    row.bar = UI.bar({ height: 8, color: T.accent[def.color] });
    row.actor.add_child(row.bar);
  }
  return row;
}

function setValue(row, text, color) {
  row.value.text = text;
  row.color = color || '';
  styleValue(row);
}

function styleValue(row) {
  row.value.set_style(UI.pt(10, scale) + ' font-weight: bold;' + (row.color ? ' color: ' + row.color + ';' : ''));
}

function setBar(row, fraction, text) {
  row.value.text = text;
  row.bar.setValue(fraction, fraction < 0.85 ? T.accent[row.def.color] : T.accent.red);
}

function visibleRows() {
  return ROWS.filter(function (def) { return def.on; });
}

// Height of the widget at design scale with the stats now shown
function designHeight() {
  var shown = visibleRows();
  var h = CHROME;
  shown.forEach(function (def) { h += def.h; });
  return h + GAP * Math.max(0, shown.length - 1);
}

function layout(w, h) {
  scale = UI.scale(w, h, DESIGN_W, designHeight());
  C.setStyle(T.panel + ' spacing: ' + Math.round(GAP * scale) + 'px;');
  ROWS.forEach(function (def) {
    var row = rows[def.id];
    row.title.set_style(T.caption + ' ' + UI.pt(8, scale));
    styleValue(row);
    if (row.bar) row.bar.resize(Math.max(5, Math.round(8 * scale)));
  });
}

// Show or hide each stat; fit the widget to them when the user just changed one
function applyVisibility(api, refit) {
  ROWS.forEach(function (def) { rows[def.id].actor.visible = def.on; });
  var size = api.widget.getLayout();
  if (refit) {
    var s = Math.max(0.5, Math.min(4, size.width / DESIGN_W));
    size = { width: size.width, height: Math.round(CHROME + (designHeight() - CHROME) * s) };
    api.widget.setSize(size.width, size.height);
  }
  layout(size.width, size.height);
}

function toggle(api, def) {
  def.on = !def.on;
  var shown = {};
  ROWS.forEach(function (d) { shown[d.id] = d.on; });
  api.state.set('show', shown);
  applyVisibility(api, true);
}

function render(ctx, api) {
  C = ctx;
  UI = ctx.ui;
  T = UI.theme;
  cpuHistory = [];
  rows = {};
  cpuCount = ctx.GLib.get_num_processors();
  tempPath = findTempPath();

  // Older versions only stored whether memory was shown
  var saved = api.state.get('show') || {};
  if (!('memory' in saved) && api.state.get('memory') === false) saved.memory = false;

  ROWS.forEach(function (def) {
    if (def.id in saved) def.on = !!saved[def.id];
    rows[def.id] = buildRow(def);
    ctx.box.add_child(rows[def.id].actor);
  });
  applyVisibility(api, false);

  api.menu.set(function () {
    var count = visibleRows().length;
    var items = ROWS.map(function (def) {
      return {
        label: 'Show ' + def.menu.charAt(0).toLowerCase() + def.menu.slice(1), checked: def.on,
        enabled: !def.on || count > 1,
        onSelect: function () { toggle(api, def); },
      };
    });
    items.push({ separator: true });
    items.push({
      label: 'Open System Monitor', enabled: appInstalled(ctx, 'org.gnome.SystemMonitor.desktop'),
      onSelect: function () { openApp(ctx, api, 'org.gnome.SystemMonitor.desktop'); },
    });
    return items;
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

function onResize(ctx, api, w, h) {
  layout(w, h);
}

function updateCpu(api, row) {
  var cpu = api.system.cpu();
  if (cpu == null) return;
  setValue(row, Math.round(cpu) + '%', loadColor(cpu));
  row.graph.setValues(cpuHistory.length < 2 ? [0, cpu] : cpuHistory);
}

function updateFreq(api, row) {
  var text = readText('/proc/cpuinfo');
  if (!text) return setValue(row, 'n/a');
  var total = 0;
  var n = 0;
  var re = /^cpu MHz\s*:\s*([\d.]+)/gm;
  var m;
  while ((m = re.exec(text)) !== null) { total += parseFloat(m[1]); n++; }
  setValue(row, n ? (total / n / 1000).toFixed(2) + ' GHz' : 'n/a');
}

function updateTemp(api, row) {
  var text = tempPath ? readText(tempPath) : null;
  var deg = text ? parseInt(text, 10) / 1000 : NaN;
  if (!isFinite(deg)) return setValue(row, 'n/a');
  // 45 C is calm, 90 C is hot: map that onto the usual green-to-red scale
  setValue(row, Math.round(deg) + ' °C', loadColor(Math.max(0, (deg - 30) / 60 * 100)));
}

function updateLoad(api, row) {
  var text = readText('/proc/loadavg');
  if (!text) return setValue(row, 'n/a');
  var f = text.split(' ').slice(0, 3).map(parseFloat);
  setValue(row, f.map(function (v) { return v.toFixed(2); }).join(' · '), loadColor(f[0] / cpuCount * 100));
}

function updateMemory(api, row) {
  var mem = api.system.memory();
  if (mem == null) return;
  setBar(row, mem.usedPercent / 100, usage(mem.used / 1048576, mem.total / 1048576));
}

function updateSwap(api, row) {
  var text = readText('/proc/meminfo');
  var total = text && /^SwapTotal:\s*(\d+)/m.exec(text);
  var free = text && /^SwapFree:\s*(\d+)/m.exec(text);
  if (!total || !free) return setValue(row, 'n/a');
  var t = parseInt(total[1], 10);
  var used = t - parseInt(free[1], 10);
  if (!t) return setBar(row, 0, 'none');
  setBar(row, used / t, usage(used / 1048576, t / 1048576));
}

function updateDisk(api, row) {
  try {
    var info = C.Gio.File.new_for_path('/').query_filesystem_info('filesystem::size,filesystem::free', null);
    var size = info.get_attribute_uint64('filesystem::size');
    var used = size - info.get_attribute_uint64('filesystem::free');
    setBar(row, size ? used / size : 0, usage(used / 1073741824, size / 1073741824));
  } catch (e) {
    setValue(row, 'n/a');
  }
}

function updateUptime(api, row) {
  var text = readText('/proc/uptime');
  var s = text ? parseFloat(text) : NaN;
  if (!isFinite(s)) return setValue(row, 'n/a');
  var d = Math.floor(s / 86400);
  var h = Math.floor(s % 86400 / 3600);
  var m = Math.floor(s % 3600 / 60);
  setValue(row, d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm');
}

function update(ctx, api) {
  // Keep the history running while the graph is hidden, so it is not empty when shown again
  var cpu = api.system.cpu();
  if (cpu != null) {
    cpuHistory.push(cpu);
    if (cpuHistory.length > HISTORY) cpuHistory.shift();
  }
  ROWS.forEach(function (def) {
    if (def.on) def.update(api, rows[def.id]);
  });
}
