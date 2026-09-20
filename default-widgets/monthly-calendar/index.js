// Monthly Calendar Widget
// A month grid on a light card: today in a blue circle, weekends dimmed.
// Click the header to go back to the current month; right-click for previous
// and next month.

var UI;
var T;
var title;
var grid;
var shown = null;        // first day of the month on show
var CELL = 36;      // cell width and height, scaled to the widget
var ROW = 30;
var scale = 1;

var INK = '#23252b';
var SOFT = 'rgba(35, 37, 43, 0.4)';

function monthStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function shift(months) {
  shown = new Date(shown.getFullYear(), shown.getMonth() + months, 1);
}

function cell(ctx, text, opts) {
  var St = ctx.St;
  var bin = new St.Bin({ width: CELL, height: ROW });
  var label = UI.label(text, 'text-align: center; ' + UI.pt(10, scale) + ' ' + (opts.css || ''), {
    x_align: ctx.Clutter.ActorAlign.CENTER, y_align: ctx.Clutter.ActorAlign.CENTER,
  });
  if (opts.today) {
    var circle = new St.Bin({
      width: Math.round(28 * scale), height: Math.round(28 * scale),
      x_align: ctx.Clutter.ActorAlign.CENTER, y_align: ctx.Clutter.ActorAlign.CENTER,
      style: 'border-radius: ' + Math.round(14 * scale) + 'px; background-color: ' + T.accent.blue + ';',
    });
    circle.set_child(UI.label(text, UI.pt(10, scale) + ' font-weight: bold; color: white;', {
      x_align: ctx.Clutter.ActorAlign.CENTER, y_align: ctx.Clutter.ActorAlign.CENTER,
    }));
    bin.set_child(circle);
  } else {
    bin.set_child(label);
  }
  return bin;
}

function build(ctx) {
  var St = ctx.St;
  var now = new Date();
  var first = shown;
  var year = first.getFullYear();
  var month = first.getMonth();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var offset = first.getDay();   // Sunday first

  title.text = first.toLocaleString([], { month: 'long', year: 'numeric' });
  grid.destroy_all_children();

  var names = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var head = new St.BoxLayout();
  names.forEach(function (n, i) {
    head.add_child(cell(ctx, n, {
      css: UI.pt(8, scale) + ' font-weight: bold; color: ' + (i === 0 || i === 6 ? SOFT : 'rgba(35, 37, 43, 0.6)') + ';',
    }));
  });
  grid.add_child(head);

  var day = 1 - offset;
  for (var r = 0; r < 6; r++) {
    var row = new St.BoxLayout();
    for (var c = 0; c < 7; c++, day++) {
      if (day < 1 || day > daysInMonth) {
        row.add_child(new St.Bin({ width: CELL, height: ROW }));
        continue;
      }
      var isToday = day === now.getDate() && month === now.getMonth() && year === now.getFullYear();
      row.add_child(cell(ctx, String(day), {
        today: isToday,
        css: 'color: ' + (c === 0 || c === 6 ? SOFT : INK) + ';',
      }));
    }
    grid.add_child(row);
  }
}

function render(ctx, api) {
  var St = ctx.St;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.paper);
  shown = monthStart(new Date());

  title = UI.label('', '', { x_align: ctx.Clutter.ActorAlign.START });
  ctx.box.add_child(title);

  grid = new St.BoxLayout({ vertical: true, x_align: ctx.Clutter.ActorAlign.CENTER });
  ctx.box.add_child(grid);
  sizeTo(288, 288);
  build(ctx);

  api.menu.set([
    { label: 'Previous month', onSelect: function () { shift(-1); build(ctx); } },
    { label: 'Next month', onSelect: function () { shift(1); build(ctx); } },
    { label: 'Today', onSelect: function () { shown = monthStart(new Date()); build(ctx); } },
    { separator: true },
    { label: 'Open Calendar', enabled: appInstalled(ctx, 'org.gnome.Calendar.desktop'),
      onSelect: function () { openApp(ctx, api, 'org.gnome.Calendar.desktop'); } },
  ]);
}

// Open a desktop app by its .desktop id, if it is installed
function appInstalled(ctx, id) {
  try { return !!ctx.Gio.DesktopAppInfo.new(id); } catch (e) { return false; }
}

function openApp(ctx, api, id) {
  try {
    var info = ctx.Gio.DesktopAppInfo.new(id);
    if (info) info.launch([], null);
  } catch (e) {
    api.widget.log('Cannot open ' + id + ': ' + e);
  }
}

// Cells and text follow the widget's size (the design is 288 x 288)
function sizeTo(w, h) {
  scale = UI.scale(w, h, 288, 288);
  CELL = Math.round(36 * scale);
  ROW = Math.round(30 * scale);
  title.set_style(UI.pt(14, scale) + ' font-weight: bold; margin-bottom: 6px; color: ' + INK + ';');
}

function onResize(ctx, api, w, h) {
  sizeTo(w, h);
  build(ctx);
}

// Roll over at midnight (and keep "today" right if the widget has been left on)
function update(ctx) {
  var now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 2) {
    shown = monthStart(now);
    build(ctx);
  }
}

function onClick(ctx) {
  shown = monthStart(new Date());
  build(ctx);
}
