// Image Slideshow Widget
// Cross-fades through the pictures in the system wallpaper folders and
// ~/.local/share/backgrounds, changing every 10 seconds (right-click to change it). Click for the
// next picture. The name of the picture fades in along the bottom.

var SECONDS_CHOICES = [5, 10, 30, 60];
var MAX_IMAGES = 40;
var FADE_MS = 900;
// Wallpapers come in light (-l) and dark (-d) pairs; one of each is enough
var EXTENSIONS = /\.(jpe?g|png|webp|svg|jxl)$/i;
var LIGHT_VARIANT = /-l\.[a-z]+$/i;

var sizes = {};    // path -> natural size
var fitted = '';   // the widget size the pictures were last cropped for
var images = [];
var index = 0;
var ticks = 0;
var front;      // the picture on show
var back;       // the next one, faded in over it
var caption;
var captionBar;
var seconds = 10;       // per picture
var paused = false;

function scan(ctx, dir) {
  var found = [];
  try {
    var folder = ctx.Gio.File.new_for_path(dir);
    if (!folder.query_exists(null)) return found;
    var en = folder.enumerate_children('standard::name', ctx.Gio.FileQueryInfoFlags.NONE, null);
    var info;
    while ((info = en.next_file(null))) {
      var name = info.get_name();
      if (EXTENSIONS.test(name) && !LIGHT_VARIANT.test(name)) found.push(dir + '/' + name);
    }
  } catch (e) { /* unreadable folder: skip it */ }
  return found;
}

// Natural size of a picture (cached), or null if it cannot be read
function imageSize(ctx, path) {
  if (!(path in sizes)) {
    var info = ctx.GdkPixbuf.Pixbuf.get_file_info(path);
    sizes[path] = info && info[0] ? { w: info[1], h: info[2] } : null;
  }
  return sizes[path];
}

// The room the pictures have: the widget minus its 1 px border
function room(api) {
  var layout = api.widget.getLayout();
  return { w: Math.max(1, (layout.width || 320) - 2), h: Math.max(1, (layout.height || 240) - 2) };
}

// St's CSS has no "cover", so work out the scaled size and offset ourselves:
// the picture fills the widget and the overflow is cropped evenly.
function picture(ctx, api, path) {
  var css = 'background-image: url("' + ctx.GLib.filename_to_uri(path, null) + '");' +
    ' border-radius: 20px;';
  var size = imageSize(ctx, path);
  if (size) {
    var r = room(api);
    var scale = Math.max(r.w / size.w, r.h / size.h);
    var w = Math.ceil(size.w * scale);
    var h = Math.ceil(size.h * scale);
    css += ' background-size: ' + w + 'px ' + h + 'px; background-position: ' +
      Math.round((r.w - w) / 2) + 'px ' + Math.round((r.h - h) / 2) + 'px;';
  }
  return css;
}

function title(path) {
  var base = path.split('/').pop().replace(/\.[^.]+$/, '').replace(/-[dl]$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function show(ctx, api, animate) {
  var path = images[index];
  caption.text = title(path);
  if (!animate) {
    front.set_style(picture(ctx, api, path));
    return;
  }
  // Fade the new picture in over the old one, then make it the base
  back.set_style(picture(ctx, api, path));
  back.remove_all_transitions();
  back.opacity = 0;
  back.ease({
    opacity: 255, duration: FADE_MS, mode: ctx.Clutter.AnimationMode.EASE_IN_OUT_QUAD,
    onComplete: function () {
      front.set_style(picture(ctx, api, path));
      back.opacity = 0;
    },
  });
}

function next(ctx, api) {
  if (images.length < 2) return;
  index = (index + 1) % images.length;
  ticks = 0;
  show(ctx, api, true);
}

function render(ctx, api) {
  var St = ctx.St;
  sizes = {};
  images = scan(ctx, '/usr/share/backgrounds/gnome')
    .concat(scan(ctx, '/usr/share/backgrounds/f44'))
    .concat(scan(ctx, ctx.GLib.get_user_data_dir() + '/backgrounds'))
    .sort()
    .slice(0, MAX_IMAGES);
  index = 0;
  ticks = 0;

  // The pictures fill the whole widget, so there is no padding to inset them
  ctx.setStyle('padding: 0; border-radius: 20px; background-color: #16181f;' +
    ' border: 1px solid rgba(255, 255, 255, 0.09);');

  var stack = new St.Widget({ layout_manager: new ctx.Clutter.BinLayout(), x_expand: true, y_expand: true });
  front = new St.Bin({ x_expand: true, y_expand: true });
  back = new St.Bin({ x_expand: true, y_expand: true, opacity: 0 });
  stack.add_child(front);
  stack.add_child(back);

  // Caption over a fade to black
  var bar = captionBar = new St.BoxLayout({
    x_expand: true, y_expand: true, y_align: ctx.Clutter.ActorAlign.END,
    style: 'padding: 26px 16px 10px 16px; border-radius: 0 0 20px 20px;' +
      ' background-gradient-direction: vertical; background-gradient-start: rgba(0, 0, 0, 0);' +
      ' background-gradient-end: rgba(0, 0, 0, 0.6);',
  });
  caption = new St.Label({ text: '', style: 'font-size: 9pt; font-weight: bold; color: white;' });
  bar.add_child(caption);
  stack.add_child(bar);
  ctx.box.add_child(stack);

  seconds = SECONDS_CHOICES.indexOf(api.state.get('seconds')) >= 0 ? api.state.get('seconds') : 10;
  paused = api.state.get('paused') === true;
  captionBar.visible = api.state.get('captions') !== false;

  api.menu.set(function () {
    return [
      { label: 'Next picture', enabled: images.length > 1, onSelect: function () { next(ctx, api); } },
      { label: 'Pause slideshow', checked: paused, enabled: images.length > 1,
        onSelect: function () { paused = !paused; api.state.set('paused', paused); } },
      {
        label: 'Change every',
        items: SECONDS_CHOICES.map(function (n) {
          return { label: n + ' seconds', checked: n === seconds,
            onSelect: function () { seconds = n; api.state.set('seconds', n); ticks = 0; } };
        }),
      },
      { label: 'Show picture name', checked: captionBar.visible,
        onSelect: function () { captionBar.visible = !captionBar.visible; api.state.set('captions', captionBar.visible); } },
      { separator: true },
      {
        label: 'Open picture',
        enabled: images.length > 0,
        onSelect: function () {
          try {
            ctx.Gio.AppInfo.launch_default_for_uri(ctx.GLib.filename_to_uri(images[index], null), null);
          } catch (e) {
            api.widget.log('Cannot open ' + images[index] + ': ' + e);
          }
        },
      },
    ];
  });

  if (images.length === 0) {
    caption.text = 'No pictures found';
    return;
  }
  show(ctx, api, false);
  fitted = room(api).w + 'x' + room(api).h;
}

function update(ctx, api) {
  if (images.length === 0) return;

  // Re-crop the picture on show if the widget was resized
  var now = room(api).w + 'x' + room(api).h;
  if (now !== fitted) {
    fitted = now;
    front.set_style(picture(ctx, api, images[index]));
  }

  if (images.length < 2 || paused) return;
  ticks++;
  if (ticks >= seconds) next(ctx, api);
}

function onResize(ctx, api) {
  if (images.length === 0 || !front) return;
  fitted = room(api).w + 'x' + room(api).h;
  front.set_style(picture(ctx, api, images[index]));
}

function onClick(ctx, api) {
  next(ctx, api);
}
