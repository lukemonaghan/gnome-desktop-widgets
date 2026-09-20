// Countdown Timer Widget
// A countdown ring that starts stopped. Click to start, pause or resume (or to
// restart once it has run out). Right-click for Start/Pause, Restart, Stop and
// reset, and the length.

var UI;
var T;
var total = 15 * 60;
var seconds = total;
var running = false;
var ring;
var clock;
var caption;
var hint;
var scale = 1;

var LENGTHS = [1, 5, 10, 15, 25, 45, 60];

function pad(n) {
  return String(n).padStart(2, '0');
}

function refresh() {
  var done = seconds <= 0;
  var fresh = seconds === total;
  var color = done ? T.accent.red : T.accent.orange;
  ring.setValue(done ? 1 : seconds / total, running || done ? color : T.faint);
  clock.text = done ? '0:00' : Math.floor(seconds / 60) + ':' + pad(seconds % 60);
  clock.set_style(UI.pt(22, scale) + ' font-weight: 300; color: ' +
    (done ? T.accent.red : running ? T.text : T.dim) + ';');
  caption.text = done ? "TIME'S UP" : running ? 'TIMER' : fresh ? 'READY' : 'PAUSED';
  caption.set_style(T.caption + ' ' + UI.pt(8, scale) + (done ? ' color: ' + T.accent.red + ';' : ''));
  hint.text = done ? 'Click to restart' : running ? 'Click to pause' : fresh ? 'Click to start' : 'Click to resume';
  hint.set_style(UI.pt(8, scale) + ' color: ' + T.faint + ';');
}

function layout(w, h) {
  scale = UI.scale(w, h, 192, 192);
  ring.resize(Math.round(128 * scale), 9 * scale);
  refresh();
}

function stopAndReset() {
  running = false;
  seconds = total;
  refresh();
}

function restart() {
  seconds = total;
  running = true;
  refresh();
}

function toggle() {
  if (seconds <= 0) {
    restart();
    return;
  }
  running = !running;
  refresh();
}

function render(ctx, api) {
  var St = ctx.St;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel);

  var saved = api.state.get('minutes');
  if (LENGTHS.indexOf(saved) >= 0) total = saved * 60;
  seconds = total;
  running = false;

  var col = new St.BoxLayout({
    vertical: true, x_expand: true, y_expand: true,
    x_align: ctx.Clutter.ActorAlign.CENTER, y_align: ctx.Clutter.ActorAlign.CENTER,
    style: 'spacing: 8px;',
  });
  ring = UI.ring({ size: 128, thickness: 9 });
  clock = UI.label('', '');
  caption = UI.label('', '', { x_align: ctx.Clutter.ActorAlign.CENTER });
  var center = new St.BoxLayout({ vertical: true, x_align: ctx.Clutter.ActorAlign.CENTER });
  center.add_child(clock);
  center.add_child(caption);
  col.add_child(UI.stack(ring, center));

  hint = UI.label('', '', { x_align: ctx.Clutter.ActorAlign.CENTER });
  col.add_child(hint);
  ctx.box.add_child(col);
  refresh();

  api.menu.set(function () {
    var done = seconds <= 0;
    var items = [
      { label: done ? 'Start again' : running ? 'Pause' : seconds === total ? 'Start' : 'Resume', onSelect: toggle },
      { label: 'Restart', onSelect: restart },
      { label: 'Stop and reset', enabled: running || seconds !== total, onSelect: stopAndReset },
      { separator: true },
    ];
    items.push({
      label: 'Length',
      items: LENGTHS.map(function (m) {
        return {
          label: m + (m === 1 ? ' minute' : ' minutes'),
          checked: m * 60 === total,
          onSelect: function () {
            total = m * 60;
            api.state.set('minutes', m);
            stopAndReset();
          },
        };
      }),
    });
    return items;
  });
}

function onResize(ctx, api, w, h) {
  layout(w, h);
}

function update() {
  if (running && seconds > 0) {
    seconds--;
    if (seconds <= 0) running = false;
    refresh();
  }
}

function onClick() {
  toggle();
}
