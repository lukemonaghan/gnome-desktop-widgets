// Media Controls Widget
// What is playing right now in any MPRIS player (Spotify, Firefox, Rhythmbox,
// VLC, ...): cover art, title, artist, previous / play-pause / next and a
// progress bar. Shows "Nothing playing" when no player is running.

var UI;
var T;
var cover;
var coverIcon;
var stateLabel;
var titleLabel;
var artistLabel;
var playIcon;
var prevButton;
var playButton;
var nextButton;
var progress;
var timeLabel;
var buttons = {};
var scale = 1;
var artFor = '';      // the artUrl the cover shows (or is fetching)
var artPath = null;
var current = null;   // the last reading, for the menu

function clock(s) {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function button(ctx, iconName, css) {
  var b = new ctx.St.Button({
    can_focus: true, reactive: true, style: css,
    y_align: ctx.Clutter.ActorAlign.CENTER,
  });
  var icon = new ctx.St.Icon({ icon_name: iconName, style: 'color: ' + T.text + ';' });
  b.set_child(icon);
  return { button: b, icon: icon };
}

function paintCover(ctx) {
  var size = Math.round(52 * scale);
  var css = 'border-radius: ' + Math.round(12 * scale) + 'px;';
  if (artPath) {
    css += ' background-image: url("' + ctx.GLib.filename_to_uri(artPath, null) + '");' +
      ' background-size: ' + size + 'px ' + size + 'px; background-position: 0 0;';
    coverIcon.visible = false;
  } else {
    css += ' background-gradient-direction: vertical; background-gradient-start: #dc8add;' +
      ' background-gradient-end: #613583;';
    coverIcon.visible = true;
  }
  cover.set_size(size, size);
  cover.set_style(css);
}

// Local files are used as they are; web addresses go through the download cache
function loadArt(ctx, api, url) {
  if (url === artFor) return;
  artFor = url;
  artPath = null;
  if (!url) { paintCover(ctx); return; }
  if (url.indexOf('file://') === 0) {
    artPath = ctx.GLib.filename_from_uri(url)[0];
    paintCover(ctx);
    return;
  }
  paintCover(ctx);
  api.network.download(url, {}, function (res) {
    if (artFor !== url) return;   // the track changed meanwhile
    artPath = res.ok ? res.path : null;
    paintCover(ctx);
  });
}

function layout(ctx, w, h) {
  scale = UI.scale(w, h, 288, 128);
  var s = scale;
  paintCover(ctx);
  coverIcon.icon_size = Math.round(26 * s);
  titleLabel.set_style(UI.pt(12, s) + ' font-weight: bold;');
  artistLabel.set_style(UI.pt(9, s) + ' color: ' + T.dim + ';');
  timeLabel.set_style(UI.pt(8, s) + ' color: ' + T.faint + ';');
  buttons.prev.icon.icon_size = Math.round(16 * s);
  buttons.next.icon.icon_size = Math.round(16 * s);
  buttons.play.icon.icon_size = Math.round(18 * s);
  buttons.prev.button.set_style('padding: ' + Math.round(6 * s) + 'px; border-radius: 20px;');
  buttons.next.button.set_style('padding: ' + Math.round(6 * s) + 'px; border-radius: 20px;');
  buttons.play.button.set_style('padding: ' + Math.round(8 * s) + 'px; border-radius: 24px;' +
    ' background-color: ' + T.accent.purple + ';');
  progress.resize(Math.max(3, Math.round(5 * s)));
}

function refresh(ctx, api) {
  var m = api.media.get();
  current = m;
  if (!m) {
    stateLabel.text = 'NO PLAYER';
    stateLabel.set_style(T.caption);
    titleLabel.text = 'Nothing playing';
    artistLabel.text = 'Start a song in any media player';
    playIcon.icon_name = 'media-playback-start-symbolic';
    progress.setValue(0, T.faint);
    timeLabel.text = '';
    [prevButton, playButton, nextButton].forEach(function (b) { b.opacity = 90; });
    loadArt(ctx, api, '');
    return;
  }

  var playing = m.status === 'Playing';
  stateLabel.text = (playing ? 'NOW PLAYING' : m.status === 'Paused' ? 'PAUSED' : 'STOPPED') +
    ' · ' + m.player.toUpperCase();
  stateLabel.set_style(T.caption + (playing ? ' color: ' + T.accent.purple + ';' : ''));
  titleLabel.text = m.title || 'Unknown track';
  artistLabel.text = m.artist || m.album || '';
  playIcon.icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
  prevButton.opacity = m.canPrevious ? 255 : 90;
  nextButton.opacity = m.canNext ? 255 : 90;
  playButton.opacity = m.canPlay ? 255 : 90;

  if (m.length > 0) {
    progress.setValue(m.position / m.length, playing ? T.accent.purple : T.faint);
    timeLabel.text = clock(m.position) + ' / ' + clock(m.length);
  } else {
    // Streams and live radio have no length
    progress.setValue(0, T.faint);
    timeLabel.text = playing ? clock(m.position) : '';
  }
  loadArt(ctx, api, m.artUrl);
}

function render(ctx, api) {
  var St = ctx.St;
  var Clutter = ctx.Clutter;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel);
  artFor = '';
  artPath = null;
  buttons = {};

  // Fills the widget and centres the two rows in it
  var col = new St.BoxLayout({
    vertical: true, x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER,
  });
  var top = new St.BoxLayout({ x_expand: true, style: 'spacing: 12px;' });

  cover = new St.Bin({ y_align: Clutter.ActorAlign.CENTER });
  coverIcon = new St.Icon({ icon_name: 'audio-x-generic-symbolic', style: 'color: white;' });
  cover.set_child(coverIcon);
  top.add_child(cover);

  var meta = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
  stateLabel = UI.label('', '');
  titleLabel = UI.label('', '');
  artistLabel = UI.label('', '');
  [stateLabel, titleLabel, artistLabel].forEach(function (l) {
    l.clutter_text.set_ellipsize(ctx.Pango.EllipsizeMode.END);
    meta.add_child(l);
  });
  top.add_child(meta);

  var controls = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 4px;' });
  buttons.prev = button(ctx, 'media-skip-backward-symbolic', '');
  buttons.play = button(ctx, 'media-playback-start-symbolic', '');
  buttons.play.icon.set_style('color: #16181f;');
  buttons.next = button(ctx, 'media-skip-forward-symbolic', '');
  prevButton = buttons.prev.button;
  playButton = buttons.play.button;
  nextButton = buttons.next.button;
  playIcon = buttons.play.icon;
  controls.add_child(prevButton);
  controls.add_child(playButton);
  controls.add_child(nextButton);
  top.add_child(controls);
  col.add_child(top);

  var bottom = new St.BoxLayout({ x_expand: true, style: 'spacing: 10px; margin-top: 10px;' });
  progress = UI.bar({ height: 5, color: T.accent.purple });
  progress.y_align = Clutter.ActorAlign.CENTER;
  timeLabel = UI.label('', '');
  bottom.add_child(progress);
  bottom.add_child(timeLabel);
  col.add_child(bottom);
  ctx.box.add_child(col);

  prevButton.connect('clicked', function () { api.media.previous(); });
  playButton.connect('clicked', function () { api.media.playPause(); });
  nextButton.connect('clicked', function () { api.media.next(); });

  layout(ctx, 288, 128);
  refresh(ctx, api);

  api.menu.set(function () {
    var m = current;
    return [
      { label: m && m.status === 'Playing' ? 'Pause' : 'Play', enabled: !!(m && m.canPlay),
        onSelect: function () { api.media.playPause(); } },
      { label: 'Next track', enabled: !!(m && m.canNext), onSelect: function () { api.media.next(); } },
      { label: 'Previous track', enabled: !!(m && m.canPrevious), onSelect: function () { api.media.previous(); } },
      { separator: true },
      { label: m ? 'Show ' + m.player : 'Show player', enabled: !!m, onSelect: function () { api.media.raise(); } },
    ];
  });
}

function onResize(ctx, api, w, h) {
  layout(ctx, w, h);
}

function update(ctx, api) {
  refresh(ctx, api);
}
