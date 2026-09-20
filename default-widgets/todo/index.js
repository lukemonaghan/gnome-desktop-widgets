// Sticky Note Widget
// Two kinds of note, chosen per note:
//   Checklist  Click the entry to type, Enter adds an item, click a box to tick
//              it, ✕ deletes an item.
//   Free text  Click the note and type; Enter starts a new line.
// Everything is saved with api.state. Drag the note by its title, like a title
// bar; hold the drag key anywhere else to move it. Right-click for the colour
// (nine to pick from, remembered per note), converting between the two kinds,
// clearing done items, adding another note and deleting this one (the last note
// stays). A new note takes the next colour in the list.

var items = [];
var kind = 'list';     // 'list' or 'text'
var body;              // holds the list or the text, rebuilt when the kind changes
var textEntry;         // free-text note
var textSave = 0;      // pending save timer
var boxHeight = 256;
var list;
var scroll;
var entry;
var title;
var hint;
var textActive = false;   // the free-text box has key focus: show it as a box
var entryActive = false;  // the checklist entry has key focus
var entryHover = false;   // ... or is under the pointer

// Each colour: paper gradient (top, bottom), ink as [r, g, b], and the fill of
// the input box (a dark note needs a pale one, a pale note a white one).
var PALETTES = {
  yellow:   { label: 'Yellow',   top: '#ffe873', bottom: '#ffd84a', ink: [58, 48, 0],   field: 'rgba(255, 255, 255, 0.55)' },
  orange:   { label: 'Orange',   top: '#ffcf9e', bottom: '#ffa95c', ink: [77, 40, 0],   field: 'rgba(255, 255, 255, 0.55)' },
  pink:     { label: 'Pink',     top: '#ffc2d9', bottom: '#ff9ec4', ink: [74, 20, 44],  field: 'rgba(255, 255, 255, 0.55)' },
  purple:   { label: 'Purple',   top: '#ddc6ff', bottom: '#b892f0', ink: [45, 20, 80],  field: 'rgba(255, 255, 255, 0.55)' },
  blue:     { label: 'Blue',     top: '#b9dcff', bottom: '#86bdf5', ink: [12, 40, 80],  field: 'rgba(255, 255, 255, 0.55)' },
  mint:     { label: 'Mint',     top: '#b8f0e0', bottom: '#7fdcc3', ink: [10, 58, 50],  field: 'rgba(255, 255, 255, 0.55)' },
  green:    { label: 'Green',    top: '#c9f2a8', bottom: '#9bdb6e', ink: [25, 60, 10],  field: 'rgba(255, 255, 255, 0.55)' },
  white:    { label: 'White',    top: '#fbfbf9', bottom: '#e4e4e0', ink: [40, 40, 40],  field: 'rgba(0, 0, 0, 0.06)' },
  graphite: { label: 'Graphite', top: '#484c5c', bottom: '#2f323e', ink: [240, 242, 248], field: 'rgba(255, 255, 255, 0.12)' },
};
var ORDER = ['yellow', 'orange', 'pink', 'purple', 'blue', 'mint', 'green', 'white', 'graphite'];

var colour = 'yellow';
var INK = '';
var FADED = '';
var LINE = '';

function rgba(ink, alpha) {
  return 'rgba(' + ink[0] + ', ' + ink[1] + ', ' + ink[2] + ', ' + alpha + ')';
}

function nextColour(name) {
  return ORDER[(ORDER.indexOf(name) + 1) % ORDER.length];
}

// Switch to a colour: recolour everything already on screen
function paint(ctx, api) {
  var p = PALETTES[colour];
  INK = rgba(p.ink, 1);
  FADED = rgba(p.ink, 0.5);
  LINE = rgba(p.ink, 0.14);

  ctx.setStyle('background-gradient-direction: vertical; background-gradient-start: ' + p.top +
    '; background-gradient-end: ' + p.bottom + '; border-radius: 20px; border: 1px solid ' + LINE + ';');
  title.set_style('font-weight: bold; color: ' + INK + ';');
  paintBody(ctx, api);
}

