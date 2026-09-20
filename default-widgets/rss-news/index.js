// RSS News Feed Widget
// Headlines from any RSS or Atom feed, one at a time: a source chip, the
// headline and a pager. Rotates every 8 seconds; click for the next one.
// Right-click to open the article, set or add feeds, or refresh. With several
// feeds the newest headlines from all of them are mixed together.

var DEFAULT_FEEDS = ['https://feeds.bbci.co.uk/news/rss.xml'];
var ACCEPT = { 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' };
var SECONDS_PER_ITEM = 8;
var REFRESH_MS = 15 * 60 * 1000;
var MAX_ITEMS = 40;
var COLORS = ['blue', 'orange', 'green', 'purple', 'teal', 'yellow'];

var UI;
var T;
var chip;
var age;
var counter;
var headline;
var content;
var status;
var entryBox;
var entry;
var entryNote;

var feeds = [];
var items = [];       // { source, color, title, link, time }
var index = 0;
var ticks = 0;
var busy = false;
var editing = false;
var adding = false;   // the entry adds a feed instead of replacing them
var scale = 1;

// ── parsing ─────────────────────────────────────────────────────────

var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
    if (e.charAt(0) === '#') {
      var n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES.hasOwnProperty(e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}

// Text of the first <name> in a block, without CDATA wrappers or markup
function tag(block, name) {
  var m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  if (!m) return '';
  var v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decode(v.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function linkOf(block) {
  var text = tag(block, 'link');
  if (text) return text;
  // Atom: <link rel="alternate" href="..."/>
  var links = block.match(/<link\b[^>]*>/gi) || [];
  for (var i = 0; i < links.length; i++) {
    var href = links[i].match(/href=["']([^"']+)["']/i);
    if (href && !/rel=["'](?:self|enclosure|replies)["']/i.test(links[i])) return decode(href[1]);
  }
  return '';
}

// -> { title, items: [{ title, link, time }] }, or null if it is not a feed
function parseFeed(xml) {
  if (!xml || !/<(rss|feed|rdf:RDF)\b/i.test(xml)) return null;
  var blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  var head = xml.split(/<(?:item|entry)[\s>]/i)[0];
  var out = [];
  blocks.forEach(function (b) {
    var title = tag(b, 'title');
    if (!title) return;
    var date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    var time = Date.parse(date);
    out.push({ title: title, link: linkOf(b), time: isNaN(time) ? 0 : time });
  });
  return { title: tag(head, 'title'), items: out };
}

function hostOf(url) {
  var m = url.match(/^[a-z]+:\/\/([^\/?#]+)/i);
  return m ? m[1].replace(/^(www|feeds?|rss)\./i, '') : url;
}

function ago(time) {
  if (!time) return '';
  var mins = Math.floor((Date.now() - time) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + ' min ago';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  var days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : days + ' days ago';
}

// ── display ─────────────────────────────────────────────────────────

function setStatus(message) {
  status.text = message || '';
  status.visible = !!message;
  content.visible = !message;
}

function show() {
  if (items.length === 0) return;
  var item = items[index % items.length];
  var accent = T.accent[item.color];
  chip.text = item.source.toUpperCase();
  chip.set_style(UI.pt(7, scale) + ' font-weight: bold; letter-spacing: 1px; color: #16181f;' +
    ' background-color: ' + accent + '; border-radius: 8px; padding: 2px 8px;');
  age.text = ago(item.time);
  counter.text = (index % items.length + 1) + ' / ' + items.length;
  headline.text = item.title;
  setStatus(null);
}

function layout(w, h) {
  scale = UI.scale(w, h, 384, 160);
  age.set_style(UI.pt(8, scale) + ' color: ' + T.faint + ';');
  counter.set_style(UI.pt(8, scale) + ' color: ' + T.faint + ';');
  headline.set_style(UI.pt(13, scale) + ' font-weight: bold; margin-top: 8px;');
  status.set_style(UI.pt(10, scale) + ' color: ' + T.dim + '; text-align: center;');
  show();
}

function next() {
  if (items.length === 0) return;
  index = (index + 1) % items.length;
  ticks = 0;
  show();
}

// ── loading ─────────────────────────────────────────────────────────

// Fetch one feed; done(parsedFeed or null)
function loadFeed(api, url, done) {
  api.network.fetchAsync(url, { headers: ACCEPT }, function (res) {
    done(res.ok ? parseFeed(res.body) : null);
  });
}

function refresh(api) {
  if (busy) return;
  busy = true;
  if (items.length === 0) setStatus('Loading…');

  var all = [];
  var failed = 0;
  var pending = feeds.length;
  feeds.forEach(function (url, i) {
    loadFeed(api, url, function (feed) {
      if (!feed) failed++;
      else {
        var source = feed.title || hostOf(url);
        feed.items.forEach(function (it) {
          all.push({ source: source, color: COLORS[i % COLORS.length], title: it.title, link: it.link, time: it.time });
        });
      }
      if (--pending > 0) return;

      busy = false;
      if (all.length === 0) {
        if (items.length === 0)
          setStatus(failed ? 'Could not load the feed\nRight click → Set feed…' : 'The feed has no headlines');
        return;
      }
      // Newest first; feeds without dates keep their own order
      all.sort(function (a, b) { return b.time - a.time; });
      items = all.slice(0, MAX_ITEMS);
      index = 0;
      ticks = 0;
      show();
    });
  });
}

function saveFeeds(api, list) {
  feeds = list;
  api.state.set('feeds', feeds);
  items = [];
  busy = false;
  refresh(api);
}

// Check the address really is a feed before keeping it
function submit(api, text) {
  var url = /^[a-z]+:\/\//i.test(text) ? text : 'https://' + text;
  entryNote.text = 'Checking…';
  loadFeed(api, url, function (feed) {
    if (!feed || feed.items.length === 0) {
      entryNote.text = feed ? 'That feed has no headlines' : 'Not an RSS or Atom feed';
      return;
    }
    stopEditing(api);
    if (adding) {
      if (feeds.indexOf(url) < 0) saveFeeds(api, feeds.concat([url]));
    } else {
      saveFeeds(api, [url]);
    }
  });
}

// ── feed address (text entry) ───────────────────────────────────────

function startEditing(api, add) {
  if (editing) return;
  editing = true;
  adding = add;
  entry.set_text('');
  entryNote.text = '';
  entryBox.visible = true;
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
  api.input.release();
}

// ── widget ──────────────────────────────────────────────────────────

function render(ctx, api) {
  var St = ctx.St;
  var Clutter = ctx.Clutter;
  UI = ctx.ui;
  T = UI.theme;
  ctx.setStyle(T.panel);
  items = [];
  index = 0;
  ticks = 0;
  busy = false;
  editing = false;

  var saved = api.state.get('feeds');
  feeds = Array.isArray(saved) && saved.length ? saved : DEFAULT_FEEDS.slice();

  var stack = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true });

  content = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true });
  var top = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;' });
  chip = UI.label('', '', { y_align: Clutter.ActorAlign.CENTER });
  chip.clutter_text.set_ellipsize(ctx.Pango.EllipsizeMode.END);
  age = UI.label('', '', { y_align: Clutter.ActorAlign.CENTER, x_expand: true });
  counter = UI.label('', '', { y_align: Clutter.ActorAlign.CENTER });
  top.add_child(chip);
  top.add_child(age);
  top.add_child(counter);
  content.add_child(top);

  headline = UI.label('', '', { wrap: true, x_expand: true, y_expand: true });
  content.add_child(headline);
  stack.add_child(content);

  status = UI.label('', '', {
    wrap: true, x_expand: true, y_expand: true,
    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
  });
  stack.add_child(status);

  entryBox = new St.BoxLayout({
    vertical: true, visible: false, x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.END,
    style: 'spacing: 4px; padding: 8px; background-color: rgba(10, 10, 16, 0.92); border-radius: 12px;',
  });
  entry = new St.Entry({
    hint_text: 'Feed address, e.g. https://example.com/rss.xml', can_focus: true, x_expand: true,
    style: 'background-color: rgba(255, 255, 255, 0.9); color: #202020;' +
      ' caret-color: #202020; border-radius: 6px; padding: 5px 8px;',
  });
  entry.clutter_text.connect('activate', function () {
    var q = entry.get_text().trim();
    if (q) submit(api, q);
    else stopEditing(api);
  });
  entry.clutter_text.connect('button-press-event', function () {
    if (editing) api.input.grab(entry, function () { stopEditing(api); });
    return false;
  });
  entryNote = UI.label('', 'font-size: 8pt; color: #f2a0a0;', { wrap: true, x_expand: true });
  entryBox.add_child(entry);
  entryBox.add_child(entryNote);
  stack.add_child(entryBox);
  ctx.box.add_child(stack);

  layout(384, 160);

  api.menu.set(function () {
    var current = items.length ? items[index % items.length] : null;
    return [
      {
        label: 'Open article',
        enabled: !!(current && current.link),
        onSelect: function () {
          try {
            ctx.Gio.AppInfo.launch_default_for_uri(current.link, null);
          } catch (e) {
            api.widget.log('Cannot open ' + current.link + ': ' + e);
          }
        },
      },
      { label: 'Next headline', enabled: items.length > 1, onSelect: next },
      { label: 'Refresh', onSelect: function () { refresh(api); } },
      { separator: true },
      { label: 'Set feed…', onSelect: function () { startEditing(api, false); } },
      { label: 'Add feed…', onSelect: function () { startEditing(api, true); } },
      {
        label: 'Remove feed',
        enabled: feeds.length > 1,
        items: feeds.map(function (url) {
          return {
            label: hostOf(url),
            onSelect: function () { saveFeeds(api, feeds.filter(function (f) { return f !== url; })); },
          };
        }),
      },
      { label: 'Use the default feed', onSelect: function () { saveFeeds(api, DEFAULT_FEEDS.slice()); } },
    ];
  });

  api.timer.register(function () { refresh(api); }, REFRESH_MS);
  refresh(api);

  return function cleanup() {
    editing = false;
    api.input.release();
  };
}

function onResize(ctx, api, w, h) {
  layout(w, h);
}

function update() {
  if (editing) return;
  ticks++;
  if (ticks >= SECONDS_PER_ITEM) next();
}

function onClick() {
  if (!editing) next();
}
