// Analog Clock Widget
// A drawn clock face: ticks, hour and minute hands, and a sweeping second hand.

var UI;
var T;
var face;
var showSeconds = true;
var showTicks = true;

function draw(cr, w, h) {
  var now = new Date();
  var cx = w / 2;
  var cy = h / 2;
  var r = Math.min(w, h) / 2 - 2;
  var k = r / 90;   // drawn for a radius of 90 px; scale the fine detail with it
  var sec = now.getSeconds();
  var min = now.getMinutes() + sec / 60;
  var hour = (now.getHours() % 12) + min / 60;

  // Face
  UI.setColor(cr, 'rgba(255, 255, 255, 0.05)');
  cr.arc(cx, cy, r, 0, 2 * Math.PI);
  cr.fill();
  UI.setColor(cr, T.hairline);
  cr.setLineWidth(1.5 * k);
  cr.arc(cx, cy, r, 0, 2 * Math.PI);
  cr.stroke();

  // Ticks: long at the hours, short at the minutes
  cr.setLineCap(1);
  for (var i = 0; i < 60 && showTicks; i++) {
    var major = i % 5 === 0;
    var a = (i / 60) * 2 * Math.PI;
    var inner = r - (major ? 12 : 7) * k;
    var outer = r - 3 * k;
    cr.setLineWidth((major ? 2.5 : 1) * k);
    UI.setColor(cr, major ? T.text : T.faint);
    cr.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
    cr.lineTo(cx + Math.sin(a) * outer, cy - Math.cos(a) * outer);
    cr.stroke();
  }

  function hand(angle, length, width, color) {
    cr.setLineWidth(width);
    UI.setColor(cr, color);
    cr.moveTo(cx - Math.sin(angle) * length * 0.12, cy + Math.cos(angle) * length * 0.12);
    cr.lineTo(cx + Math.sin(angle) * length, cy - Math.cos(angle) * length);
    cr.stroke();
  }

  hand((hour / 12) * 2 * Math.PI, r * 0.5, 5 * k, T.text);
  hand((min / 60) * 2 * Math.PI, r * 0.76, 3.5 * k, T.text);
  if (showSeconds) hand((sec / 60) * 2 * Math.PI, r * 0.82, 1.5 * k, T.accent.orange);

  // Centre cap
  UI.setColor(cr, T.accent.orange);
  cr.arc(cx, cy, 4.5 * k, 0, 2 * Math.PI);
  cr.fill();
  UI.setColor(cr, '#16181f');
  cr.arc(cx, cy, 1.8 * k, 0, 2 * Math.PI);
  cr.fill();
}

function render(ctx, api) {
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel + ' padding: 12px;');
  face = UI.canvas({
    width: 32, height: 32, draw: draw,   // grows to fill the widget
    x_expand: true, y_expand: true,
    x_align: ctx.Clutter.ActorAlign.FILL, y_align: ctx.Clutter.ActorAlign.FILL,
  });
  ctx.box.add_child(face);

  showSeconds = api.state.get('seconds') !== false;
  showTicks = api.state.get('ticks') !== false;

  api.menu.set(function () {
    return [
      { label: 'Second hand', checked: showSeconds,
        onSelect: function () { showSeconds = !showSeconds; api.state.set('seconds', showSeconds); face.redraw(); } },
      { label: 'Minute marks', checked: showTicks,
        onSelect: function () { showTicks = !showTicks; api.state.set('ticks', showTicks); face.redraw(); } },
      { separator: true },
      { label: 'Open Clocks', enabled: appInstalled(ctx, 'org.gnome.clocks.desktop'),
        onSelect: function () { openApp(ctx, api, 'org.gnome.clocks.desktop'); } },
    ];
  });
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


function update() {
  face.redraw();
}
