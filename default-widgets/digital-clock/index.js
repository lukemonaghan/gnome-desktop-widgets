// Digital Clock Widget
// Big light-weight time with the seconds and AM/PM beside it, and the date below.
// Everything is centred and scales with the widget.

var UI;
var T;
var hm;
var seconds;
var period;
var date;
var hour12;        // true, false, or undefined to follow the locale
var showSeconds = true;
var showDate = true;

function parts() {
  var now = new Date();
  var fmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: hour12 });
  var out = { hour: '', minute: '', period: '' };
  fmt.formatToParts(now).forEach(function (p) {
    if (p.type === 'hour') out.hour = p.value;
    else if (p.type === 'minute') out.minute = p.value;
    else if (p.type === 'dayPeriod') out.period = p.value.toUpperCase();
  });
  out.seconds = String(now.getSeconds()).padStart(2, '0');
  out.date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  return out;
}

function refresh() {
  var p = parts();
  hm.text = p.hour + ':' + p.minute;
  seconds.text = p.seconds;
  seconds.visible = showSeconds;
  period.text = p.period;
  period.visible = p.period !== '';
  date.text = p.date;
  date.visible = showDate;
}

// Is the time shown on a 24-hour clock right now?
function is24() {
  if (hour12 !== undefined) return !hour12;
  return /^h2[34]$/.test(new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hourCycle || '');
}

function layout(w, h) {
  var s = UI.scale(w, h, 288, 128);
  hm.set_style(UI.pt(38, s) + ' font-weight: 300;');
  seconds.set_style(UI.pt(14, s) + ' font-weight: 300; color: ' + T.accent.orange + ';');
  period.set_style(UI.pt(9, s) + ' font-weight: bold; color: ' + T.dim + ';');
  date.set_style(UI.pt(11, s) + ' color: ' + T.dim + ';');
}

function render(ctx, api) {
  var Clutter = ctx.Clutter;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel);
  hour12 = api.state.get('hour12');
  showSeconds = api.state.get('seconds') !== false;
  showDate = api.state.get('date') !== false;

  // One block, centred in the widget both ways
  var col = new ctx.St.BoxLayout({
    vertical: true, x_expand: true, y_expand: true,
    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
  });

  var row = new ctx.St.BoxLayout({ x_align: Clutter.ActorAlign.CENTER, style: 'spacing: 8px;' });
  hm = UI.label('', '');
  var side = new ctx.St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.END });
  seconds = UI.label('', '');
  period = UI.label('', '');
  side.add_child(seconds);
  side.add_child(period);
  row.add_child(hm);
  row.add_child(side);

  date = UI.label('', '', { x_align: Clutter.ActorAlign.CENTER });

  col.add_child(row);
  col.add_child(date);
  ctx.box.add_child(col);
  layout(288, 128);
  refresh();

  api.menu.set(function () {
    return [
      { label: '24-hour time', checked: is24(),
        onSelect: function () { hour12 = is24(); api.state.set('hour12', hour12); refresh(); } },
      { label: 'Show seconds', checked: showSeconds,
        onSelect: function () { showSeconds = !showSeconds; api.state.set('seconds', showSeconds); refresh(); } },
      { label: 'Show date', checked: showDate,
        onSelect: function () { showDate = !showDate; api.state.set('date', showDate); refresh(); } },
      { separator: true },
      { label: 'Open Clocks', enabled: appInstalled(ctx, 'org.gnome.clocks.desktop'),
        onSelect: function () { openApp(ctx, api, 'org.gnome.clocks.desktop'); } },
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


function onResize(ctx, api, w, h) {
  layout(w, h);
}

function update() {
  refresh();
}
