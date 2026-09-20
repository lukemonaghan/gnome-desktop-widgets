import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Cairo from 'gi://cairo';

// Building blocks for good-looking widgets: design tokens plus a few things St
// cannot do with CSS alone (rings, graphs, custom drawing). Exposed to widget
// scripts as ctx.ui. Kept free of Shell imports.

const TAU = Math.PI * 2;

// Colours follow the GNOME palette so widgets sit well next to each other.
export const theme = {
  text: '#f2f4f8',
  dim: 'rgba(242, 244, 248, 0.62)',
  faint: 'rgba(242, 244, 248, 0.38)',
  track: 'rgba(255, 255, 255, 0.12)',
  hairline: 'rgba(255, 255, 255, 0.09)',
  accent: {
    blue: '#62a0ea', green: '#57e389', yellow: '#f8e45c', orange: '#ffa348',
    red: '#ff7b63', purple: '#dc8add', teal: '#5bc8af',
  },
  // The standard dark glass card. Widgets pass it to ctx.setStyle().
  panel: 'background-color: rgba(22, 24, 32, 0.82); color: #f2f4f8; ' +
    'border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 20px; ' +
    'padding: 14px 18px;',
  // A light card, for notes, calendars and quotes.
  paper: 'background-color: rgba(250, 248, 242, 0.92); color: #23252b; ' +
    'border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 20px; ' +
    'padding: 14px 18px;',
  // Small uppercase heading
  caption: 'font-size: 8pt; font-weight: bold; letter-spacing: 1.2px; color: rgba(242, 244, 248, 0.5);',
};

// '#rgb', '#rrggbb', '#rrggbbaa', 'rgb(...)' or 'rgba(...)' -> [r, g, b, a] (0..1)
export function parseColor(css) {
  if (Array.isArray(css)) return css;
  const s = String(css).trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
  }
  m = s.match(/^rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(',').map(parseFloat);
    return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
  }
  return [1, 1, 1, 1];
}

export function setColor(cr, css, alpha = 1) {
  const c = parseColor(css);
  cr.setSourceRGBA(c[0], c[1], c[2], c[3] * alpha);
}

// A drawing surface. draw(cr, width, height) is called with a Cairo context
// whenever it needs painting; call actor.redraw() after the data changed.
export function createCanvas({ width, height, draw, ...props }) {
  const area = new St.DrawingArea({ width, height, ...props });
  area.connect('repaint', () => {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    try {
      draw(cr, w, h);
    } catch (e) {
      log(`DesktopWidgets ui canvas draw failed: ${e}`);
    }
    cr.$dispose();
  });
  area.redraw = () => area.queue_repaint();
  return area;
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

// A circular progress ring. Returns an actor with setValue(fraction, color?).
export function createRing({ size = 64, thickness = 6, color = theme.accent.blue,
  track = theme.track, value = 0 } = {}) {
  const state = { value, color, thickness };
  const ring = createCanvas({
    width: size, height: size,
    draw: (cr, w, h) => {
      const r = (Math.min(w, h) - state.thickness) / 2;
      cr.setLineWidth(state.thickness);
      cr.setLineCap(Cairo.LineCap.ROUND);
      setColor(cr, track);
      cr.arc(w / 2, h / 2, r, 0, TAU);
      cr.stroke();
      const v = clamp01(state.value);
      if (v > 0) {
        setColor(cr, state.color);
        cr.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + TAU * v);
        cr.stroke();
      }
    },
  });
  ring.setValue = (v, c) => {
    state.value = v;
    if (c) state.color = c;
    ring.redraw();
  };
  // Change the ring's size (and optionally its thickness) after it was built
  ring.resize = (newSize, newThickness) => {
    if (newThickness !== undefined) state.thickness = newThickness;
    ring.set_size(newSize, newSize);
    ring.redraw();
  };
  return ring;
}

