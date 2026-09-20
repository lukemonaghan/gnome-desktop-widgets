// Battery Status Widget
// Shows battery percentage and charging state

var label;

function getText(bat) {
  if (!bat) return '🔌 No battery detected';
  var pct = Math.round(bat.percentage);
  var icon = pct > 80 ? '🔋' : pct > 20 ? '🔋' : '🪫';
  var states = { 1: 'Charging', 2: 'Discharging', 4: 'Full' };
  var state = states[bat.state] || 'Unknown';
  var extra = '';
  if (bat.state === 2 && bat.timeToEmpty > 0) {
    var h = Math.floor(bat.timeToEmpty / 3600);
    var m = Math.floor((bat.timeToEmpty % 3600) / 60);
    extra = ' (' + h + 'h ' + m + 'm left)';
  } else if (bat.state === 1 && bat.timeToFull > 0) {
    var h2 = Math.floor(bat.timeToFull / 3600);
    var m2 = Math.floor((bat.timeToFull % 3600) / 60);
    extra = ' (' + h2 + 'h ' + m2 + 'm to full)';
  }
  return icon + ' ' + pct + '% — ' + state + extra;
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: getText(null) });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  var bat = api.system.battery();
  label.set_text(getText(bat));
}
