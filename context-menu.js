import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

// The popup menu shown when a widget is right-clicked. The items come from
// the widget itself (api.menu.set); see README for the item format.
export class WidgetContextMenu {
  constructor() {
    this._menu = null;
    this._manager = null;
  }

  close() {
    this._menu?.close(false);
    this._teardown();
  }

  destroy() {
    this.close();
  }

  // items: [{ label, onSelect, checked, enabled, items }, { separator: true }]
  // x, y: where the pointer is, in stage coordinates
  show(items, x, y, ownerActor) {
    this.close();
    if (!Array.isArray(items) || !items.length) return;

    Main.layoutManager.setDummyCursorGeometry(Math.round(x), Math.round(y), 0, 0);
    const menu = new PopupMenu.PopupMenu(Main.layoutManager.dummyCursor, 0, St.Side.TOP);
    Main.layoutManager.uiGroup.add_child(menu.actor);
    menu.actor.hide();
    this._allowNestedSubmenus(menu);

    // What was picked runs once the menu has closed, so an action that grabs
    // the keyboard or opens something else does not fight the menu's own grab.
    const chosen = { fn: null };
    this._fill(menu, items, chosen);
    if (!menu.numMenuItems) {
      menu.destroy();
      return;
    }

    menu.connect('open-state-changed', (_menu, open) => {
      if (open) return;
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (chosen.fn) {
          try { chosen.fn(); } catch (e) { log(`DesktopWidgets context menu action failed: ${e}`); }
        }
        return GLib.SOURCE_REMOVE;
      });
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (this._menu === menu) this._teardown();
        return GLib.SOURCE_REMOVE;
      });
    });

    this._menu = menu;
    this._manager = new PopupMenu.PopupMenuManager(ownerActor ?? Main.layoutManager.dummyCursor);
    this._manager.addMenu(menu);
    menu.open(BoxPointer.PopupAnimation.FULL);
  }

  // The shell keeps one "open submenu" per menu and closes it whenever another
  // opens, so a submenu inside a submenu shuts its own parent. Only close the
  // open submenus that the new one is not inside of.
  _allowNestedSubmenus(menu) {
    const inside = (sub, of) => {
      for (let m = sub; m; m = m._parent) if (m === of) return true;
      return false;
    };

    menu._setOpenedSubMenu = (submenu) => {
      const open = menu._openedSubMenu;
      if (!submenu) {
        // One closed: one inside it goes too, and the submenu around it, if
        // any, is the open one again
        let m = open;
        while (m?._parent && m._parent !== menu && !m._parent.isOpen) {
          m.close(false);
          m = m._parent;
        }
        const outer = m?._parent;
        menu._openedSubMenu = outer && outer !== menu && outer.isOpen ? outer : null;
        return;
      }
      for (let m = open; m && m !== menu && !inside(submenu, m); m = m._parent)
        m.close(true);
      menu._openedSubMenu = submenu;
    };
  }

  _fill(menu, items, chosen) {
    let lastSeparator = null;      // the separator just added, if the last item is one
    let lastWasSeparator = true;   // no separator first, none twice in a row
    for (const spec of items) {
      if (!spec) continue;

      if (spec.separator || spec === 'separator') {
        if (!lastWasSeparator) {
          lastSeparator = new PopupMenu.PopupSeparatorMenuItem();
          menu.addMenuItem(lastSeparator);
        }
        lastWasSeparator = true;
        continue;
      }
      if (spec.visible === false) continue;

      const label = String(spec.label ?? '');
      let item;
      if (Array.isArray(spec.items)) {
        item = new PopupMenu.PopupSubMenuMenuItem(label);
        this._fill(item.menu, spec.items, chosen);
        if (!item.menu.numMenuItems) { item.destroy(); continue; }
      } else {
        item = new PopupMenu.PopupMenuItem(label);
        // `checked` present (true or false) makes it a toggle
        if (spec.checked === true) item.setOrnament(PopupMenu.Ornament.CHECK);
        else if (spec.checked === false) item.setOrnament(PopupMenu.Ornament.NONE);
        item.connect('activate', () => { chosen.fn = spec.onSelect ?? null; });
      }
      if (spec.enabled === false) item.setSensitive(false);
      menu.addMenuItem(item);
      lastWasSeparator = false;
      lastSeparator = null;
    }

    // Drop a separator left dangling at the end by hidden items
    if (lastWasSeparator && lastSeparator) lastSeparator.destroy();
  }

  _teardown() {
    if (this._manager && this._menu) this._manager.removeMenu(this._menu);
    this._manager = null;
    this._menu?.destroy();
    this._menu = null;
  }
}
