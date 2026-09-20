// Sticky Note Widget
// Editable checklist. Click the entry to type, Enter adds an item, click a
// box to tick it, ✕ deletes an item. Items are saved with api.state.
// "+ New" adds another note, "Delete" removes this one (the last note stays).
// Drag the note by its header; hold the drag key anywhere else to move it.

var items = [];
var list;
var scroll;
var entry;
var deleteBtn;

var INK = '#3a3000';
var FADED = 'rgba(58, 48, 0, 0.45)';

function save(api) {
  api.state.set('items', items);
}

function later(ctx, fn) {
  ctx.GLib.idle_add(ctx.GLib.PRIORITY_DEFAULT, function () {
    fn();
    return ctx.GLib.SOURCE_REMOVE;
  });
}

function rebuild(ctx, api) {
  var St = ctx.St;
  list.destroy_all_children();

  if (items.length === 0) {
    list.add_child(new St.Label({
      text: 'Nothing yet. Click below to add a note.',
      style: 'color: ' + FADED + '; font-style: italic;',
    }));
    return;
  }

  items.forEach(function (item, i) {
    var row = new St.BoxLayout({ style: 'spacing: 6px;' });

    var check = new St.Button({
      label: item.done ? '☑' : '☐',
      can_focus: true,
      style: 'font-size: 14pt; padding: 0 2px; color: ' + INK + ';',
    });
    check.connect('clicked', function () {
      item.done = !item.done;
      save(api);
      later(ctx, function () { rebuild(ctx, api); });
    });

    var text = new St.Label({
      text: item.text,
      x_expand: true,
      y_align: ctx.Clutter.ActorAlign.CENTER,
      style: item.done
        ? 'color: ' + FADED + '; text-decoration: line-through;'
        : 'color: ' + INK + ';',
    });
    text.clutter_text.set_line_wrap(true);
    text.clutter_text.set_line_wrap_mode(ctx.Pango.WrapMode.WORD_CHAR);
    text.clutter_text.set_ellipsize(ctx.Pango.EllipsizeMode.NONE);

    var del = new St.Button({
      label: '✕',
      can_focus: true,
      style: 'padding: 0 4px; color: ' + FADED + ';',
    });
    del.connect('clicked', function () {
      items.splice(i, 1);
      save(api);
      later(ctx, function () { rebuild(ctx, api); });
    });

    row.add_child(check);
    row.add_child(text);
    row.add_child(del);
    list.add_child(row);
  });
}

function scrollToEnd(ctx) {
  later(ctx, function () {
    try {
      var adj = scroll.vadjustment;
      adj.value = adj.upper - adj.page_size;
    } catch (e) { /* older shells: leave the scroll position alone */ }
  });
}

function addItem(ctx, api) {
  var value = entry.get_text().trim();
  if (!value) return;
  items.push({ text: value, done: false });
  save(api);
  entry.set_text('');
  rebuild(ctx, api);
  scrollToEnd(ctx);
}

// The last remaining note can't be deleted, so its Delete button is hidden
function refreshDelete(api) {
  if (deleteBtn) deleteBtn.visible = api.instances.count() > 1;
}

// Runs once a second: notes may have been added or removed elsewhere
function update(ctx, api) {
  refreshDelete(api);
}

function render(ctx, api) {
  var St = ctx.St;
  var stored = api.state.get('items');
  items = Array.isArray(stored) ? stored : [];

  ctx.setStyle('background-color: #ffe066; border-radius: 10px;');

  var root = new St.BoxLayout({
    vertical: true,
    x_expand: true,
    y_expand: true,
    style: 'padding: 10px; spacing: 8px;',
  });

  // Header: title + actions
  var header = new St.BoxLayout({ style: 'spacing: 6px;' });
  ctx.setDragRegion(header);
  header.add_child(new St.Label({
    text: 'Note',
    x_expand: true,
    y_align: ctx.Clutter.ActorAlign.CENTER,
    style: 'font-weight: bold; color: ' + INK + ';',
  }));

  function headerButton(label, onClick) {
    var b = new St.Button({
      label: label,
      can_focus: true,
      style: 'font-size: 9pt; padding: 0 4px; color: ' + FADED + ';',
    });
    b.connect('clicked', onClick);
    header.add_child(b);
    return b;
  }

  headerButton('Clear done', function () {
    items = items.filter(function (it) { return !it.done; });
    save(api);
    later(ctx, function () { rebuild(ctx, api); });
  });
  headerButton('+ New', function () {
    api.instances.create();
  });
  deleteBtn = headerButton('Delete', function () {
    // Refused (and hidden) when this is the last note
    api.instances.remove();
  });
  refreshDelete(api);
  root.add_child(header);

  // Scrollable item list
  list = new St.BoxLayout({ vertical: true, x_expand: true, style: 'spacing: 4px;' });
  scroll = new St.ScrollView({
    x_expand: true,
    y_expand: true,
    hscrollbar_policy: St.PolicyType.NEVER,
    vscrollbar_policy: St.PolicyType.AUTOMATIC,
    overlay_scrollbars: true,
  });
  if (scroll.set_child) scroll.set_child(list);
  else scroll.add_actor(list);
  root.add_child(scroll);

  // New-item entry
  entry = new St.Entry({
    hint_text: 'Add a note…',
    can_focus: true,
    x_expand: true,
    style: 'background-color: rgba(255, 255, 255, 0.7); color: ' + INK +
      '; caret-color: ' + INK + '; border-radius: 6px; padding: 5px 8px;',
  });
  // Keys only reach the entry while the widget holds a modal grab
  entry.clutter_text.connect('button-press-event', function () {
    api.input.grab(entry);
    return false; // let the entry handle the click (caret, selection)
  });
  entry.clutter_text.connect('activate', function () {
    addItem(ctx, api);
  });
  root.add_child(entry);

  ctx.box.add_child(root);
  rebuild(ctx, api);

  return function cleanup() {
    api.input.release();
  };
}
