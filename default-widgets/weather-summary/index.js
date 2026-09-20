// Weather Summary Widget
// Current weather from Open-Meteo (https://open-meteo.com, no account needed).
// The first time it runs it looks up your rough location from your IP address
// (ipwho.is); "Set location…" in the right-click menu picks a place by name
// instead. Click to refresh. Units (°C / °F) are in the menu too.

var GEO = 'https://geocoding-api.open-meteo.com/v1/search';
var FORECAST = 'https://api.open-meteo.com/v1/forecast';
var LOCATE = 'https://ipwho.is/';
var REFRESH_MS = 15 * 60 * 1000;
var MIN_GAP_MS = 30 * 1000;
var HEADERS = { 'Accept': 'application/json' };

var UI;
var T;
var icon;
var place;
var temp;
var summary;
var details;
var status;
var entryBox;
var entry;
var entryNote;
var content;

var location = null;      // { name, lat, lon }
var units = 'metric';     // or 'imperial'
var weather = null;       // last reading
var lastFetch = 0;
var busy = false;
var editing = false;
var scale = 1;

var SKIES = {
  sun:        ['#3d8fe0', '#1c5cab'],
  'cloud-sun': ['#5b8fc4', '#2f5f95'],
  cloud:      ['#7d8ca0', '#4d596b'],
  rain:       ['#566a86', '#2c3a52'],
  storm:      ['#4a4f6b', '#22253d'],
  snow:       ['#8aa4c4', '#54698a'],
  moon:       ['#26305c', '#0f1430'],
};

// WMO weather codes -> our icon and a description
function describe(code, isDay) {
  if (code === 0) return isDay ? { icon: 'sun', text: 'Sunny' } : { icon: 'moon', text: 'Clear night' };
  if (code === 1) return isDay ? { icon: 'sun', text: 'Mostly sunny' } : { icon: 'moon', text: 'Mostly clear' };
  if (code === 2) return { icon: 'cloud-sun', text: 'Partly cloudy' };
  if (code === 3) return { icon: 'cloud', text: 'Overcast' };
  if (code === 45 || code === 48) return { icon: 'cloud', text: 'Fog' };
  if (code >= 51 && code <= 57) return { icon: 'rain', text: 'Drizzle' };
  if (code >= 61 && code <= 67) return { icon: 'rain', text: 'Rain' };
  if (code >= 71 && code <= 77) return { icon: 'snow', text: 'Snow' };
  if (code >= 80 && code <= 82) return { icon: 'rain', text: 'Showers' };
  if (code === 85 || code === 86) return { icon: 'snow', text: 'Snow showers' };
  if (code >= 95) return { icon: 'storm', text: 'Thunderstorm' };
  return { icon: 'cloud', text: 'Unknown' };
}

function stat(ctx, caption) {
  var col = new ctx.St.BoxLayout({ vertical: true, x_expand: true });
  var cap = UI.label(caption, '');
  var v = UI.label('', '');
  col.add_child(cap);
  col.add_child(v);
  return { actor: col, caption: cap, value: v };
}

function style(ctx, sky) {
  ctx.setStyle('background-gradient-direction: vertical; background-gradient-start: ' + sky[0] +
    '; background-gradient-end: ' + sky[1] + '; color: white; border-radius: 20px; padding: 14px 18px;' +
    ' border: 1px solid rgba(255, 255, 255, 0.15);');
}

function layout(ctx, w, h) {
  scale = UI.scale(w, h, 288, 160);
  var s = scale;
  icon.icon_size = Math.round(64 * s);
  place.set_style(UI.pt(8, s) + ' font-weight: bold; letter-spacing: 1px; color: rgba(255,255,255,0.7);');
  temp.set_style(UI.pt(28, s) + ' font-weight: 300;');
  summary.set_style(UI.pt(11, s) + ' font-weight: bold;');
  ['feels', 'humidity', 'wind'].forEach(function (k) {
    details[k].caption.set_style(UI.pt(7, s) + ' font-weight: bold; letter-spacing: 1px;' +
      ' color: rgba(255,255,255,0.6);');
    details[k].value.set_style(UI.pt(10, s) + ' font-weight: bold;');
  });
  status.set_style(UI.pt(10, s) + ' text-align: center;');
}

function setStatus(message) {
  status.text = message || '';
  status.visible = !!message;
  content.visible = !message;
}

function show(ctx) {
  if (!weather) return;
  var d = describe(weather.code, weather.isDay);
  style(ctx, SKIES[d.icon]);
  icon.gicon = new ctx.Gio.FileIcon({ file: ctx.Gio.File.new_for_path(ctx.assetPath(d.icon + '.svg')) });
  place.text = (location ? location.name : '').toUpperCase();
  temp.text = Math.round(weather.temp) + '°';
  summary.text = d.text;
  details.feels.value.text = Math.round(weather.feels) + '°';
  details.humidity.value.text = Math.round(weather.humidity) + '%';
  details.wind.value.text = Math.round(weather.wind) + (units === 'metric' ? ' km/h' : ' mph');
  setStatus(null);
}

// ── data ────────────────────────────────────────────────────────────

