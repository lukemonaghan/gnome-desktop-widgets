// World Clock Widget
// Shows current time across multiple timezones

var label;

var zones = [
  { label: 'New York', tz: 'America/New_York' },
  { label: 'London',   tz: 'Europe/London' },
  { label: 'Tokyo',    tz: 'Asia/Tokyo' },
  { label: 'Sydney',   tz: 'Australia/Sydney' },
];

function getText() {
  var lines = zones.map(function(z) {
    var time = new Date().toLocaleTimeString([], {
      timeZone: z.tz,
      hour: '2-digit',
      minute: '2-digit',
    });
    return '🌐 ' + z.label + ': ' + time;
  });
  return lines.join('\n');
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: getText() });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  label.set_text(getText());
}
