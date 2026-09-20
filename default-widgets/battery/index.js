// Battery Status Widget
// A charge ring with the percentage inside, and the state and time left beside it.

var UI;
var T;
var ring;
var percent;
var state;
var detail;
var caption;
var showTime = true;

var STATES = { 1: 'Charging', 2: 'Discharging', 4: 'Fully charged' };

function chargeColor(pct, charging) {
  if (charging) return T.accent.green;
  return pct <= 15 ? T.accent.red : pct <= 30 ? T.accent.orange : T.accent.green;
}

function duration(seconds) {
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? h + ' h ' + m + ' min' : m + ' min';
}

function render(ctx, api) {
  var St = ctx.St;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel);

  var row = new St.BoxLayout({ x_expand: true, y_expand: true, style: 'spacing: 16px;' });

  ring = UI.ring({ size: 68, thickness: 7, color: T.accent.green });
  percent = UI.label('--', 'font-size: 11pt; font-weight: bold;');
  row.add_child(UI.stack(ring, percent));

  var text = new St.BoxLayout({ vertical: true, y_align: ctx.Clutter.ActorAlign.CENTER });
  caption = UI.label('BATTERY', T.caption);
  text.add_child(caption);
  state = UI.label('No battery', 'font-size: 13pt; font-weight: bold;');
  detail = UI.label('', 'font-size: 9pt; color: ' + T.dim + ';');
  text.add_child(state);
  text.add_child(detail);
  row.add_child(text);

  ctx.box.add_child(row);
  layout(288, 96);

  showTime = api.state.get('time') !== false;
  api.menu.set(function () {
    return [
      { label: 'Show time remaining', checked: showTime,
        onSelect: function () { showTime = !showTime; api.state.set('time', showTime); } },
      { separator: true },
      { label: 'Power settings', enabled: appInstalled(ctx, 'org.gnome.Settings.desktop'),
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
  var s = UI.scale(w, h, 288, 96);
  ring.resize(Math.round(68 * s), 7 * s);
  percent.set_style(UI.pt(11, s) + ' font-weight: bold;');
  caption.set_style(T.caption + ' ' + UI.pt(8, s));
  state.set_style(UI.pt(13, s) + ' font-weight: bold;');
  detail.set_style(UI.pt(9, s) + ' color: ' + T.dim + ';');
}

function onResize(ctx, api, w, h) {
  layout(w, h);
}

function update(ctx, api) {
  var bat = api.system.battery();
  if (!bat) {
    ring.setValue(0);
    percent.text = '–';
    state.text = 'No battery';
    detail.text = 'Running on mains power';
    return;
  }
  var pct = Math.round(bat.percentage);
  var charging = bat.state === 1;
  ring.setValue(pct / 100, chargeColor(pct, charging));
  percent.text = pct + '%';
  state.text = STATES[bat.state] || 'Unknown';

  if (!showTime) detail.text = '';
  else if (bat.state === 2 && bat.timeToEmpty > 0) detail.text = duration(bat.timeToEmpty) + ' remaining';
  else if (charging && bat.timeToFull > 0) detail.text = duration(bat.timeToFull) + ' until full';
  else detail.text = '';
}
