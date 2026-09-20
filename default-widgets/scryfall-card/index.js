// MTG Card Widget
// Shows a Magic: The Gathering card from Scryfall (https://scryfall.com/docs/api).
//
//   Hover        set, prices and legality (the card itself shows the rest); in
//                art-only view also rules text (mana symbols drawn as pictures)
//   Click        another random card (unless a card was set)
//   Right click  menu: random card, filters, set a card, art only, Scryfall, add/remove
//
// "Add another card" makes a second copy of the widget, each with its own card.
// Filters (colour, legendary, type, rarity, format) narrow the random cards
// using Scryfall's search syntax; changing one draws a new card.
// "Set card" takes a card name (fuzzy: "lightning bolt") or "set/number"
// ("mh3/123") and keeps that card until a random one is asked for. The card,
// the choice of set-or-random and art-or-card are remembered across restarts.

var API = 'https://api.scryfall.com';
var SYMBOL_URL = 'https://svgs.scryfall.io/card-symbols/';
// Scryfall requires a User-Agent and an Accept header on every request
var JSON_HEADERS = { 'User-Agent': 'GnomeDesktopWidgets/1.0', 'Accept': 'application/json' };
var FILE_HEADERS = { 'User-Agent': 'GnomeDesktopWidgets/1.0', 'Accept': '*/*' };

var CARD_RATIO = 488 / 680;      // Scryfall "normal" images
var ART_RATIO = 626 / 457;       // Scryfall "art_crop" images
var MIN_REQUEST_GAP_MS = 1000;   // between random cards; Scryfall asks for 50-100 ms
var PAD_X = 24;                  // the engine's default widget padding
var PAD_Y = 16;

var FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'];
var COLOURS = [
  ['w', 'White'], ['u', 'Blue'], ['b', 'Black'], ['r', 'Red'], ['g', 'Green'],
  ['c', 'Colourless'], ['m', 'Multicolour'],
];
var TYPES = [
  'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle',
];
var RARITIES = ['common', 'uncommon', 'rare', 'mythic'];
var RARITY_COLOURS = {
  common: '#c8c8c8', uncommon: '#9cc2d6', rare: '#e6c257', mythic: '#f28c38',
};

var root;        // fixed-size stack the size of the image
var art;         // the image
var overlay;     // scrollable details, shown on hover
var details;     // its content
var status;      // "Loading..." / error text
var entryBox;    // "set card" input, shown while editing
var entry;
var entryNote;

var card = null;       // the card on show (see slim())
var cardMode = 'random';   // 'random' (click for another) or 'fixed' (set by the user)
var view = 'card';     // 'card' (whole card) or 'art' (artwork only)
var filters = emptyFilters();   // what random cards may be
var imagePath = null;
var symbolPaths = {};  // "{G}" -> downloaded SVG
var busy = false;
var editing = false;
var lastRequest = 0;
var fitted = '';

// ── filters ─────────────────────────────────────────────────────────

function emptyFilters() {
  return { colours: [], legendary: false, type: '', rarity: '', format: '' };
}

// Saved state may be from an older version or hand edited: keep only known values
function cleanFilters(f) {
  var out = emptyFilters();
  if (!f || typeof f !== 'object') return out;
  var codes = COLOURS.map(function (c) { return c[0]; });
  if (Array.isArray(f.colours))
    out.colours = codes.filter(function (c) { return f.colours.indexOf(c) >= 0; });
  out.legendary = f.legendary === true;
  if (TYPES.indexOf(f.type) >= 0) out.type = f.type;
  if (RARITIES.indexOf(f.rarity) >= 0) out.rarity = f.rarity;
  if (FORMATS.indexOf(f.format) >= 0) out.format = f.format;
  return out;
}

function filterCount() {
  return filters.colours.length + (filters.legendary ? 1 : 0) +
    (filters.type ? 1 : 0) + (filters.rarity ? 1 : 0) + (filters.format ? 1 : 0);
}

