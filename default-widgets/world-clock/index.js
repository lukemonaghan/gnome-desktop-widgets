// World Clock Widget
// One row per city: name and day offset on the left, the time on the right,
// and a dot showing whether it is daytime there.

var UI;
var T;
var rows = [];
var scale = 1;
var heading;
var hour12;   // true, false, or undefined to follow the locale

var DEFAULT_ZONES = [
  { label: 'New York', tz: 'America/New_York' },
  { label: 'London',   tz: 'Europe/London' },
  { label: 'Tokyo',    tz: 'Asia/Tokyo' },
  { label: 'Sydney',   tz: 'Australia/Sydney' },
];
var zones = DEFAULT_ZONES.slice();

// Cities to choose from in the right-click menu, by region
var CITIES = {
  'Americas': [
    ['Anchorage', 'America/Anchorage'], ['Los Angeles', 'America/Los_Angeles'],
    ['Denver', 'America/Denver'], ['Chicago', 'America/Chicago'],
    ['New York', 'America/New_York'], ['Toronto', 'America/Toronto'],
    ['Mexico City', 'America/Mexico_City'], ['Bogotá', 'America/Bogota'],
    ['Lima', 'America/Lima'], ['Santiago', 'America/Santiago'],
    ['São Paulo', 'America/Sao_Paulo'], ['Buenos Aires', 'America/Argentina/Buenos_Aires'],
  ],
  'Europe & Africa': [
    ['Reykjavik', 'Atlantic/Reykjavik'], ['London', 'Europe/London'], ['Dublin', 'Europe/Dublin'],
    ['Lisbon', 'Europe/Lisbon'], ['Paris', 'Europe/Paris'], ['Berlin', 'Europe/Berlin'],
    ['Madrid', 'Europe/Madrid'], ['Rome', 'Europe/Rome'], ['Stockholm', 'Europe/Stockholm'],
    ['Athens', 'Europe/Athens'], ['Istanbul', 'Europe/Istanbul'], ['Moscow', 'Europe/Moscow'],
    ['Cairo', 'Africa/Cairo'], ['Lagos', 'Africa/Lagos'], ['Nairobi', 'Africa/Nairobi'],
    ['Johannesburg', 'Africa/Johannesburg'],
  ],
  'Asia & Pacific': [
    ['Dubai', 'Asia/Dubai'], ['Tehran', 'Asia/Tehran'], ['Karachi', 'Asia/Karachi'],
    ['Mumbai', 'Asia/Kolkata'], ['Dhaka', 'Asia/Dhaka'], ['Bangkok', 'Asia/Bangkok'],
    ['Singapore', 'Asia/Singapore'], ['Hong Kong', 'Asia/Hong_Kong'], ['Shanghai', 'Asia/Shanghai'],
    ['Seoul', 'Asia/Seoul'], ['Tokyo', 'Asia/Tokyo'], ['Perth', 'Australia/Perth'],
    ['Sydney', 'Australia/Sydney'], ['Auckland', 'Pacific/Auckland'], ['Honolulu', 'Pacific/Honolulu'],
  ],
};

// Stored zones are only trusted if the timezone is one Intl knows
function validZones(stored) {
  if (!Array.isArray(stored) || stored.length !== DEFAULT_ZONES.length) return null;
  try {
    stored.forEach(function (z) { localParts(z.tz); });
    return stored.map(function (z) { return { label: String(z.label), tz: String(z.tz) }; });
  } catch (e) { return null; }
}

// The wall-clock parts for a timezone
function localParts(tz) {
  var out = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date()).forEach(function (p) { out[p.type] = parseInt(p.value, 10); });
  return out;
}

function dayLabel(there) {
  var here = new Date();
  var a = Date.UTC(here.getFullYear(), here.getMonth(), here.getDate());
  var b = Date.UTC(there.year, there.month - 1, there.day);
  var diff = Math.round((b - a) / 86400000);
  return diff === 0 ? 'Today' : diff > 0 ? 'Tomorrow' : 'Yesterday';
}

