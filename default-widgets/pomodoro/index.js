// Pomodoro Timer Widget
// 25 min work / 5 min break cycle

var label;
var WORK_SECS = 25 * 60;
var BREAK_SECS = 5 * 60;
var timeLeft = WORK_SECS;
var isBreak = false;
var running = true;

function pad(n) {
  return String(n).padStart(2, '0');
}

function getText() {
  var m = Math.floor(timeLeft / 60);
  var s = timeLeft % 60;
  var phase = isBreak ? '☕ Break' : '🍅 Work';
  var status = running ? '' : ' (paused)';
  return phase + status + '\n' + pad(m) + ':' + pad(s);
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: getText() });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  if (!running) return;
  if (timeLeft > 0) {
    timeLeft--;
  } else {
    isBreak = !isBreak;
    timeLeft = isBreak ? BREAK_SECS : WORK_SECS;
  }
  label.set_text(getText());
}

function onClick(ctx, api) {
  running = !running;
  label.set_text(getText());
}