// A thin horizontal progress bar. Returns an actor with setValue(fraction, color?).
export function createBar({ height = 6, color = theme.accent.blue, track = theme.track,
  value = 0 } = {}) {
  const state = { value, color };
  const bar = createCanvas({
    width: 10, height, x_expand: true,
    draw: (cr, w, h) => {
      const round = (x, width) => {
        cr.newSubPath();
        cr.arc(x + h / 2, h / 2, h / 2, Math.PI / 2, 1.5 * Math.PI);
        cr.arc(x + width - h / 2, h / 2, h / 2, -Math.PI / 2, Math.PI / 2);
        cr.closePath();
      };
      setColor(cr, track);
      round(0, w);
      cr.fill();
      const fill = Math.max(h, w * clamp01(state.value));
      if (state.value > 0) {
        setColor(cr, state.color);
        round(0, fill);
        cr.fill();
      }
    },
  });
  bar.setValue = (v, c) => {
    state.value = v;
    if (c) state.color = c;
    bar.redraw();
  };
  bar.resize = (newHeight) => bar.set_height(newHeight);
  return bar;
}

// A small line graph with a soft fill under it. setValues(array, max?) redraws;
// pass max to change the scale (null: scale to the largest value).
// `max` fixes the top of the scale (e.g. 100 for percentages); without it the
// graph scales to the largest value.
export function createSparkline({ width = 120, height = 36, color = theme.accent.blue,
  max = null, lineWidth = 2 } = {}) {
  const state = { values: [], max };
  const spark = createCanvas({
    width, height, x_expand: true,
    draw: (cr, w, h) => {
      const values = state.values;
      if (values.length < 2) return;
      const top = state.max ?? Math.max(1e-9, ...values);
      const pad = lineWidth;
      const x = (i) => (i / (values.length - 1)) * w;
      const y = (v) => pad + (h - 2 * pad) * (1 - Math.min(1, Math.max(0, v / top)));

      const path = () => {
        cr.moveTo(x(0), y(values[0]));
        for (let i = 1; i < values.length; i++) {
          const mx = (x(i - 1) + x(i)) / 2;   // smooth the corners
          cr.curveTo(mx, y(values[i - 1]), mx, y(values[i]), x(i), y(values[i]));
        }
      };

      const c = parseColor(color);
      path();
      cr.lineTo(w, h);
      cr.lineTo(0, h);
      cr.closePath();
      const fill = new Cairo.LinearGradient(0, 0, 0, h);
      fill.addColorStopRGBA(0, c[0], c[1], c[2], 0.35);
      fill.addColorStopRGBA(1, c[0], c[1], c[2], 0);
      cr.setSource(fill);
      cr.fill();

      path();
      cr.setLineWidth(lineWidth);
      cr.setLineCap(Cairo.LineCap.ROUND);
      cr.setLineJoin(Cairo.LineJoin.ROUND);
      setColor(cr, color);
      cr.stroke();
    },
  });
  spark.setValues = (values, newMax) => {
    state.values = values;
    if (newMax !== undefined) state.max = newMax;
    spark.redraw();
  };
  return spark;
}

// A label with CSS. `wrap` lets it wrap onto several lines (it then needs a
// width from its parent, e.g. x_expand); otherwise it never wraps or truncates.
export function createLabel(text, css = '', { wrap = false, ...props } = {}) {
  const label = new St.Label({ text, style: css, ...props });
  const t = label.clutter_text;
  t.set_ellipsize(Pango.EllipsizeMode.NONE);
  t.set_line_wrap(wrap);
  if (wrap) t.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
  return label;
}

// Layers actors on top of each other, each centred (a number inside a ring)
export function createStack(...actors) {
  const stack = new St.Widget({ layout_manager: new Clutter.BinLayout() });
  for (const a of actors) {
    a.x_align = Clutter.ActorAlign.CENTER;
    a.y_align = Clutter.ActorAlign.CENTER;
    stack.add_child(a);
  }
  return stack;
}

// How much to scale a design made for designW x designH so it fits a widget of
// width x height (including the card's padding): the smaller of the two ratios,
// kept within sensible limits so text never vanishes or turns huge.
export function scaleFor(width, height, designW, designH) {
  const s = Math.min(width / designW, height / designH);
  return Math.max(0.5, Math.min(4, Number.isFinite(s) ? s : 1));
}

// 'font-size: 12.5pt;' for a design size of `size` pt at scale `s`
export function pt(size, s = 1) {
  return `font-size: ${Math.round(size * s * 10) / 10}pt;`;
}

export function createUi() {
  return {
    theme,
    parseColor,
    setColor,
    canvas: createCanvas,
    ring: createRing,
    bar: createBar,
    sparkline: createSparkline,
    label: createLabel,
    stack: createStack,
    scale: scaleFor,
    pt,
  };
}
