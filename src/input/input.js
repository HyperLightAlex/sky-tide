// Controller-first input with a keyboard fallback.
//
// Standard gamepad mapping:
//   Left stick X  lean (carve) / spin in the air
//   Left stick Y  forward = tuck (weight forward), back = weight on the tail (slows, pivots) / flip in the air
//   A             hold to crouch (pump, charge a pop, or set for a catch), release to pop
//   RT            brace (analog): stay anchored to the stream you are on
//   LT            snap (hard back-foot turn)
//   Right stick   look around
//   Y             board: jump off it / call it back (in the air) / step onto a stream (on foot)
//   View / Back   respawn          Menu / Start  tuning panel
//   X             density slice    D-pad left    force arrows
//   D-pad up      spawn a storm    D-pad down    clear spawned storms
//   D-pad right   new route (to an island)
//   B             boost (hold) / burst (tap). In free fall it flies you where the nose points.
//                 On foot: run.
//   LB / RB       trapar sense pulse
// On foot the left stick moves you (relative to the camera), A jumps (skydiving: hold to dive)
// and the right stick turns the camera.
//
// Keyboard: A/D lean, W/S tuck/tail, Space crouch/pop, Shift brace, Q snap, X board,
// arrow keys look, R respawn, Tab tuning panel, G arrows, V slice, F freeze sky,
// P pause, H controls, T spawn a storm, C clear spawned storms, E boost, Z sense pulse,
// N new route, I go to the nearest island.

const DEAD = 0.14;

function stick(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const s = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * s, y * s];
}

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.state = {
      lean: 0, trim: 0, snap: 0, brace: 0, crouch: false, crouchReleased: false,
      lookX: 0, lookY: 0,
      boost: false, boostPressed: false,
      boardPressed: false,
    };
    this._pendingBoard = false;
    this._prevBoost = false;
    this._pendingBoostPress = false;
    this.actions = new Set(); // one-shot actions for the app: respawn, panel, arrows, slice, freeze, pause, help
    this.padName = '';
    this.padIndex = -1;
    this.usingPad = false;
    this._prevButtons = [];
    this._prevCrouch = false;
    this._pendingRelease = false;

    target.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (k === 'Tab') { e.preventDefault(); this.actions.add('panel'); return; }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (!e.repeat) {
        if (k === 'KeyR') this.actions.add('respawn');
        if (k === 'KeyG') this.actions.add('arrows');
        if (k === 'KeyV') this.actions.add('slice');
        if (k === 'KeyF') this.actions.add('freeze');
        if (k === 'KeyP') this.actions.add('pause');
        if (k === 'KeyH') this.actions.add('help');
        if (k === 'KeyT') this.actions.add('storm');
        if (k === 'KeyC') this.actions.add('clearStorms');
        if (k === 'KeyZ') this.actions.add('sense');
        if (k === 'KeyX') this._pendingBoard = true;
        if (k === 'KeyN') this.actions.add('route');
        if (k === 'KeyI') this.actions.add('island');
      }
      this.keys.add(k);
      this.usingPad = false;
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', (e) => { if (e.gamepad.index === this.padIndex) this.padIndex = -1; });
  }

  _pad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.padIndex >= 0 && pads[this.padIndex]?.connected) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) { this.padIndex = p.index; return p; }
    return null;
  }

  // Read devices. Call once per rendered frame.
  poll() {
    const k = this.keys, s = this.state;
    const pad = this._pad();
    let lean = 0, trim = 0, snap = 0, brace = 0, crouch = false, lookX = 0, lookY = 0, boost = false;

    if (pad) {
      this.padName = pad.id.replace(/\(.*?\)/g, '').trim() || 'Controller';
      const ax = pad.axes, b = pad.buttons;
      const [lx, ly] = stick(ax[0] || 0, ax[1] || 0);
      const [rx, ry] = stick(ax[2] || 0, ax[3] || 0);
      const val = (i) => (b[i] ? (typeof b[i] === 'object' ? b[i].value : b[i]) : 0);
      const pressed = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
      lean = lx; trim = ly; lookX = rx; lookY = ry;
      brace = val(7); snap = val(6);
      crouch = pressed(0);
      boost = pressed(1);
      const edge = (i) => pressed(i) && !this._prevButtons[i];
      if (edge(8)) this.actions.add('respawn');
      if (edge(9)) this.actions.add('panel');
      if (edge(3)) this._pendingBoard = true;
      if (edge(14)) this.actions.add('arrows');
      if (edge(15)) this.actions.add('route');
      if (edge(2)) this.actions.add('slice');
      if (edge(12)) this.actions.add('storm');
      if (edge(13)) this.actions.add('clearStorms');
      if (edge(4) || edge(5)) this.actions.add('sense');
      const any = lx || ly || rx || ry || brace > 0.05 || snap > 0.05 || b.some((x, i) => pressed(i));
      if (any) this.usingPad = true;
      this._prevButtons = b.map((x, i) => pressed(i));
    } else {
      this.padName = '';
    }

    // Keyboard adds on top (lets you test without a controller).
    const kb = (a, b2) => (k.has(a) ? 1 : 0) - (k.has(b2) ? 1 : 0);
    lean += kb('KeyD', 'KeyA');
    trim += kb('KeyS', 'KeyW');
    lookX += kb('ArrowRight', 'ArrowLeft');
    lookY += kb('ArrowDown', 'ArrowUp');
    if (k.has('ShiftLeft') || k.has('ShiftRight')) brace = 1;
    if (k.has('KeyQ')) snap = 1;
    if (k.has('Space')) crouch = true;
    if (k.has('KeyE')) boost = true;

    const cl = (x) => Math.max(-1, Math.min(1, x));
    s.lean = cl(lean); s.trim = cl(trim); s.snap = Math.min(1, snap); s.brace = Math.min(1, brace);
    s.lookX = cl(lookX); s.lookY = cl(lookY);
    if (this._prevCrouch && !crouch) this._pendingRelease = true;
    this._prevCrouch = crouch;
    s.crouch = crouch;
    s.crouchReleased = this._pendingRelease;
    if (boost && !this._prevBoost) this._pendingBoostPress = true;
    this._prevBoost = boost;
    s.boost = boost;
    s.boostPressed = this._pendingBoostPress;
    s.boardPressed = this._pendingBoard;
  }

  // Physics consumed the release edge; clear it so it fires once.
  consumeEdges() { this._pendingRelease = false; this.state.crouchReleased = false; this._pendingBoostPress = false; this.state.boostPressed = false; this._pendingBoard = false; this.state.boardPressed = false; }

  takeActions() { const a = [...this.actions]; this.actions.clear(); return a; }

  rumble(strength, ms) {
    const pad = this._pad();
    const act = pad && pad.vibrationActuator;
    if (!act || !act.playEffect) return;
    try {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.7) }).catch(() => {});
    } catch { /* not supported */ }
  }
}
