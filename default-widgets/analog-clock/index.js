// Analog Clock Widget
// Displays a text-based analog clock face with hour/minute hands

var label;

function getDirection(angle) {
  var dirs = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  var idx = Math.round(angle / 45) % 8;
  return dirs[idx];
}

function getText() {
  var now = new Date();
  var h = now.getHours() % 12;
  var m = now.getMinutes();
  var hourAngle = (h + m / 60) * 30;
  var minAngle = m * 6;
  var timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return '🕐 ' + timeStr + '\nHour → ' + getDirection(hourAngle) + '  Min → ' + getDirection(minAngle);
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: getText() });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  label.set_text(getText());
}