function fetchWeather(ctx, api, force) {
  if (!location || busy) return;
  if (!force && Date.now() - lastFetch < MIN_GAP_MS) return;
  busy = true;
  lastFetch = Date.now();

  var url = FORECAST + '?latitude=' + location.lat + '&longitude=' + location.lon +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
    '&timezone=auto' +
    (units === 'imperial' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '');
  api.network.fetchJSONAsync(url, { headers: HEADERS }, function (data) {
    busy = false;
    var c = data && data.current;
    if (!c) {
      if (!weather) setStatus('Weather unavailable\nRight click for options');
      return;
    }
    weather = {
      temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m, code: c.weather_code, isDay: c.is_day === 1,
    };
    show(ctx);
  });
}

function useLocation(ctx, api, loc) {
  location = loc;
  api.state.set('location', loc);
  weather = null;
  fetchWeather(ctx, api, true);
}

// No saved place: guess one from the IP address
function locate(ctx, api) {
  setStatus('Finding your location…');
  api.network.fetchJSONAsync(LOCATE, { headers: HEADERS }, function (data) {
    if (!data || data.success === false || typeof data.latitude !== 'number') {
      setStatus('Could not find your location\nRight click → Set location…');
      return;
    }
    useLocation(ctx, api, { name: data.city || data.region || 'Here', lat: data.latitude, lon: data.longitude });
  });
}

function search(ctx, api, query) {
  entryNote.text = 'Searching…';
  var url = GEO + '?name=' + encodeURIComponent(query) + '&count=1&language=en&format=json';
  api.network.fetchJSONAsync(url, { headers: HEADERS }, function (data) {
    var r = data && data.results && data.results[0];
    if (!r) {
      entryNote.text = data ? 'No place called "' + query + '"' : 'Search failed, try again';
      return;
    }
    stopEditing(api);
    useLocation(ctx, api, { name: r.name, lat: r.latitude, lon: r.longitude });
  });
}

// ── set location (text entry) ───────────────────────────────────────

function startEditing(ctx, api) {
  if (editing) return;
  editing = true;
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
  weather = null;
  busy = false;
  editing = false;
  lastFetch = 0;

  location = api.state.get('location') || null;
  units = api.state.get('units') === 'imperial' ? 'imperial' : 'metric';

  var stack = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true });

  content = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true });
  var top = new St.BoxLayout({ x_expand: true, y_expand: true, style: 'spacing: 14px;' });
  icon = new St.Icon({ icon_size: 64, y_align: Clutter.ActorAlign.CENTER });
  var text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
  place = UI.label('', '');
  temp = UI.label('', '');
  summary = UI.label('', '');
  text.add_child(place);
  text.add_child(temp);
  text.add_child(summary);
  top.add_child(icon);
  top.add_child(text);
  content.add_child(top);

  var row = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px; margin-top: 6px;' });
  details = { feels: stat(ctx, 'FEELS LIKE'), humidity: stat(ctx, 'HUMIDITY'), wind: stat(ctx, 'WIND') };
  row.add_child(details.feels.actor);
  row.add_child(details.humidity.actor);
  row.add_child(details.wind.actor);
  content.add_child(row);
  stack.add_child(content);

  status = UI.label('', '', {
    wrap: true, x_expand: true, y_expand: true,
    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
  });
  stack.add_child(status);

  entryBox = new St.BoxLayout({
    vertical: true, visible: false, x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.END,
    style: 'spacing: 4px; padding: 8px; background-color: rgba(10, 10, 16, 0.85); border-radius: 12px;',
  });
  entry = new St.Entry({
    hint_text: 'City name', can_focus: true, x_expand: true,
    style: 'background-color: rgba(255, 255, 255, 0.9); color: #202020;' +
      ' caret-color: #202020; border-radius: 6px; padding: 5px 8px;',
  });
  entry.clutter_text.connect('activate', function () {
    var q = entry.get_text().trim();
    if (q) search(ctx, api, q);
    else stopEditing(api);
  });
  entry.clutter_text.connect('button-press-event', function () {
    if (editing) api.input.grab(entry, function () { stopEditing(api); });
    return false;
  });
  entryNote = UI.label('', 'font-size: 8pt; color: #ffd0d0;', { wrap: true, x_expand: true });
  entryBox.add_child(entry);
  entryBox.add_child(entryNote);
  stack.add_child(entryBox);
  ctx.box.add_child(stack);

  style(ctx, SKIES.sun);
  layout(ctx, 288, 160);

  api.menu.set(function () {
    return [
      { label: 'Refresh', enabled: !!location, onSelect: function () { fetchWeather(ctx, api, true); } },
      { label: 'Set location…', onSelect: function () { startEditing(ctx, api); } },
      { label: 'Use my location', onSelect: function () { locate(ctx, api); } },
      { separator: true },
      {
        label: 'Units',
        items: [
          { label: 'Celsius, km/h', checked: units === 'metric', onSelect: function () { setUnits(ctx, api, 'metric'); } },
          { label: 'Fahrenheit, mph', checked: units === 'imperial', onSelect: function () { setUnits(ctx, api, 'imperial'); } },
        ],
      },
    ];
  });

  api.timer.register(function () { fetchWeather(ctx, api, true); }, REFRESH_MS);

  if (location) {
    setStatus('Loading…');
    fetchWeather(ctx, api, true);
  } else {
    locate(ctx, api);
  }

  return function cleanup() {
    editing = false;
    api.input.release();
  };
}

function setUnits(ctx, api, next) {
  if (units === next) return;
  units = next;
  api.state.set('units', next);
  fetchWeather(ctx, api, true);
}

function onResize(ctx, api, w, h) {
  layout(ctx, w, h);
}

function onClick(ctx, api) {
  if (!editing) fetchWeather(ctx, api, false);
}
