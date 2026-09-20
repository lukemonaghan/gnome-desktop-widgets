// Digital Clock Widget
// Shows current time in large digital format, updated every second

var label;

function render(ctx, api) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  label = new ctx.St.Label({ text: time + '\n' + date });
  label.clutter_text.set_line_wrap(false);
  ctx.box.add_child(label);
}

function update(ctx, api) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  label.set_text(time + '\n' + date);
}
