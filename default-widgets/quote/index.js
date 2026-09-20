// Quote of the Day Widget
// One quote a day on an indigo gradient, with a large decorative quotation
// mark. Right-click for the previous or next one.

var UI;
var T;
var body;
var author;
var mark;
var offset = 0;

var quotes = [
  ['Be yourself; everyone else is already taken.', 'Oscar Wilde'],
  ['The only way to do great work is to love what you do.', 'Steve Jobs'],
  ['In the middle of difficulty lies opportunity.', 'Albert Einstein'],
  ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
  ['Stay hungry, stay foolish.', 'Stewart Brand'],
  ['The best time to plant a tree was 20 years ago. The second best time is now.', 'Chinese proverb'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
];

function show() {
  var now = new Date();
  var dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  var q = quotes[(((dayOfYear + offset) % quotes.length) + quotes.length) % quotes.length];
  body.text = q[0];
  author.text = '— ' + q[1];
}

function render(ctx, api) {
  var St = ctx.St;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle('background-gradient-direction: vertical; background-gradient-start: #3b3a8f;' +
    ' background-gradient-end: #22204f; color: #f2f4f8; border-radius: 20px; padding: 14px 20px;' +
    ' border: 1px solid rgba(255, 255, 255, 0.1);');

  // A large decorative mark in the left column
  var row = new St.BoxLayout({ x_expand: true, y_expand: true, style: 'spacing: 6px;' });
  mark = UI.label('\u201C', '', { y_align: ctx.Clutter.ActorAlign.START });
  row.add_child(mark);

  var col = new St.BoxLayout({ vertical: true, x_expand: true, y_align: ctx.Clutter.ActorAlign.CENTER,
    style: 'spacing: 8px;' });
  body = UI.label('', '', { wrap: true, x_expand: true });
  author = UI.label('', '', { x_align: ctx.Clutter.ActorAlign.END });
  col.add_child(body);
  col.add_child(author);
  row.add_child(col);
  ctx.box.add_child(row);
  layout(384, 160);
  show();

  api.menu.set(function () {
    return [
      { label: 'Previous quote', onSelect: function () { offset--; show(); } },
      { label: 'Next quote', onSelect: function () { offset++; show(); } },
      { label: "Today's quote", enabled: offset !== 0, onSelect: function () { offset = 0; show(); } },
      { separator: true },
      {
        label: 'Copy quote',
        onSelect: function () {
          ctx.St.Clipboard.get_default().set_text(ctx.St.ClipboardType.CLIPBOARD, body.text + ' ' + author.text);
        },
      },
    ];
  });
}

function layout(w, h) {
  var s = UI.scale(w, h, 384, 160);
  mark.set_style('font-family: serif; ' + UI.pt(44, s) + ' color: rgba(255, 255, 255, 0.3);');
  body.set_style('font-family: serif; font-style: italic; ' + UI.pt(13, s) + ';');
  author.set_style(UI.pt(9, s) + ' font-weight: bold; letter-spacing: 0.5px; color: rgba(255, 255, 255, 0.6);');
}

function onResize(ctx, api, w, h) {
  layout(w, h);
}

// A new quote each day
function update() {
  if (offset === 0) show();
}

function onClick() {
  offset++;
  show();
}
