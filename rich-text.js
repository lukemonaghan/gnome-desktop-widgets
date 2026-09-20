import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

// Lays children out left to right at their natural size, starting a new row
// when the next one does not fit; each row is as tall as its tallest child and
// the children are centred vertically within it. (Clutter.FlowLayout was
// tried first, but gave every child a height of zero.)
const WrapLayout = GObject.registerClass(
class WrapLayout extends Clutter.LayoutManager {
  _rows(container, maxWidth) {
    const rows = [];
    let row = null;
    for (let c = container.get_first_child(); c; c = c.get_next_sibling()) {
      if (!c.visible) continue;
      const w = Math.ceil(c.get_preferred_width(-1)[1]);
      const h = Math.ceil(c.get_preferred_height(w)[1]);
      if (!row || (row.items.length && row.width + w > maxWidth)) {
        row = { items: [], width: 0, height: 0 };
        rows.push(row);
      }
      row.items.push({ child: c, w, h });
      row.width += w;
      row.height = Math.max(row.height, h);
    }
    return rows;
  }

  vfunc_get_preferred_width(container, _forHeight) {
    let min = 0;
    let natural = 0;
    for (let c = container.get_first_child(); c; c = c.get_next_sibling()) {
      if (!c.visible) continue;
      min = Math.max(min, c.get_preferred_width(-1)[0]);
      natural += c.get_preferred_width(-1)[1];
    }
    return [min, natural];
  }

  vfunc_get_preferred_height(container, forWidth) {
    const rows = this._rows(container, forWidth < 0 ? Infinity : forWidth);
    const height = rows.reduce((sum, r) => sum + r.height, 0);
    return [height, height];
  }

  vfunc_allocate(container, box) {
    let y = 0;
    for (const row of this._rows(container, box.get_width())) {
      let x = 0;
      for (const { child, w, h } of row.items) {
        const b = new Clutter.ActorBox();
        b.set_origin(x, y + Math.floor((row.height - h) / 2));
        b.set_size(w, h);
        child.allocate(b);
        x += w;
      }
      y += row.height;
    }
  }
});

// Text with inline images, e.g. Magic's "{T}: Add {G}." with the symbols drawn
// as pictures. Text is laid out word by word so the images sit in the line and
// the whole thing wraps like a paragraph. Lines are split on "\n".
//
// options:
//   images    function(token) -> local image path, or null to show the token
//             as plain text. Called once per match. Required.
//   pattern   what counts as an image token (default /\{[^}]+\}/g)
//   iconSize  image size in px (default 14)
//   style     CSS for the text (default '')
export function createRichText(text, options = {}) {
  const { images, iconSize = 14, style = '' } = options;
  const source = (options.pattern || /\{[^}]+\}/g).source;

  const box = new St.BoxLayout({ vertical: true, x_expand: true });

  const word = (value) => {
    const label = new St.Label({ text: value, style });
    label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
    return label;
  };

  const icon = (path) => new St.Icon({
    gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(path) }),
    icon_size: iconSize,
  });

  for (const line of String(text ?? '').split('\n')) {
    const flow = new St.Widget({ x_expand: true, layout_manager: new WrapLayout() });
    // Spaces are kept in the text itself: a space after a word joins that
    // word; after an image it joins the next word.
    let last = null;
    let space = false;

    const addText = (segment) => {
      for (const part of segment.match(/\S+|\s+/g) || []) {
        if (/^\s/.test(part)) {
          if (last instanceof St.Label) last.text += ' ';
          else space = true;
        } else {
          last = word((space ? ' ' : '') + part);
          space = false;
          flow.add_child(last);
        }
      }
    };

    const re = new RegExp(source, 'g');
    let from = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      addText(line.slice(from, m.index));
      const path = images ? images(m[0]) : null;
      if (path) {
        last = icon(path);
        space = false;
        flow.add_child(last);
      } else {
        addText(m[0]);
      }
      from = m.index + m[0].length;
    }
    addText(line.slice(from));

    // An empty line still takes up a line's height
    if (!flow.get_n_children()) flow.add_child(word(' '));
    box.add_child(flow);
  }
  return box;
}
