// Quote of the Day Widget
// Rotates through a collection of quotes

var label;

var quotes = [
  '"Be yourself; everyone else is already taken." — Oscar Wilde',
  '"The only way to do great work is to love what you do." — Steve Jobs',
  '"In the middle of difficulty lies opportunity." — Albert Einstein',
  '"Simplicity is the ultimate sophistication." — Leonardo da Vinci',
  '"Stay hungry, stay foolish." — Stewart Brand',
  '"The best time to plant a tree was 20 years ago. The second best time is now." — Chinese Proverb',
  '"Do what you can, with what you have, where you are." — Theodore Roosevelt',
];

function getText() {
  var now = new Date();
  var start = new Date(now.getFullYear(), 0, 0);
  var dayOfYear = Math.floor((now - start) / 86400000);
  var idx = dayOfYear % quotes.length;
  return '💬\n' + quotes[idx];
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: getText(), x_expand: true });
  label.clutter_text.set_line_wrap(true);
  ctx.box.add_child(label);
}

function update(ctx, api) {
  label.set_text(getText());
}