// The input box's look. Only drawn as a box while it is being used (typing, or
// for the checklist also hovering); otherwise it reads as plain text on the note.
function field(active) {
  return 'background-color: ' + (active ? PALETTES[colour].field : 'transparent') +
    '; color: ' + INK + '; caret-color: ' + INK +
    '; border-radius: 12px; border-width: 0; box-shadow: none;';
}

function paintField() {
  if (kind === 'text' && textEntry) {
    var fill = Math.max(48, boxHeight - 100);
    textEntry.set_style(field(textActive) + ' padding: 8px 12px; min-height: ' + fill + 'px;');
    // The entry centres its text vertically; giving the text the whole height
    // (less the 16px of padding) keeps it at the top left
    textEntry.clutter_text.min_height = fill - 16;
  } else if (entry) {
    entry.set_style(field(entryActive || entryHover) + ' padding: 6px 12px;');
  }
  if (hint) hint.set_style('color: ' + FADED + ';');
}

// Colour the entry (or text area) and fill the list
function paintBody(ctx, api) {
  paintField();
  if (kind === 'list') rebuild(ctx, api);
}

function setColour(ctx, api, name) {
  if (!PALETTES[name]) return;
  colour = name;
  api.state.set('colour', name);
  paint(ctx, api);
}

function save(api) {
  api.state.set('items', items);
}

function saveText(api) {
  if (textSave) clearTimeout(textSave);
  textSave = 0;
  if (textEntry) api.state.set('text', textEntry.get_text());
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
      text: 'Nothing yet. Click below to add an item.',
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

function onResize(ctx, api, w, h) {
  boxHeight = h;
  if (kind === 'text' && textEntry) paintBody(ctx, api);
}

function clearDone(ctx, api) {
  items = items.filter(function (it) { return !it.done; });
  save(api);
  later(ctx, function () { rebuild(ctx, api); });
}

// The new note gets the next colour, so notes are easy to tell apart
function newNote(api, newKind) {
  api.instances.create({ colour: nextColour(colour), kind: newKind });
}

// A scrolling area around a widget that fills it
function scrollArea(ctx, child) {
  var St = ctx.St;
  var area = new St.ScrollView({
    x_expand: true,
    y_expand: true,
    hscrollbar_policy: St.PolicyType.NEVER,
    vscrollbar_policy: St.PolicyType.AUTOMATIC,
    overlay_scrollbars: true,
  });
  // A scroll view only takes scrollable children (a box, not a bare entry)
  if (child instanceof St.Entry) {
    var wrap = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true });
    wrap.add_child(child);
    child = wrap;
  }
  if (area.set_child) area.set_child(child);
  else area.add_actor(child);
  return area;
}

// The checklist or the free-text area, depending on the kind
function buildBody(ctx, api) {
  var St = ctx.St;
  saveText(api);
  body.destroy_all_children();
  entry = null;
  textEntry = null;
  hint = null;
  textActive = false;
  entryActive = false;
  entryHover = false;

  if (kind === 'text') {
    textEntry = new St.Entry({ hint_text: 'Write something…', can_focus: true, x_expand: true });
    var t = textEntry.clutter_text;
    t.set_single_line_mode(false);
    t.set_activatable(false);           // Enter is a new line, not "done"
    t.set_line_wrap(true);
    t.set_line_wrap_mode(ctx.Pango.WrapMode.WORD_CHAR);
    t.set_ellipsize(ctx.Pango.EllipsizeMode.NONE);
    textEntry.set_text(String(api.state.get('text') || ''));
    hint = textEntry.get_hint_actor && textEntry.get_hint_actor();
    // Keys only reach the entry while the widget holds a modal grab
    // Listen on the entry, not its text: the text is only one line tall, but
    // the entry fills the note, so a click anywhere in it must start typing
    textEntry.reactive = true;
    textEntry.connect('button-press-event', function () {
      api.input.grab(textEntry);
      return false;
    });
    // Key focus, not the click, says whether the note is being edited: it also
    // ends on Escape or a click outside
    t.connect('key-focus-in', function () { textActive = true; paintField(); });
    t.connect('key-focus-out', function () { textActive = false; paintField(); });
    // Save shortly after typing stops
    t.connect('text-changed', function () {
      if (textSave) clearTimeout(textSave);
      textSave = setTimeout(function () { textSave = 0; saveText(api); }, 600);
    });
    scroll = scrollArea(ctx, textEntry);
    body.add_child(scroll);
  } else {
    list = new St.BoxLayout({ vertical: true, x_expand: true, style: 'spacing: 4px;' });
    scroll = scrollArea(ctx, list);
    body.add_child(scroll);

    entry = new St.Entry({ hint_text: 'Add an item…', can_focus: true, x_expand: true });
    // The theme's hint text is near-white, which vanishes on a pale note
    hint = entry.get_hint_actor && entry.get_hint_actor();
    entry.connect('button-press-event', function () {
      api.input.grab(entry);
      return false; // let the entry handle the click (caret, selection)
    });
    entry.reactive = true;
    entry.track_hover = true;
    entry.connect('notify::hover', function () { entryHover = entry.hover; paintField(); });
    entry.clutter_text.connect('key-focus-in', function () { entryActive = true; paintField(); });
    entry.clutter_text.connect('key-focus-out', function () { entryActive = false; paintField(); });
    entry.clutter_text.connect('activate', function () {
      addItem(ctx, api);
    });
    body.add_child(entry);
  }

  title.text = kind === 'text' ? 'Note' : 'Checklist';
}

