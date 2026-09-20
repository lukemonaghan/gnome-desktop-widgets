// RSS News Feed Widget
// Displays headlines (placeholder — replace with real RSS parsing)

var label;
var headlines = [
  '📰 GNOME 48 released with new features',
  '📰 Linux kernel 7.0 brings performance gains',
  '📰 Open source adoption grows in enterprise',
];
var currentIndex = 0;

function render(ctx, api) {
  label = new ctx.St.Label({ text: headlines[0], x_expand: true });
  label.clutter_text.set_line_wrap(true);
  ctx.box.add_child(label);
}

function update(ctx, api) {
  currentIndex = (currentIndex + 1) % headlines.length;
  label.set_text(headlines[currentIndex]);
}
