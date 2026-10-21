// Tuning panel built from the config schema. Every constant is live.

import GUI from 'lil-gui';
import { SCHEMA, defaultParams, STAGES, STAGE_KEYS, DEFAULT_STAGE } from '../config.js';

const STORE_KEY = 'skytide.sandbox.preset.v1';

export class Panel {
  constructor(P, actions) {
    this.P = P;
    this.gui = new GUI({ title: 'Tuning', width: 320 });
    this.gui.domElement.classList.add('tuning');
    this.controllers = {};
    const top = {
      respawn: () => actions.respawn(),
      copy: () => this.copy(),
      save: () => this.save(),
      load: () => this.load(),
      reset: () => this.reset(),
      storm: () => actions.spawnStorm(),
      clear: () => actions.clearStorms(),
    };
    // Test stages: which trapar features are switched on.
    this.stage = { name: DEFAULT_STAGE };
    this.gui.add(this.stage, 'name', Object.keys(STAGES)).name('Test stage').onChange((n) => {
      this.applyStage(n);
      actions.onStage?.(n);
    });
    this.gui.add(top, 'respawn').name('Respawn');
    this.gui.add(top, 'storm').name('Spawn storm (T)');
    this.gui.add(top, 'clear').name('Clear spawned storms (C)');
    const presets = this.gui.addFolder('Presets');
    presets.add(top, 'save').name('Save to this browser');
    presets.add(top, 'load').name('Load saved');
    presets.add(top, 'copy').name('Copy as JSON');
    presets.add(top, 'reset').name('Reset all to defaults');
    this.status = document.createElement('div');
    this.status.className = 'tuning-status';
    this.status.setAttribute('role', 'status');
    presets.domElement.querySelector('.children').appendChild(this.status);
    presets.close();

    for (const f of SCHEMA) {
      const folder = this.gui.addFolder(f.folder);
      for (const [key, def, min, max, step, label] of f.items) {
        const c = typeof def === 'boolean' ? folder.add(P, key).name(label)
          : typeof def === 'string' ? folder.add(P, key, min).name(label)
          : folder.add(P, key, min, max, step).name(label);
        this.controllers[key] = c;
      }
      folder.close();
    }
    // Values the app can change by itself.
    for (const k of ['resScale', 'freezeSky', 'showArrows', 'showSlice', 'seed']) this.controllers[k]?.listen();
    this.gui.close();
    this.visible = window.innerWidth > 720;
    this.gui.domElement.hidden = !this.visible;
  }

  toggle() {
    if (!this.visible) { this.visible = true; this.gui.domElement.hidden = false; this.gui.open(); }
    else if (this.gui._closed) this.gui.open();
    else { this.visible = false; this.gui.domElement.hidden = true; }
  }

  _say(text) { this.status.textContent = text; }

  async copy() {
    const json = JSON.stringify(this.P, null, 2);
    try { await navigator.clipboard.writeText(json); this._say('Settings copied.'); }
    catch { this._say('Copy was blocked here. Settings are printed in the browser console.'); console.log(json); }
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.P)); this._say('Saved in this browser.'); }
    catch { this._say('This browser blocked saving.'); }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) { this._say('Nothing saved yet.'); return; }
      const v = JSON.parse(raw);
      for (const k of Object.keys(this.P)) if (k in v && typeof v[k] === typeof this.P[k]) this.P[k] = v[k];
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
      this._say('Loaded saved settings.');
    } catch { this._say('Could not read saved settings.'); }
  }

  applyStage(name) {
    const st = STAGES[name];
    if (!st) return;
    const d = defaultParams();
    for (const k of STAGE_KEYS) this.P[k] = d[k];
    Object.assign(this.P, st);
    this.stage.name = name;
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this._say(`Stage: ${name}.`);
  }

  reset() {
    const d = defaultParams();
    for (const k of Object.keys(d)) this.P[k] = d[k];
    this.stage.name = DEFAULT_STAGE;
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this._say('Reset to defaults.');
  }
}