// Scryfall search: https://scryfall.com/docs/syntax. Several colours mean "any of".
function filterQuery() {
  var parts = [];
  if (filters.colours.length) {
    var any = filters.colours.map(function (c) { return 'c:' + c; }).join(' or ');
    parts.push(filters.colours.length > 1 ? '(' + any + ')' : any);
  }
  if (filters.legendary) parts.push('t:legendary');
  if (filters.type) parts.push('t:' + filters.type);
  if (filters.rarity) parts.push('r:' + filters.rarity);
  if (filters.format) parts.push('f:' + filters.format);
  return parts.join(' ');
}

function capital(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ── data ────────────────────────────────────────────────────────────

// Keep only what the widget shows, so the saved state stays small
function slim(c) {
  function uris(u) {
    return u ? { normal: u.normal, art_crop: u.art_crop } : undefined;
  }
  function face(f) {
    return {
      name: f.name, mana_cost: f.mana_cost, type_line: f.type_line,
      oracle_text: f.oracle_text, flavor_text: f.flavor_text,
      power: f.power, toughness: f.toughness, loyalty: f.loyalty,
      image_uris: uris(f.image_uris),
    };
  }
  var out = face(c);
  out.id = c.id;
  out.set = c.set;
  out.set_name = c.set_name;
  out.collector_number = c.collector_number;
  out.rarity = c.rarity;
  out.artist = c.artist;
  out.released_at = c.released_at;
  out.prices = c.prices || {};
  out.legalities = c.legalities || {};
  out.scryfall_uri = c.scryfall_uri;
  if (c.card_faces) out.card_faces = c.card_faces.map(face);
  return out;
}

function imageUrl(c, which) {
  var u = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {};
  return (which === 'art' ? u.art_crop : u.normal) || null;
}

// Where to fetch this card again (e.g. state saved before art crops were kept)
function refreshUrl(c) {
  return c.id ? API + '/cards/' + c.id : API + '/cards/named?exact=' + encodeURIComponent(c.name);
}

// "mh3/123" is a printing; anything else is a (fuzzy) card name
function queryUrl(q) {
  var m = q.match(/^([A-Za-z0-9]{2,6})\s*\/\s*(\d+[A-Za-z★†]?)$/);
  if (m) return API + '/cards/' + m[1].toLowerCase() + '/' + encodeURIComponent(m[2]);
  return API + '/cards/named?fuzzy=' + encodeURIComponent(q);
}

// "{W/U}" -> ".../WU.svg", "{∞}" -> ".../INFINITY.svg"
function symbolUrl(token) {
  var name = token.slice(1, -1);
  if (name === '∞') name = 'INFINITY';
  else if (name === '½') name = 'HALF';
  return SYMBOL_URL + name.replace(/\//g, '') + '.svg';
}

function symbolsIn(c) {
  var found = {};
  var faces = c.card_faces && c.card_faces.length ? c.card_faces.concat([c]) : [c];
  faces.forEach(function (f) {
    ((f.mana_cost || '') + ' ' + (f.oracle_text || '')).replace(/\{[^}]+\}/g, function (t) {
      found[t] = true;
    });
  });
  return Object.keys(found);
}

function money(value, symbol) {
  return value ? symbol + value : '—';
}

// ── details ─────────────────────────────────────────────────────────

function text(ctx, value, style) {
  var l = new ctx.St.Label({ text: value, x_expand: true, style: style || '' });
  l.clutter_text.set_line_wrap(true);
  l.clutter_text.set_line_wrap_mode(ctx.Pango.WrapMode.WORD_CHAR);
  l.clutter_text.set_ellipsize(ctx.Pango.EllipsizeMode.NONE);
  return l;
}

// Text with the mana symbols shown as pictures
function rich(ctx, value, style, iconSize) {
  return ctx.createRichText(value, {
    images: function (token) { return symbolPaths[token] || null; },
    iconSize: iconSize || 13,
    style: style || '',
  });
}

function buildDetails(ctx, c) {
  var St = ctx.St;
  var DIM = 'color: rgba(255, 255, 255, 0.6); font-size: 8pt;';
  details.destroy_all_children();

  // Single-faced cards carry their text at the top level; double-faced,
  // split and adventure cards only on each face.
  var faces = c.card_faces && c.card_faces.length && !c.oracle_text ? c.card_faces : [c];

  // The whole card is on show, so its text is not repeated here. Only the
  // back of a double-faced card (a second image) is not visible.
  var hidden = view === 'card' ? (c.image_uris ? faces.length : 1) : 0;
  faces.slice(hidden).forEach(function (f, i) {
    if (i > 0) details.add_child(text(ctx, '───────', DIM));

    var head = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;' });
    head.add_child(text(ctx, f.name, 'font-weight: bold; font-size: 11pt;'));
    if (f.mana_cost) {
      var cost = rich(ctx, f.mana_cost, 'font-size: 9pt;', 15);
      cost.x_expand = false;
      head.add_child(cost);
    }
    details.add_child(head);

    details.add_child(text(ctx, f.type_line || '', DIM));
    if (f.oracle_text) details.add_child(rich(ctx, f.oracle_text, 'font-size: 9pt;', 13));
    if (f.flavor_text)
      details.add_child(text(ctx, f.flavor_text, DIM + ' font-style: italic;'));
    if (f.power !== undefined && f.power !== null)
      details.add_child(text(ctx, f.power + ' / ' + f.toughness, 'font-weight: bold;'));
    else if (f.loyalty)
      details.add_child(text(ctx, 'Loyalty ' + f.loyalty, 'font-weight: bold;'));
  });

  var top = hidden < faces.length ? ' margin-top: 4px;' : '';
  if (view === 'art') {
    var rarity = c.rarity || '';
    details.add_child(text(ctx,
      (c.set_name || '') + ' (' + String(c.set || '').toUpperCase() + ') #' + c.collector_number,
      'font-size: 9pt;' + top));
    details.add_child(text(ctx,
      rarity.charAt(0).toUpperCase() + rarity.slice(1) + '  ·  ' + (c.released_at || ''),
      'font-size: 9pt; color: ' + (RARITY_COLOURS[rarity] || '#ffffff') + ';'));
    if (c.artist) details.add_child(text(ctx, 'Illustrated by ' + c.artist, DIM));
  } else {
    // The card shows the set code and number, not the set's name or date
    details.add_child(text(ctx,
      (c.set_name || '') + (c.released_at ? '  ·  ' + c.released_at : ''),
      'font-size: 9pt;' + top));
  }

  var p = c.prices || {};
  details.add_child(text(ctx,
    'USD  ' + money(p.usd, '$') + '    Foil  ' + money(p.usd_foil, '$'),
    'font-size: 9pt; margin-top: 4px;'));
  details.add_child(text(ctx,
    'EUR  ' + money(p.eur, '€') + '    Foil  ' + money(p.eur_foil, '€') +
    '    TIX  ' + money(p.tix, ''), 'font-size: 9pt;'));

  var legal = FORMATS.filter(function (f) {
    return c.legalities && c.legalities[f] === 'legal';
  }).map(function (f) { return f.charAt(0).toUpperCase() + f.slice(1); });
  details.add_child(text(ctx,
    legal.length ? 'Legal: ' + legal.join(', ') : 'Not legal in the main formats',
    DIM + ' margin-top: 4px;'));
}

// ── layout ──────────────────────────────────────────────────────────

function ratio() {
  return view === 'art' ? ART_RATIO : CARD_RATIO;
}

// Fit the image into the widget's current size (it may have been resized)
function fit(ctx, api) {
  var layout = api.widget.getLayout();
  var availW = Math.max(64, (layout.width || 260) - PAD_X);
  var availH = Math.max(64, (layout.height || 380) - PAD_Y);
  var w = Math.round(Math.min(availW, availH * ratio()));
  var h = Math.round(w / ratio());
  var key = w + 'x' + h + ':' + view + ':' + imagePath;
  if (key === fitted) return;
  fitted = key;

  root.set_size(w, h);
  var style = 'border-radius: 10px;';
  if (imagePath) {
    // St draws a background image at its natural size unless told otherwise.
    // The actor is already exactly the image's shape, so scale to fill it.
    style += ' background-image: url("' + ctx.GLib.filename_to_uri(imagePath, null) + '");' +
      ' background-size: ' + w + 'px ' + h + 'px; background-position: 0 0;';
  }
  art.set_style(style);
}

// Keep the widget's width and make it as tall as the image needs
function resizeForView(api) {
  var layout = api.widget.getLayout();
  var width = layout.width || 260;
  api.widget.setSize(width, Math.round((width - PAD_X) / ratio()) + PAD_Y);
}

function setStatus(message) {
  status.text = message || '';
  status.visible = !!message;
}

// A message over the card that goes away by itself
function flash(message) {
  setStatus(message);
  setTimeout(function () {
    if (card && status && status.text === message) setStatus(null);
  }, 3000);
}

function syncOverlay() {
  overlay.visible = root.hover && !editing && card !== null;
}

function show(ctx, api, c, path, mode) {
  card = c;
  cardMode = mode;
  imagePath = path;
  buildDetails(ctx, c);
  setStatus(null);
  fitted = '';
  fit(ctx, api);
  syncOverlay();
}

// ── loading ─────────────────────────────────────────────────────────

// Download the image for the current view and every symbol the card uses.
// done(path) gets the image path, or null if the image could not be had.
// Symbols that fail simply stay as text.
function prepare(ctx, api, c, done) {
  var symbols = symbolsIn(c);
  var pending = symbols.length + 2;   // + the image, + this function's own hold
  var path = null;

  function one() {
    pending--;
    if (pending === 0) done(path);
  }

  var url = imageUrl(c, view);
  if (url) {
    api.network.download(url, { headers: FILE_HEADERS }, function (res) {
      path = res.ok ? res.path : null;
      one();
    });
  } else {
    one();
  }

  symbols.forEach(function (token) {
    if (symbolPaths[token]) { one(); return; }
    api.network.download(symbolUrl(token), { headers: FILE_HEADERS }, function (res) {
      if (res.ok) symbolPaths[token] = res.path;
      one();
    });
  });
  one();
}

// Fetch a card from Scryfall and show it. Swaps cards only once the new
// image is on disk, so nothing flickers. done(errorMessage) is optional:
// null on success.
function request(ctx, api, url, mode, done) {
  busy = true;
  lastRequest = Date.now();

  function finish(error) {
    busy = false;
    if (error) {
      api.widget.log(error);
      if (!card) setStatus(error + '\nRight click for options');
    }
    if (done) done(error);
  }

  api.network.fetchAsync(url, { headers: JSON_HEADERS }, function (res) {
    var data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = null; }
    if (!res.ok || !data || !data.name) {
      finish((data && data.details) || 'Scryfall unavailable (HTTP ' + res.status + ')');
      return;
    }

    var next = slim(data);
    prepare(ctx, api, next, function (path) {
      if (!path) {
        finish('Could not load the image for ' + next.name);
        return;
      }
      show(ctx, api, next, path, mode);
      api.state.set('card', next);
      api.state.set('mode', mode);
      finish(null);
    });
  });
}

