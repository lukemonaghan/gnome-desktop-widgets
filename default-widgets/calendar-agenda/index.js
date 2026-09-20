// Calendar Agenda Widget
// Today's agenda (sample events): a big day number, then one row per event
// with a colour bar. Finished events fade; the one under way is highlighted.

var UI;
var T;
var rows = [];
var scale = 1;
var dayNumber;
var dayName;
var monthName;

// Sample events. Their times are set relative to now (see layout()) so that one
// is always finished, one under way and the rest to come.
var EVENTS = [
  { offset: -90, mins: 30, title: 'Team standup', color: 'blue' },
  { offset: -10, mins: 60, title: 'Code review',  color: 'purple' },
  { offset: 80,  mins: 45, title: 'Client call',  color: 'orange' },
  { offset: 150, mins: 60, title: 'Write docs',   color: 'green' },
];

// Minutes since midnight at which each event starts, snapped to 5 minutes
function starts() {
  var now = new Date();
  var minutes = now.getHours() * 60 + now.getMinutes();
  return EVENTS.map(function (e) { return Math.round((minutes + e.offset) / 5) * 5; });
}

function clock(minutes) {
  var m = ((minutes % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

function refresh() {
  var now = new Date();
  var minutes = now.getHours() * 60 + now.getMinutes();
  var at = starts();
  EVENTS.forEach(function (e, i) {
    var past = minutes >= at[i] + e.mins;
    var current = minutes >= at[i] && !past;
    var accent = T.accent[e.color];
    rows[i].bar.set_style('border-radius: 2px; background-color: ' + (past ? T.track : accent) + ';');
    rows[i].title.set_style(UI.pt(10, scale) + ' font-weight: ' + (current ? 'bold' : 'normal') +
      '; color: ' + (past ? T.faint : T.text) + ';');
    rows[i].time.set_style(UI.pt(8, scale) + ' color: ' + (current ? accent : T.faint) + ';');
    rows[i].time.text = clock(at[i]) + ' – ' + clock(at[i] + e.mins);
  });
}

function render(ctx, api) {
  var St = ctx.St;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel);
  rows = [];
  var now = new Date();

  var head = new St.BoxLayout({ x_expand: true, style: 'spacing: 12px; margin-bottom: 8px;' });
  dayNumber = UI.label(String(now.getDate()), '');
  head.add_child(dayNumber);
  var when = new St.BoxLayout({ vertical: true, y_align: ctx.Clutter.ActorAlign.CENTER });
  dayName = UI.label(now.toLocaleDateString([], { weekday: 'long' }), '');
  monthName = UI.label(now.toLocaleDateString([], { month: 'long', year: 'numeric' }), '');
  when.add_child(dayName);
  when.add_child(monthName);
  head.add_child(when);
  ctx.box.add_child(head);

  EVENTS.forEach(function (e) {
    var row = new St.BoxLayout({ x_expand: true, y_expand: true, style: 'spacing: 10px;' });
    var bar = new St.Widget({ width: 4, y_expand: true });
    var text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: ctx.Clutter.ActorAlign.CENTER });
    var title = UI.label(e.title, '');
    var time = UI.label('', '');
    text.add_child(title);
    text.add_child(time);
    row.add_child(bar);
    row.add_child(text);
    ctx.box.add_child(row);
    rows.push({ bar: bar, title: title, time: time });
  });
  layout(288, 224);

  api.menu.set([
    { label: 'Open Calendar', enabled: appInstalled(ctx, 'org.gnome.Calendar.desktop'),
      onSelect: function () { openApp(ctx, api, 'org.gnome.Calendar.desktop'); } },
  ]);
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
  scale = UI.scale(w, h, 288, 224);
  dayNumber.set_style(UI.pt(30, scale) + ' font-weight: 300; color: ' + T.accent.blue + ';');
  dayName.set_style(UI.pt(12, scale) + ' font-weight: bold;');
  monthName.set_style(UI.pt(9, scale) + ' color: ' + T.dim + ';');
  refresh();
}

function onResize(ctx, api, w, h) {
  layout(w, h);
}

function update() {
  refresh();
}
