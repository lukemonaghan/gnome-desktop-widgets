// Countdown Timer Widget
// Counts down from 15 minutes (900 seconds)

var label;
var seconds = 900;
var running = true;

function pad(n) {
  return String(n).padStart(2, '0');
}

function getText() {
  if (seconds <= 0) return '⏰ Time is up!';
  var m = Math.floor(seconds / 60);
  var s = seconds % 60;
  return '⏳ ' + pad(m) + ':' + pad(s) + ' remaining';
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: getText() });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  if (running && seconds > 0) {
    seconds--;
    label.set_text(getText());
  }
}

function onClick(ctx, api) {
  if (seconds <= 0) {
    seconds = 900;
    running = true;
  } else {
    running = !running;
  }
  label.set_text(getText());
}
