/* GNOME Desktop Widgets — preferences (sidebar + detail layout) */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { getRegistry } from './store.js';
import { LayoutManager, DRAG_MODIFIERS } from './layout-manager.js';
import { importFromFolder, importFromArchive } from './importer.js';
import { installDefaultWidgets } from './default-library.js';

function findDescendants(root, type) {
  const found = [];
  const walk = (w) => {
    for (let c = w.get_first_child(); c; c = c.get_next_sibling()) {
      if (c instanceof type) found.push(c);
      walk(c);
    }
  };
  walk(root);
  return found;
}

export default class DesktopWidgetsPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    window.set_default_size(850, 550);
    window.set_search_enabled(false);

    const page = new Adw.PreferencesPage();
    window.add(page);

    // AdwPreferencesPage wraps its content in an AdwClamp (600px max) and
    // pads it heavily. Lift the clamp so the paned can fill the window.
    for (const clamp of findDescendants(page, Adw.Clamp)) {
      clamp.maximum_size = 100000;
      clamp.tightening_threshold = 100000;
      clamp.margin_top = 0;
      clamp.margin_bottom = 0;
      clamp.margin_start = 0;
      clamp.margin_end = 0;
    }

    const wrapper = new Adw.PreferencesGroup();
    page.add(wrapper);

    // ── Main split: sidebar | content ──────────────────────────────────
    const split = new Gtk.Paned({
      orientation: Gtk.Orientation.HORIZONTAL,
      position: 220,
      shrink_start_child: false,
      shrink_end_child: false,
      vexpand: true,
      hexpand: true,
    });
    wrapper.add(split);

    // ── Sidebar ────────────────────────────────────────────────────────
    this._sidebarList = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.SINGLE,
      vexpand: true,
    });
    this._sidebarList.add_css_class('navigation-sidebar');

    const sidebarScroll = new Gtk.ScrolledWindow({
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    sidebarScroll.set_child(this._sidebarList);
    split.set_start_child(sidebarScroll);

    // ── Content stack ──────────────────────────────────────────────────
    this._stack = new Gtk.Stack({
      transition_type: Gtk.StackTransitionType.CROSSFADE,
      vexpand: true,
      hexpand: true,
    });
    const contentScroll = new Gtk.ScrolledWindow({
      vexpand: true,
      hexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    contentScroll.set_child(this._stack);
    split.set_end_child(contentScroll);

    // ── Data ───────────────────────────────────────────────────────────
    this._registry = getRegistry();
    this._layoutManager = new LayoutManager();
    this._settings = this.getSettings();
    this._window = window;
    this._widgetStackNames = [];

    // Build the settings page (always present)
    this._stack.add_named(this._buildSettingsPanel(), 'settings');

    // Build sidebar rows + widget detail pages
    this._buildSidebar();

    // Default selection → Settings
    const first = this._sidebarList.get_row_at_index(0);
    if (first) this._sidebarList.select_row(first);
    this._stack.set_visible_child_name('settings');

    this._sidebarList.connect('row-selected', (_lb, row) => {
      if (row && row._stackName)
        this._stack.set_visible_child_name(row._stackName);
    });

    window.connect('destroy', () => {
      this._sidebarList = null;
      this._stack = null;
      this._registry = null;
      this._window = null;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Sidebar
  // ═══════════════════════════════════════════════════════════════════════

  _buildSidebar() {
    // "Settings" row
    const settingsRow = new Gtk.ListBoxRow();
    settingsRow._stackName = 'settings';
    const sBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL, spacing: 8,
      margin_top: 8, margin_bottom: 8, margin_start: 12, margin_end: 12,
    });
    sBox.append(new Gtk.Image({ icon_name: 'emblem-system-symbolic' }));
    sBox.append(new Gtk.Label({ label: 'Settings', halign: Gtk.Align.START, hexpand: true }));
    settingsRow.set_child(sBox);
    this._sidebarList.append(settingsRow);

    // "Widgets" caption
    const capRow = new Gtk.ListBoxRow({ selectable: false, activatable: false });
    const capLabel = new Gtk.Label({
      label: 'Widgets', halign: Gtk.Align.START,
      margin_top: 14, margin_bottom: 4, margin_start: 12,
    });
    capLabel.add_css_class('dim-label');
    capLabel.add_css_class('caption');
    capRow.set_child(capLabel);
    this._sidebarList.append(capRow);

    // One row per widget
    for (const widget of this._registry.getAllWidgets()) {
      this._appendWidgetRow(widget);
    }
  }

  _appendWidgetRow(widget) {
    const row = new Gtk.ListBoxRow();
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL, spacing: 8,
      margin_top: 6, margin_bottom: 6, margin_start: 12, margin_end: 12,
    });
    box.append(new Gtk.Label({
      label: widget.display_name || widget.id,
      halign: Gtk.Align.START, hexpand: true,
      ellipsize: Pango.EllipsizeMode.END,
    }));
    const dot = new Gtk.Label({ label: widget.enabled ? '●' : '○' });
    dot.add_css_class(widget.enabled ? 'success' : 'dim-label');
    box.append(dot);
    row.set_child(box);
    row._dot = dot;

    const name = `widget-${widget.id}`;
    row._stackName = name;
    this._widgetStackNames.push(name);

    this._stack.add_named(this._buildWidgetPanel(widget, row), name);
    this._sidebarList.append(row);
  }

  // Rebuild the widget rows and pages. `select` is the id of the widget whose
  // page to show afterwards (Settings when omitted or gone).
  _rebuildSidebar(select = null) {
    if (!this._sidebarList || !this._stack) return;

    // Remove widget rows (indices 0=Settings, 1=caption, 2+=widgets)
    let row = this._sidebarList.get_row_at_index(2);
    while (row) {
      this._sidebarList.remove(row);
      row = this._sidebarList.get_row_at_index(2);
    }

    // Remove old widget stack pages
    for (const name of this._widgetStackNames) {
      const child = this._stack.get_child_by_name(name);
      if (child) this._stack.remove(child);
    }
    this._widgetStackNames = [];

    // Re-add from current registry data
    for (const widget of this._registry.getAllWidgets()) {
      this._appendWidgetRow(widget);
    }

    // Show the requested widget's page, else Settings
    let target = this._sidebarList.get_row_at_index(0);
    for (let i = 2, r; (r = this._sidebarList.get_row_at_index(i)); i++) {
      if (select && r._stackName === `widget-${select}`) target = r;
    }
    if (target) this._sidebarList.select_row(target);
    this._stack.set_visible_child_name(target?._stackName ?? 'settings');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Settings panel (right-hand side when "Settings" is selected)
  // ═══════════════════════════════════════════════════════════════════════

  _buildSettingsPanel() {
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL, spacing: 16,
      margin_top: 24, margin_bottom: 24, margin_start: 32, margin_end: 32,
    });

    // ── Layout ─────────────────────────────────────────────────────────
    const layoutTitle = new Gtk.Label({ label: 'Layout', halign: Gtk.Align.START });
    layoutTitle.add_css_class('title-4');
    box.append(layoutTitle);

    const layoutList = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    layoutList.add_css_class('boxed-list');

    const modeRow = new Adw.ActionRow({ title: 'Placement Mode', subtitle: 'Absolute or grid-aligned' });
    const modeCombo = new Gtk.ComboBoxText();
    modeCombo.append_text('absolute');
    modeCombo.append_text('grid');
    modeCombo.set_active(this._layoutManager.getMode() === 'grid' ? 1 : 0);
    modeCombo.connect('changed', () => this._layoutManager.setMode(modeCombo.get_active_text()));
    modeRow.add_suffix(modeCombo);
    layoutList.append(modeRow);

    const snapRow = new Adw.ActionRow({ title: 'Snap to Grid' });
    const snapSwitch = new Gtk.Switch({ active: this._layoutManager.isSnapToGrid(), valign: Gtk.Align.CENTER });
    snapSwitch.connect('notify::active', (s) => this._layoutManager.setSnapToGrid(s.active));
    snapRow.add_suffix(snapSwitch);
    layoutList.append(snapRow);

    const gridRow = new Adw.ActionRow({ title: 'Grid Size', subtitle: 'Snap increment in pixels' });
    const gridSpin = new Gtk.SpinButton({
      adjustment: new Gtk.Adjustment({ lower: 4, upper: 256, step_increment: 4, value: this._layoutManager.getGridSize() }),
      valign: Gtk.Align.CENTER,
    });
    gridSpin.connect('value-changed', () => this._layoutManager.setGridSize(gridSpin.get_value()));
    gridRow.add_suffix(gridSpin);
    layoutList.append(gridRow);

    const dragRow = new Adw.ActionRow({
      title: 'Drag Key',
      subtitle: 'Hold while dragging to move a widget, or from its bottom-right corner to resize it',
    });
    const dragCombo = new Gtk.DropDown({
      model: Gtk.StringList.new(DRAG_MODIFIERS.map((m) => m.label)),
      valign: Gtk.Align.CENTER,
    });
    const currentId = this._settings.get_string('drag-modifier');
    dragCombo.set_selected(Math.max(0, DRAG_MODIFIERS.findIndex((m) => m.id === currentId)));
    dragCombo.connect('notify::selected', () => {
      this._settings.set_string('drag-modifier', DRAG_MODIFIERS[dragCombo.get_selected()].id);
    });
    dragRow.add_suffix(dragCombo);
    layoutList.append(dragRow);

    box.append(layoutList);

    // ── Library / Import ───────────────────────────────────────────────
    const libTitle = new Gtk.Label({ label: 'Library', halign: Gtk.Align.START });
    libTitle.add_css_class('title-4');
    box.append(libTitle);

    const btnBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });

    const installBtn = new Gtk.Button({ label: 'Install Defaults' });
    installBtn.connect('clicked', () => {
      try { installDefaultWidgets(); this._rebuildSidebar(); }
      catch (e) { logError(e, 'Install defaults failed'); }
    });

    const folderBtn = new Gtk.Button({ label: 'Import Folder' });
    folderBtn.add_css_class('suggested-action');
    folderBtn.connect('clicked', () => this._importFolder());

    const archiveBtn = new Gtk.Button({ label: 'Import Archive' });
    archiveBtn.connect('clicked', () => this._importArchive());

    btnBox.append(installBtn);
    btnBox.append(folderBtn);
    btnBox.append(archiveBtn);
    box.append(btnBox);

    return box;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Widget detail panel (right-hand side when a widget is selected)
  // ═══════════════════════════════════════════════════════════════════════

  _buildWidgetPanel(widget, row) {
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL, spacing: 12,
      margin_top: 24, margin_bottom: 24, margin_start: 32, margin_end: 32,
    });

    const title = new Gtk.Label({ label: widget.display_name || widget.id, halign: Gtk.Align.START });
    title.add_css_class('title-2');
    box.append(title);

    if (widget.description) {
      const desc = new Gtk.Label({ label: widget.description, halign: Gtk.Align.START, wrap: true });
      desc.add_css_class('dim-label');
      box.append(desc);
    }

    const list = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    list.add_css_class('boxed-list');

    // Enable toggle
    const enableRow = new Adw.ActionRow({ title: 'Enabled' });
    const sw = new Gtk.Switch({ active: !!widget.enabled, valign: Gtk.Align.CENTER });
    sw.connect('notify::active', (s) => {
      this._registry.setEnabled(widget.id, s.active);
      // Update the status dot in place; rebuilding would reset the selection.
      row._dot.set_label(s.active ? '●' : '○');
      row._dot.remove_css_class(s.active ? 'dim-label' : 'success');
      row._dot.add_css_class(s.active ? 'success' : 'dim-label');
    });
    enableRow.add_suffix(sw);
    list.append(enableRow);

    // Info rows
    if (widget.type)
      list.append(new Adw.ActionRow({ title: 'Type', subtitle: widget.type }));
    if (widget.version)
      list.append(new Adw.ActionRow({ title: 'Version', subtitle: widget.version }));
    if (widget.author)
      list.append(new Adw.ActionRow({ title: 'Author', subtitle: widget.author }));
    if (widget.tags && widget.tags.length)
      list.append(new Adw.ActionRow({ title: 'Tags', subtitle: widget.tags.join(', ') }));

    box.append(list);

    // Actions
    const actBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, margin_top: 8 });

    // A widget that can run several copies (sticky notes, cards…) names the
    // button itself with "instances": { "add_label": "…" } in its manifest.
    // Copies made earlier carry an older manifest, so ask their original.
    const spec = widget.instances ?? this._registry.getWidget(widget.cloneOf)?.instances;
    if (spec?.add_label) {
      const addBtn = new Gtk.Button({ label: String(spec.add_label) });
      addBtn.add_css_class('suggested-action');
      addBtn.connect('clicked', () => {
        try {
          this._registry.reload();
          const created = this._registry.cloneWidget(widget.id);
          this._rebuildSidebar(created.id);
        } catch (e) { logError(e, `${spec.add_label} failed`); }
      });
      actBox.append(addBtn);
    }

    const exportBtn = new Gtk.Button({ label: 'Export' });
    exportBtn.connect('clicked', () => {
      try {
        this._registry.exportWidget(widget.id, `${GLib.get_home_dir()}/Desktop/${widget.id}.tar.gz`);
      } catch (e) { logError(e, 'Export failed'); }
    });

    const removeBtn = new Gtk.Button({ label: 'Remove' });
    removeBtn.add_css_class('destructive-action');
    removeBtn.connect('clicked', () => {
      this._registry.removeWidget(widget.id);
      this._rebuildSidebar();
    });

    actBox.append(exportBtn);
    actBox.append(removeBtn);
    box.append(actBox);

    return box;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Import helpers
  // ═══════════════════════════════════════════════════════════════════════

  _importFolder() {
    const chooser = new Gtk.FileChooserNative({
      title: 'Import widget folder',
      action: Gtk.FileChooserAction.SELECT_FOLDER,
      transient_for: this._window,
      modal: true,
    });
    chooser.connect('response', (d, r) => {
      if (r === Gtk.ResponseType.ACCEPT) {
        try {
          const w = importFromFolder(d.get_file().get_path());
          this._registry.setWidget(w.id, w);
          this._rebuildSidebar();
        } catch (e) { logError(e, 'Import folder failed'); }
      }
      d.destroy();
    });
    chooser.show();
  }

  _importArchive() {
    const chooser = new Gtk.FileChooserNative({
      title: 'Import widget archive',
      action: Gtk.FileChooserAction.OPEN,
      transient_for: this._window,
      modal: true,
    });
    const filter = new Gtk.FileFilter();
    filter.set_name('Widget archives');
    filter.add_pattern('*.zip');
    filter.add_pattern('*.tar');
    filter.add_pattern('*.tgz');
    filter.add_pattern('*.tar.gz');
    chooser.add_filter(filter);
    chooser.connect('response', (d, r) => {
      if (r === Gtk.ResponseType.ACCEPT) {
        try {
          const w = importFromArchive(d.get_file().get_path());
          this._registry.setWidget(w.id, w);
          this._rebuildSidebar();
        } catch (e) { logError(e, 'Archive import failed'); }
      }
      d.destroy();
    });
    chooser.show();
  }
}