function refresh() {
  zones.forEach(function (z, i) {
    var p = localParts(z.tz);
    var day = p.hour >= 6 && p.hour < 18;
    rows[i].time.text = new Date().toLocaleTimeString([], {
      timeZone: z.tz, hour: 'numeric', minute: '2-digit', hour12: hour12,
    });
    rows[i].sub.text = dayLabel(p);
    rows[i].dot.set_style('border-radius: 5px; background-color: ' +
      (day ? T.accent.yellow : '#7a83c9') + ';');
  });
}

function render(ctx, api) {
  var St = ctx.St;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel);
  rows = [];
  zones = validZones(api.state.get('zones')) || DEFAULT_ZONES.slice();

  heading = UI.label('WORLD CLOCK', '');
  ctx.box.add_child(heading);

  zones.forEach(function (z, i) {
    var row = new St.BoxLayout({ x_expand: true, y_expand: true, style: 'spacing: 10px;' });
    var dot = new St.Widget({ width: 10, height: 10, y_align: ctx.Clutter.ActorAlign.CENTER });
    var names = new St.BoxLayout({ vertical: true, x_expand: true, y_align: ctx.Clutter.ActorAlign.CENTER });
    var name = UI.label(z.label, '');
    names.add_child(name);
    var sub = UI.label('', '');
    names.add_child(sub);
    var time = UI.label('', '', {
      y_align: ctx.Clutter.ActorAlign.CENTER,
    });
    row.add_child(dot);
    row.add_child(names);
    row.add_child(time);
    if (i > 0) row.set_style('spacing: 10px; border-top-width: 1px; border-color: ' + T.hairline + ';');
    ctx.box.add_child(row);
    rows.push({ dot: dot, name: name, sub: sub, time: time });
  });
  layout(288, 192);
  hour12 = api.state.get('hour12');
  refresh();

  api.menu.set(function () {
    var localTz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    var slots = zones.map(function (z, i) {
      var regions = Object.keys(CITIES).map(function (region) {
        return {
          label: region,
          items: CITIES[region].map(function (c) {
            return { label: c[0], checked: z.tz === c[1],
              onSelect: function () { setZone(api, i, c[0], c[1]); } };
          }),
        };
      });
      regions.unshift({ label: 'Local time', checked: z.tz === localTz && z.label === 'Local',
        onSelect: function () { setZone(api, i, 'Local', localTz); } });
      return { label: 'Clock ' + (i + 1) + ': ' + z.label, items: regions };
    });
    return slots.concat([
      { label: 'Reset cities', onSelect: function () { zones = DEFAULT_ZONES.slice(); saveZones(api); rebuildNames(); } },
      { separator: true },
      { label: '24-hour time', checked: is24(),
        onSelect: function () { hour12 = is24(); api.state.set('hour12', hour12); refresh(); } },
      { separator: true },
      { label: 'Open Clocks', enabled: appInstalled(ctx, 'org.gnome.clocks.desktop'),
        onSelect: function () { openApp(ctx, api, 'org.gnome.clocks.desktop'); } },
    ]);
  });
}

function setZone(api, i, label, tz) {
  zones[i] = { label: label, tz: tz };
  saveZones(api);
  rebuildNames();
}

function saveZones(api) {
  api.state.set('zones', zones);
}

function rebuildNames() {
  zones.forEach(function (z, i) { rows[i].name.text = z.label; });
  refresh();
}

// Is the time shown on a 24-hour clock right now?
function is24() {
  if (hour12 !== undefined) return !hour12;
  return /^h2[34]$/.test(new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hourCycle || '');
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
  scale = UI.scale(w, h, 288, 192);
  heading.set_style(T.caption + ' ' + UI.pt(8, scale) + ' margin-bottom: 6px;');
  rows.forEach(function (r) {
    r.name.set_style(UI.pt(11, scale) + ' font-weight: bold;');
    r.sub.set_style(UI.pt(8, scale) + ' color: ' + T.faint + ';');
    r.time.set_style(UI.pt(15, scale) + ' font-weight: 300;');
  });
  refresh();
}

function onResize(ctx, api, w, h) {
  layout(w, h);
}

function update() {
  refresh();
}
