// Search Launcher Widget
// A search-bar pill. It only mimics the launcher: a click is logged.

var UI;
var T;
var search;
var key;
var icon;
var showKey = true;

function render(ctx, api) {
  var St = ctx.St;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle('background-color: rgba(22, 24, 32, 0.82); border: 1px solid rgba(255, 255, 255, 0.12);' +
    ' border-radius: 28px; padding: 0 20px;');

  var row = new St.BoxLayout({ x_expand: true, y_expand: true, style: 'spacing: 12px;' });
  icon = new St.Icon({
    icon_name: 'system-search-symbolic', icon_size: 18, y_align: ctx.Clutter.ActorAlign.CENTER,
    style: 'color: ' + T.dim + ';',
  });
  row.add_child(icon);
  search = UI.label('Search apps, files and settings…', '', {
    x_expand: true, y_align: ctx.Clutter.ActorAlign.CENTER,
  });
  search.clutter_text.set_ellipsize(ctx.Pango.EllipsizeMode.END);
  row.add_child(search);
  key = UI.label('Super', '', { y_align: ctx.Clutter.ActorAlign.CENTER });
  row.add_child(key);
  ctx.box.add_child(row);
  showKey = api.state.get('key') !== false;
  key.visible = showKey;
  layout(352, 64);

  api.menu.set(function () {
    return [
      { label: 'Show Super key hint', checked: showKey,
        onSelect: function () { showKey = !showKey; api.state.set('key', showKey); key.visible = showKey; } },
      { separator: true },
      { label: 'Files', enabled: appInstalled(ctx, 'org.gnome.Nautilus.desktop'),
        onSelect: function () { openApp(ctx, api, 'org.gnome.Nautilus.desktop'); } },
      { label: 'Settings', enabled: appInstalled(ctx, 'org.gnome.Settings.desktop'),
        onSelect: function () { openApp(ctx, api, 'org.gnome.Settings.desktop'); } },
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


function layout(w, h) {
  var s = UI.scale(w, h, 352, 64);
  icon.icon_size = Math.round(18 * s);
  search.set_style(UI.pt(11, s) + ' color: ' + T.faint + ';');
  key.set_style(UI.pt(8, s) + ' font-weight: bold; color: ' + T.dim + ';' +
    ' border: 1px solid ' + T.hairline + '; border-radius: 6px; padding: 2px 7px;');
}

function onResize(ctx, api, w, h) {
  layout(w, h);
}

function onClick(ctx, api) {
  api.widget.log('Launcher activated');
}
