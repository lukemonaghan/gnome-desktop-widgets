// Pomodoro Timer Widget
// 25 minutes of focus, 5 of break, as a progress ring. It starts stopped.
// Click to start, pause or resume; right-click for Start/Pause, Restart, Stop
// and reset, and Skip.

var UI;
var T;
var WORK_SECS = 25 * 60;
var BREAK_SECS = 5 * 60;
var timeLeft = WORK_SECS;
var isBreak = false;
var running = false;
var ring;
var clock;
var phase;
var hint;
var scale = 1;

function pad(n) {
  return String(n).padStart(2, '0');
}

function total() {
  return isBreak ? BREAK_SECS : WORK_SECS;
}

function refresh() {
  var color = isBreak ? T.accent.green : T.accent.red;
  var fresh = timeLeft === total();
  ring.setValue(1 - timeLeft / total(), running ? color : T.faint);
  clock.text = pad(Math.floor(timeLeft / 60)) + ':' + pad(timeLeft % 60);
  clock.set_style(UI.pt(22, scale) + ' font-weight: 300; color: ' + (running ? T.text : T.dim) + ';');
  phase.text = isBreak ? 'BREAK' : 'FOCUS';
  phase.set_style(T.caption + ' ' + UI.pt(8, scale) + ' color: ' + color + ';');
  hint.text = running ? 'Click to pause' : fresh ? 'Click to start' : 'Paused – click to resume';
  hint.set_style(UI.pt(8, scale) + ' color: ' + T.faint + ';');
}

function layout(w, h) {
  scale = UI.scale(w, h, 192, 192);
  ring.resize(Math.round(128 * scale), 9 * scale);
  refresh();
}

function switchPhase() {
  isBreak = !isBreak;
  timeLeft = total();
  refresh();
}

function toggle() {
  running = !running;
  refresh();
}

function render(ctx, api) {
  var St = ctx.St;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel);
  isBreak = false;
  timeLeft = WORK_SECS;
  running = false;

  var col = new St.BoxLayout({
    vertical: true, x_expand: true, y_expand: true,
    x_align: ctx.Clutter.ActorAlign.CENTER, y_align: ctx.Clutter.ActorAlign.CENTER,
    style: 'spacing: 8px;',
  });
  ring = UI.ring({ size: 128, thickness: 9 });
  clock = UI.label('', '');
  phase = UI.label('', '');
  var center = new St.BoxLayout({ vertical: true, x_align: ctx.Clutter.ActorAlign.CENTER });
  center.add_child(clock);
  phase.x_align = ctx.Clutter.ActorAlign.CENTER;
  center.add_child(phase);
  col.add_child(UI.stack(ring, center));

  hint = UI.label('', '', { x_align: ctx.Clutter.ActorAlign.CENTER });
  col.add_child(hint);
  ctx.box.add_child(col);
  refresh();

  api.menu.set(function () {
    return [
      { label: running ? 'Pause' : timeLeft === total() ? 'Start' : 'Resume', onSelect: toggle },
      { label: 'Restart', onSelect: function () { timeLeft = total(); running = true; refresh(); } },
      {
        label: 'Stop and reset',
        enabled: running || timeLeft !== total() || isBreak,
        onSelect: function () { running = false; isBreak = false; timeLeft = total(); refresh(); },
      },
      { separator: true },
      { label: 'Skip to ' + (isBreak ? 'focus' : 'break'), onSelect: switchPhase },
    ];
  });
}

function onResize(ctx, api, w, h) {
  layout(w, h);
}

function update() {
  if (!running) return;
  if (timeLeft > 0) {
    timeLeft--;
    refresh();
  } else {
    switchPhase();
  }
}

function onClick() {
  toggle();
}
