// Calendar Agenda Widget
// Shows today's agenda (placeholder items)

var label;

function getText() {
  var today = new Date().toLocaleDateString([], {
    weekday: 'long', month: 'short', day: 'numeric',
  });
  var events = [
    '09:00  📋 Team standup',
    '11:30  💻 Code review',
    '14:00  📞 Client call',
    '16:00  ✏️ Write docs',
  ];
  return '📅 ' + today + '\n\n' + events.join('\n');
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: getText() });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  label.set_text(getText());
}