// Switch this note to the other kind, carrying its content across
function convert(ctx, api) {
  saveText(api);
  if (kind === 'list') {
    api.state.set('text', items.map(function (it) { return it.text; }).join('\n'));
    kind = 'text';
  } else {
    var lines = String(api.state.get('text') || '').split('\n');
    items = lines.map(function (l) { return l.trim(); }).filter(function (l) { return l; })
      .map(function (l) { return { text: l, done: false }; });
    save(api);
    kind = 'list';
  }
  api.state.set('kind', kind);
  api.input.release();
  buildBody(ctx, api);
  paintBody(ctx, api);
}

function render(ctx, api) {
  var St = ctx.St;
  var stored = api.state.get('items');
  items = Array.isArray(stored) ? stored : [];
  kind = api.state.get('kind') === 'text' ? 'text' : 'list';
  colour = PALETTES[api.state.get('colour')] ? api.state.get('colour') : 'yellow';
  textSave = 0;

  var root = new St.BoxLayout({
    vertical: true,
    x_expand: true,
    y_expand: true,
    style: 'padding: 10px; spacing: 8px;',
  });

  // Title bar: dragging it moves the note without the drag key. The header, not
  // the label, is the drag region: a label counts as a control and would eat the press
  var header = new St.BoxLayout({ x_expand: true, style: 'padding: 2px 4px 4px 4px;' });
  ctx.setDragRegion(header);
  title = new St.Label({
    text: '',
    reactive: false,
    x_expand: true,
    y_align: ctx.Clutter.ActorAlign.CENTER,
  });
  header.add_child(title);
  root.add_child(header);

  body = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true, style: 'spacing: 8px;' });
  root.add_child(body);
  ctx.box.add_child(root);

  boxHeight = ctx.box.get_height() || 256;
  buildBody(ctx, api);
  paint(ctx, api);    // colours everything, then fills the list

  api.menu.set(function () {
    return [
      {
        label: 'Colour',
        items: ORDER.map(function (name) {
          return {
            label: PALETTES[name].label,
            checked: name === colour,
            onSelect: function () { setColour(ctx, api, name); },
          };
        }),
      },
      {
        label: kind === 'list' ? 'Convert to free text' : 'Convert to checklist',
        onSelect: function () { convert(ctx, api); },
      },
      { separator: true },
      { label: 'Clear done', enabled: kind === 'list' && items.some(function (it) { return it.done; }),
        onSelect: function () { clearDone(ctx, api); } },
      { label: 'New checklist', onSelect: function () { newNote(api, 'list'); } },
      { label: 'New text note', onSelect: function () { newNote(api, 'text'); } },
      { label: 'Delete note', enabled: api.instances.count() > 1,
        onSelect: function () { api.instances.remove(); } },
    ];
  });

  return function cleanup() {
    saveText(api);
    api.input.release();
  };
}
