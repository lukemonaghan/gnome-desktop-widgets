// Image Slideshow Widget
// Cycles through the pictures found in the system wallpaper folder and the
// user's ~/.local/share/backgrounds, changing every SECONDS_PER_IMAGE.

var SECONDS_PER_IMAGE = 10;
var MAX_IMAGES = 40;
var EXTENSIONS = /\.(jpe?g|png|svg|webp)$/i;

var images = [];
var index = 0;
var ticks = 0;
var icon;

function scan(ctx, dir) {
  var found = [];
  try {
    var folder = ctx.Gio.File.new_for_path(dir);
    if (!folder.query_exists(null)) return found;
    var en = folder.enumerate_children('standard::name', ctx.Gio.FileQueryInfoFlags.NONE, null);
    var info;
    while ((info = en.next_file(null))) {
      var name = info.get_name();
      if (EXTENSIONS.test(name)) found.push(dir + '/' + name);
    }
  } catch (e) { /* unreadable folder: skip it */ }
  return found;
}

function show(ctx) {
  if (images.length === 0) return;
  icon.set_gicon(new ctx.Gio.FileIcon({ file: ctx.Gio.File.new_for_path(images[index]) }));
}

function render(ctx, api) {
  images = scan(ctx, '/usr/share/backgrounds/gnome')
    .concat(scan(ctx, ctx.GLib.get_user_data_dir() + '/backgrounds'))
    .sort()
    .slice(0, MAX_IMAGES);

  icon = new ctx.St.Icon({ icon_size: 200, x_align: ctx.Clutter.ActorAlign.CENTER });
  ctx.box.add_child(icon);
  if (images.length === 0) {
    ctx.box.add_child(new ctx.St.Label({ text: 'No images found' }));
    return;
  }
  show(ctx);
}

function update(ctx, api) {
  if (images.length < 2) return;
  ticks++;
  if (ticks < SECONDS_PER_IMAGE) return;
  ticks = 0;
  index = (index + 1) % images.length;
  show(ctx);
}
