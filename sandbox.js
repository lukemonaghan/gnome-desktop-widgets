import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const FORBIDDEN_TOKENS = [
  'require',
  'imports',
  'global',
  'process',
  'eval',
  'Function',
  'XMLHttpRequest',
  'spawn',
];

export class WidgetSandbox {
  constructor(manifest, api, ctx) {
    this.manifest = manifest || {};
    this.trusted = !!this.manifest.trusted;
    this.permissions = new Set(this.manifest.permissions || []);
    this.api = api;
    this.ctx = ctx;
    this._widget = null;
    this._cleanup = null;
  }

  hasPermission(scope) {
    if (this.trusted) return true;
    return this.permissions.has(scope);
  }

  _validateSource(source) {
    if (this.trusted) return true;
    const normalized = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const token of FORBIDDEN_TOKENS) {
      const re = new RegExp(`\\b${token}\\b`, 'g');
      if (re.test(normalized)) {
        throw new Error(`Sandbox violation: token '${token}' is not allowed`);
      }
    }
    return true;
  }

  _createSafeContext() {
    const safe = {
      console: {
        log: (msg) => log(`DesktopWidgets sandbox [${this.manifest.id}]: ${msg}`),
        warn: (msg) => log(`DesktopWidgets sandbox WARN [${this.manifest.id}]: ${msg}`),
        error: (msg) => log(`DesktopWidgets sandbox ERROR [${this.manifest.id}]: ${msg}`),
      },
      setTimeout: (fn, ms) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        try { fn(); } catch (e) { log(`DesktopWidgets sandbox timer failed: ${e}`); }
        return GLib.SOURCE_REMOVE;
      }),
      clearTimeout: (id) => { try { GLib.source_remove(id); } catch (_) {} },
      Date,
      Math,
      JSON,
      Number,
      String,
      Boolean,
      Array,
      Object,
      RegExp,
      Map,
      Set,
      Promise,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      TextDecoder,
      TextEncoder,
    };

    return safe;
  }

  loadScript(source) {
    this._validateSource(source);
    const context = this._createSafeContext();

    try {
      const keys = Object.keys(context);
      const values = keys.map((k) => context[k]);

      // The widget script defines functions at top level.
      // We wrap it so render/update/onClick/onDestroy are captured.
      const wrapper = `
        ${source};
        return {
          render: typeof render === 'function' ? render : undefined,
          update: typeof update === 'function' ? update : undefined,
          onClick: typeof onClick === 'function' ? onClick : undefined,
          onResize: typeof onResize === 'function' ? onResize : undefined,
          onDestroy: typeof onDestroy === 'function' ? onDestroy : undefined,
        };
      `;

      const func = new Function(...keys, wrapper);
      this._widget = func(...values);

      if (typeof this._widget !== 'object' || this._widget === null) {
        this._widget = {};
      }

      return this._widget;
    } catch (e) {
      throw new Error(`Sandbox script evaluation error: ${e}`);
    }
  }

  callRender() {
    if (!this._widget || typeof this._widget.render !== 'function') return null;
    try {
      this._cleanup = this._widget.render(this.ctx, this.api);
    } catch (e) {
      log(`DesktopWidgets sandbox render() failed for ${this.manifest.id}: ${e}`);
    }
    return this._cleanup;
  }

  callUpdate() {
    if (!this._widget || typeof this._widget.update !== 'function') return;
    try {
      this._widget.update(this.ctx, this.api);
    } catch (e) {
      log(`DesktopWidgets sandbox update() failed for ${this.manifest.id}: ${e}`);
    }
  }

  callOnClick() {
    if (!this._widget || typeof this._widget.onClick !== 'function') return;
    try {
      this._widget.onClick(this.ctx, this.api);
    } catch (e) {
      log(`DesktopWidgets sandbox onClick() failed for ${this.manifest.id}: ${e}`);
    }
  }

  callOnResize(width, height) {
    if (!this._widget || typeof this._widget.onResize !== 'function') return;
    try {
      this._widget.onResize(this.ctx, this.api, width, height);
    } catch (e) {
      log(`DesktopWidgets sandbox onResize() failed for ${this.manifest.id}: ${e}`);
    }
  }

  callOnDestroy() {
    if (typeof this._cleanup === 'function') {
      try { this._cleanup(); } catch (e) {
        log(`DesktopWidgets sandbox cleanup failed for ${this.manifest.id}: ${e}`);
      }
      this._cleanup = null;
    }
    if (this._widget && typeof this._widget.onDestroy === 'function') {
      try { this._widget.onDestroy(); } catch (e) {
        log(`DesktopWidgets sandbox onDestroy() failed for ${this.manifest.id}: ${e}`);
      }
    }
  }
}