function loadRandom(ctx, api, force) {
  if (busy || (!force && Date.now() - lastRequest < MIN_REQUEST_GAP_MS)) return;
  if (!card) setStatus('Loading…');
  var query = filterQuery();
  var url = API + '/cards/random' + (query ? '?q=' + encodeURIComponent(query) : '');
  request(ctx, api, url, 'random', function (error) {
    if (error && card) flash(query ? 'No card matches these filters' : error);
  });
}

// Filters only shape random cards, so changing one asks for a new one
function setFilters(ctx, api, next) {
  filters = next;
  api.state.set('filters', filters);
  loadRandom(ctx, api, true);
}

function setCard(ctx, api, query) {
  if (busy) {
    entryNote.text = 'Busy, try again in a moment';
    return;
  }
  entryNote.text = 'Searching…';
  request(ctx, api, queryUrl(query), 'fixed', function (error) {
    if (error) entryNote.text = error;
    else stopEditing(api);
  });
}

function setView(ctx, api, next) {
  if (busy || next === view) return;
  view = next;
  api.state.set('view', view);
  resizeForView(api);
  if (!card) return;

  // State saved by an older version has no artwork; fetch the card again
  if (!imageUrl(card, view)) {
    request(ctx, api, refreshUrl(card), cardMode);
    return;
  }
  busy = true;
  prepare(ctx, api, card, function (path) {
    busy = false;
    if (path) show(ctx, api, card, path, cardMode);
  });
}

// ── set card (text entry) ───────────────────────────────────────────

function startEditing(ctx, api) {
  if (editing) return;
  editing = true;
  entry.set_text('');
  entryNote.text = '';
  entryBox.visible = true;
  syncOverlay();
  // Keys only reach the entry while the widget holds a modal grab. Wait a
  // moment so the entry is on screen (and the menu is gone) first.
  setTimeout(function () {
    if (editing && !api.input.grab(entry, function () { stopEditing(api); }))
      stopEditing(api);
  }, 50);
}

function stopEditing(api) {
  if (!editing) return;
  editing = false;
  entryBox.visible = false;
  syncOverlay();
  api.input.release();
}

// ── widget ──────────────────────────────────────────────────────────

// The shell's popup menu closes a submenu when another one opens inside it, so
// nothing here is nested more than one level deep.
function filterItems(ctx, api) {
  function change(edit) {
    var next = cleanFilters(filters);
    edit(next);
    setFilters(ctx, api, next);
  }

  function current(key) {
    return filters[key] ? ': ' + capital(filters[key]) : '';
  }

  // One choice out of a list; picking the current one (or "Any") clears it
  function choice(key, values, label) {
    return [{
      label: 'Any',
      checked: !filters[key],
      onSelect: function () { change(function (f) { f[key] = ''; }); },
    }].concat(values.map(function (v) {
      return {
        label: label ? label(v) : capital(v),
        checked: filters[key] === v,
        onSelect: function () { change(function (f) { f[key] = v; }); },
      };
    }));
  }

  return [
    {
      label: 'Colour' + (filters.colours.length ? ' (' + filters.colours.length + ')' : ''),
      items: COLOURS.map(function (c) {
        return {
          label: c[1],
          checked: filters.colours.indexOf(c[0]) >= 0,
          onSelect: function () {
            change(function (f) {
              var at = f.colours.indexOf(c[0]);
              if (at >= 0) f.colours.splice(at, 1);
              else f.colours.push(c[0]);
            });
          },
        };
      }).concat([
        { separator: true },
        {
          label: 'Any colour',
          enabled: filters.colours.length > 0,
          onSelect: function () { change(function (f) { f.colours = []; }); },
        },
      ]),
    },
    {
      label: 'Legendary',
      checked: filters.legendary,
      onSelect: function () { change(function (f) { f.legendary = !f.legendary; }); },
    },
    { label: 'Type' + current('type'), items: choice('type', TYPES) },
    { label: 'Rarity' + current('rarity'), items: choice('rarity', RARITIES) },
    { label: 'Legal in' + current('format'), items: choice('format', FORMATS) },
    { separator: true },
    {
      label: 'Clear filters',
      enabled: filterCount() > 0,
      onSelect: function () { setFilters(ctx, api, emptyFilters()); },
    },
  ];
}

function menuItems(ctx, api) {
  return [
    { label: 'Random card', onSelect: function () { loadRandom(ctx, api, true); } },
    { separator: true },
  ].concat(filterItems(ctx, api)).concat([
    { separator: true },
    { label: 'Set card…', onSelect: function () { startEditing(ctx, api); } },
    { separator: true },
    {
      label: 'Show art only',
      checked: view === 'art',
      onSelect: function () { setView(ctx, api, view === 'art' ? 'card' : 'art'); },
    },
    {
      label: 'Open on Scryfall',
      enabled: !!(card && card.scryfall_uri),
      onSelect: function () {
        try {
          ctx.Gio.AppInfo.launch_default_for_uri(card.scryfall_uri, null);
        } catch (e) {
          api.widget.log('Cannot open ' + card.scryfall_uri + ': ' + e);
        }
      },
    },
    { separator: true },
    { label: 'Add another card', onSelect: function () { api.instances.create({ view: view, filters: filters }); } },
    {
      label: 'Remove this card',
      enabled: api.instances.count() > 1,
      onSelect: function () { api.instances.remove(); },
    },
  ]);
}

function render(ctx, api) {
  var St = ctx.St;
  var Clutter = ctx.Clutter;

  cardMode = api.state.get('mode') === 'fixed' ? 'fixed' : 'random';
  view = api.state.get('view') === 'art' ? 'art' : 'card';
  filters = cleanFilters(api.state.get('filters'));

  root = new St.Widget({
    layout_manager: new Clutter.BinLayout(),
    reactive: true,
    track_hover: true,
    x_align: Clutter.ActorAlign.CENTER,
    y_align: Clutter.ActorAlign.CENTER,
  });

  art = new St.Bin({ x_expand: true, y_expand: true });
  root.add_child(art);

  status = new St.Label({
    text: '', visible: false,
    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
    style: 'text-align: center; padding: 8px 12px; margin: 12px; border-radius: 8px;' +
      ' background-color: rgba(10, 10, 16, 0.85);',
  });
  root.add_child(status);

  // Details cover the image while the pointer is over it
  details = new St.BoxLayout({ vertical: true, x_expand: true, style: 'spacing: 3px; padding: 10px;' });
  overlay = new St.ScrollView({
    x_expand: true, y_expand: true, visible: false,
    hscrollbar_policy: St.PolicyType.NEVER,
    vscrollbar_policy: St.PolicyType.AUTOMATIC,
    overlay_scrollbars: true,
    style: 'background-color: rgba(10, 10, 16, 0.92); border-radius: 10px;',
  });
  if (overlay.set_child) overlay.set_child(details);
  else overlay.add_actor(details);
  root.add_child(overlay);

  // "Set card" input along the bottom edge
  entryBox = new St.BoxLayout({
    vertical: true, visible: false,
    x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.END,
    style: 'spacing: 4px; padding: 8px; background-color: rgba(10, 10, 16, 0.92);' +
      ' border-radius: 10px;',
  });
  entry = new St.Entry({
    hint_text: 'Card name, or set/number (mh3/123)',
    can_focus: true,
    x_expand: true,
    style: 'background-color: rgba(255, 255, 255, 0.9); color: #202020;' +
      ' caret-color: #202020; border-radius: 6px; padding: 5px 8px;',
  });
  entry.clutter_text.connect('activate', function () {
    var query = entry.get_text().trim();
    if (query) setCard(ctx, api, query);
    else stopEditing(api);
  });
  entry.clutter_text.connect('button-press-event', function () {
    if (editing) api.input.grab(entry, function () { stopEditing(api); });
    return false;
  });
  entryNote = text(ctx, '', 'font-size: 8pt; color: #f2a0a0;');
  entryBox.add_child(entry);
  entryBox.add_child(entryNote);
  root.add_child(entryBox);

  root.connect('notify::hover', syncOverlay);

  ctx.box.add_child(root);
  fit(ctx, api);

  api.menu.set(function () { return menuItems(ctx, api); });

  // Restore the last card; the files come straight from the download cache
  var saved = api.state.get('card');
  if (saved && saved.name) {
    setStatus('Loading…');
    if (!imageUrl(saved, view)) {
      request(ctx, api, refreshUrl(saved), cardMode);
    } else {
      busy = true;
      prepare(ctx, api, saved, function (path) {
        busy = false;
        if (path) show(ctx, api, saved, path, cardMode);
        else loadRandom(ctx, api, true);
      });
    }
  } else {
    loadRandom(ctx, api, true);
  }

  return function cleanup() {
    editing = false;
    api.input.release();
    card = null;
    imagePath = null;
    busy = false;
    fitted = '';
  };
}

// Follow the widget when it is resized
function onResize(ctx, api) {
  if (root) fit(ctx, api);
}

// Runs every second: catches anything the resize hook missed
function update(ctx, api) {
  if (root) fit(ctx, api);
}

// A plain click (no drag key, no movement) rolls a new card, unless one was set
function onClick(ctx, api) {
  if (cardMode === 'random' && !editing) loadRandom(ctx, api, false);
}
