// Heads-up display: rider state, speed, altitude, the density under the board against the
// ride threshold, catch results and controller status.

const STATE_LABEL = { riding: 'Riding', drifting: 'Drifting', freefall: 'Air' };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
// Bearing in radians clockwise from north (-z), with east = +x.
const compass = (b) => COMPASS[((Math.round((b / (Math.PI * 2)) * 16) % 16) + 16) % 16];
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <section class="readout" aria-live="off">
        <div class="state-row"><span class="chip" id="hud-state">Riding</span><span class="brace-pill" id="hud-brace">Brace</span><span class="layer" id="hud-layer"></span></div>
        <div class="speed"><span id="hud-speed">0</span><span class="unit">m/s</span><span class="kmh" id="hud-kmh">0 km/h</span></div>
        <dl class="stats">
          <div><dt>Altitude</dt><dd id="hud-alt">0 m</dd></div>
          <div><dt>Above floor</dt><dd id="hud-floor">0 m</dd></div>
          <div><dt>Air</dt><dd id="hud-air">0.0 s</dd></div>
        </dl>
        <div class="density">
          <div class="density-label"><span>Trapar here</span><span id="hud-rho">0.00</span></div>
          <div class="bar" id="hud-bar"><div class="fill" id="hud-fill"></div><div class="mark base" id="hud-base" title="Ride threshold"></div><div class="mark now" id="hud-thr" title="Ride threshold"></div></div>
          <div class="density-legend"><span id="hud-face"></span></div>
        </div>
        <div class="gauge">
          <div class="density-label"><span>Boost</span><span id="hud-gauge-v">50%</span></div>
          <div class="bar gauge-bar"><div class="fill boost" id="hud-gauge"></div></div>
          <div class="reach" id="hud-reach"></div>
        </div>
        <div class="route" id="hud-route" hidden></div>
        <div class="gauge hold" id="hud-hold" hidden>
          <div class="density-label"><span>Stream hold</span><span id="hud-hold-v"></span></div>
          <div class="bar gauge-bar"><div class="fill hold" id="hud-hold-fill"></div><div class="mark need" id="hud-hold-need" title="Hold you need here"></div></div>
        </div>
        <div class="conditions" id="hud-cond">
          <div class="cond-row"><span class="cond-k">Wind</span><span id="hud-wind">calm</span></div>
          <div class="cond-row"><span class="cond-k">Air</span><span id="hud-airq">clear</span></div>
          <div class="cond-row"><span class="cond-k">Storm</span><span id="hud-storm">none near</span></div>
        </div>
      </section>
      <section class="status">
        <div class="pad" id="hud-pad">No controller. Press any button on it, or use the keyboard.</div>
        <div class="meta"><span id="hud-fps">-- fps</span><span id="hud-clock">sky 0:00</span><span id="hud-res"></span></div>
        <div class="buttons">
          <button type="button" id="hud-btn-panel">Tuning <kbd>Tab</kbd></button>
          <button type="button" id="hud-btn-help">Controls <kbd>H</kbd></button>
          <button type="button" id="hud-btn-storm">Spawn storm <kbd>T</kbd></button>
          <button type="button" id="hud-btn-respawn">Respawn <kbd>R</kbd></button>
        </div>
      </section>
      <section class="banner" id="hud-banner" hidden><strong id="hud-banner-title"></strong><span id="hud-banner-sub"></span></section>
      <section class="guide" id="hud-guide" hidden><span class="g-icon" id="hud-g-icon"></span><div class="g-text"><strong id="hud-g-main"></strong><span id="hud-g-sub"></span></div><span class="g-dist" id="hud-g-dist"></span></section>
      <section class="notice" id="hud-notice" hidden></section>
      <section class="runbar"><span id="hud-run"></span></section>
      <section class="slice-label" id="hud-slice" hidden>Trapar slice, side view (gray is cloud). <b class="t">Teal</b> ridable now, <b class="a">amber</b> ridable at rest, red dot is you.</section>
    `;
    const $ = (id) => root.querySelector('#' + id);
    this.el = {
      state: $('hud-state'), layer: $('hud-layer'), brace: $('hud-brace'), speed: $('hud-speed'), kmh: $('hud-kmh'),
      alt: $('hud-alt'), floor: $('hud-floor'), air: $('hud-air'), rho: $('hud-rho'),
      fill: $('hud-fill'), face: $('hud-face'), base: $('hud-base'), thr: $('hud-thr'), pad: $('hud-pad'), fps: $('hud-fps'),
      clock: $('hud-clock'), res: $('hud-res'), banner: $('hud-banner'), bTitle: $('hud-banner-title'),
      bSub: $('hud-banner-sub'), notice: $('hud-notice'), run: $('hud-run'),
      gauge: $('hud-gauge'), gaugeV: $('hud-gauge-v'), hold: $('hud-hold'), holdV: $('hud-hold-v'), holdFill: $('hud-hold-fill'), holdNeed: $('hud-hold-need'), reach: $('hud-reach'), slice: $('hud-slice'), btnPanel: $('hud-btn-panel'), btnStorm: $('hud-btn-storm'),
      route: $('hud-route'),
      guide: $('hud-guide'), gIcon: $('hud-g-icon'), gMain: $('hud-g-main'), gSub: $('hud-g-sub'), gDist: $('hud-g-dist'),
      wind: $('hud-wind'), airq: $('hud-airq'), swell: $('hud-swell'), swell2: $('hud-swell2'), swell2Row: $('hud-swell2-row'), storm: $('hud-storm'), btnHelp: $('hud-btn-help'), btnRespawn: $('hud-btn-respawn'),
    };
    this.bannerT = 0;
    this._last = {};
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 60;
  }

  _set(key, el, text) {
    if (this._last[key] !== text) { el.textContent = text; this._last[key] = text; }
  }

  showCatch(ev) {
    const e = this.el;
    const titles = { clean: 'Clean catch', sketchy: 'Sketchy catch', wipeout: 'Wipeout' };
    e.banner.dataset.kind = ev.type;
    e.bTitle.textContent = titles[ev.type];
    e.bSub.textContent = ev.type === 'wipeout'
      ? (ev.slam ? `slammed into a wall at ${ev.into.toFixed(0)} m/s` : ev.reason === 'upside down' ? 'board upside down, fell through' : ev.reason === 'crash' ? `crashed at ${ev.into.toFixed(0)} m/s` : `hit at ${ev.into.toFixed(0)} m/s, fell through`)
      : `${ev.trick ? ev.trick + ' · ' : ''}+${ev.gain.toFixed(1)} m/s from a ${ev.into.toFixed(0)} m/s drop · ${ev.air.toFixed(1)} s air`;
    e.banner.hidden = false;
    e.banner.classList.remove('pop'); void e.banner.offsetWidth; e.banner.classList.add('pop');
    this.bannerT = 2.2;
  }

  mmss(s) { return mmss(s); }
  bearing(dx, dz) { return compass(Math.atan2(dx, -dz)); }
  // Route readout (empty text hides it).
  setRoute(text) {
    if (this._last.route === text) return;
    this._last.route = text;
    this.el.route.hidden = !text;
    this.el.route.textContent = text ? `Route · ${text}` : '';
  }
  // Route guidance card: the next maneuver (icon, what to do, how far) and the route under it.
  // null hides it.
  setGuide(g) {
    const e = this.el;
    const key = g ? `${g.icon}|${g.text}|${g.dist}|${g.sub}|${g.kind}` : '';
    if (this._last.guide === key) return;
    this._last.guide = key;
    e.guide.hidden = !g;
    if (!g) return;
    e.gIcon.textContent = g.icon; e.gMain.textContent = g.text; e.gSub.textContent = g.sub; e.gDist.textContent = g.dist;
    e.guide.dataset.kind = g.kind || '';
  }
  showRoute(name, t, prev) {
    const e = this.el;
    e.banner.dataset.kind = 'clean';
    e.bTitle.textContent = `Reached ${name}`;
    e.bSub.textContent = `${mmss(t)}${prev === undefined ? ' · first time' : t < prev ? ` · new best (was ${mmss(prev)})` : ` · best ${mmss(prev)}`}`;
    e.banner.hidden = false;
    e.banner.classList.remove('pop'); void e.banner.offsetWidth; e.banner.classList.add('pop');
    this.bannerT = 3.5;
  }

  notice(text, seconds = 2.5) {
    this.el.notice.textContent = text;
    this.el.notice.hidden = false;
    this.noticeT = seconds;
  }

  _conditions(rider, world) {
    const e = this.el, p = rider.pos;
    const w = world.weather.windAt(p.y, world.t, { x: 0, y: 0, z: 0 });
    const ws = Math.hypot(w.x, w.z);
    this._set('wind', e.wind, ws < 0.5 ? 'calm' : `${ws.toFixed(0)} m/s from ${compass(Math.atan2(-w.x, w.z))}`);
    const cd = rider.dbg.cloud, turb = rider.dbg.turb;
    let air = cd > 0.4 ? 'in cloud' : cd > 0.05 ? 'cloud edge' : 'clear';
    if (turb > 2) air += `, turbulent`;
    if (rider.dbg.chaos > 0.1) air += ', storm churn';
    this._set('airq', e.airq, air);
    const alive = world.weather.alive;
    if (alive.length) {
      const a = alive[0];
      this._set('storm', e.storm, `${km(Math.hypot(a.x - p.x, a.z - p.z))} ${compass(Math.atan2(a.x - p.x, -(a.z - p.z)))}${a.s.manual ? ' (spawned)' : ''}`);
    } else this._set('storm', e.storm, 'none near');
  }

  update(dt, rider, P, input, skyTime, cloudScale, world, gpuMs = null, renderScale = 1) {
    this.condT = (this.condT || 0) - dt;
    if (world && this.condT <= 0) { this._conditions(rider, world); this.condT = 0.25; }
    const e = this.el;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this._set('fps', e.fps, `${this.fps.toFixed(0)} fps`); }

    let label = STATE_LABEL[rider.state];
    let kind = rider.state;
    if (rider.throughT > 0) { label = 'Falling through'; kind = 'wipeout'; }
    else if (rider.state === 'riding' && rider.holdNeed > 1 && rider.holdMargin < 3) { label = 'Peeling'; kind = 'wipeout'; }
    else if (rider.wipeT > 0) { label = 'Wiped out'; kind = 'wipeout'; }
    else if (rider.state === 'riding' && rider.face === 'outside') { label = 'Riding outside'; kind = 'skimming'; }
    else if (rider.state === 'drifting') { label = 'In the stream'; kind = 'drifting'; }
    else if (rider.state === 'freefall' && rider.falling) { label = rider.flying ? 'Flying' : 'Free fall'; kind = rider.flying ? 'flying' : 'freefall'; }
    else if (rider.mode === 'foot') {
      if (rider.state === 'walking') { label = rider.rollT > 0 ? 'Rolling' : 'On foot'; kind = 'skimming'; }
      else { label = rider.summonT > 0 ? 'Board coming' : rider.diving ? 'Diving' : 'Skydiving'; kind = rider.summonT > 0 ? 'flying' : 'freefall'; }
    }
    if (this._last.kind !== kind) { e.state.dataset.kind = kind; this._last.kind = kind; }
    this._set('state', e.state, label);
    // Brace: lit while held; cyan in the air once locked onto a landing.
    const bk = rider.mode === 'foot' ? 'hide' : rider.brace > 0.3 ? (rider.state !== 'riding' && rider.braceLock ? 'lock' : 'on') : '';
    if (this._last.brace !== bk) {
      e.brace.hidden = bk === 'hide';
      e.brace.classList.toggle('on', bk === 'on'); e.brace.classList.toggle('lock', bk === 'lock');
      e.brace.textContent = bk === 'lock' ? 'Brace: locked' : 'Brace';
      this._last.brace = bk;
    }
    const featureNames = {
      trunk: 'trunk', root: 'root', rootlet: 'rootlet', tendril: 'tendril', knot: 'knot connector', cord: 'cord',
      barrel: 'trunk: barrel', pipe: 'trunk: pipe', twine: 'trunk: strands twining', spiral: 'root: spiral loop',
      twist: 'corkscrew', lane: 'lane (fork)', tip: 'drop ahead', none: 'no trapar',
      updraft: 'updraft', 'spiral updraft': 'spiral updraft', chute: 'chute', ramp: 'ramp', rapids: 'rapids', swell: 'swell',
      dock: 'dock', island: 'island',
    };
    const nl = rider.dbg.netLayer, fn = rider.state === 'riding' && rider.onSwell > 0.4 ? 'riding a swell' : featureNames[rider.dbg.feature] || '';
    const ln = nl >= 0 && nl <= 2 && rider.dbg.feature !== 'none' ? ['tangle', 'main', 'crown'][nl] + ' · ' : '';
    const onIsland = rider.mode === 'foot' && rider.state === 'walking' && rider.footIsland;
    this._set('layer', e.layer, onIsland ? `${rider.footIsland.name} · island` : rider.mode === 'foot' ? '' : ln + fn);

    // Stream hold: shown where gravity or a crest is trying to pull you off (overhangs,
    // undersides, corkscrews, fast crests).
    const showHold = rider.state === 'riding' && rider.holdNeed > 0.3 * P.gravity;
    if (this._last.showHold !== showHold) { e.hold.hidden = !showHold; this._last.showHold = showHold; }
    if (showHold) {
      const scale = Math.max(0.01, rider.holdScale);
      const have = Math.min(1, (rider.holdNeed + rider.holdMargin) / scale);
      const need = Math.min(1, rider.holdNeed / scale);
      e.holdFill.style.width = `${(have * 100).toFixed(1)}%`;
      e.holdFill.classList.toggle('low', have < need * 1.1);
      e.holdNeed.style.left = `${(need * 100).toFixed(1)}%`;
      this._set('holdV', e.holdV, have < need * 1.1 ? (rider.brace > 0.3 ? 'go faster with the flow' : 'brace (RT) or go faster') : `${Math.round(have * 100)}%`);
    }

    const sp = rider.speed();
    this._set('speed', e.speed, sp.toFixed(0));
    this._set('kmh', e.kmh, `${(sp * 3.6).toFixed(0)} km/h`);
    this._set('alt', e.alt, `${rider.pos.y.toFixed(0)} m`);
    const above = rider.pos.y - P.floorAltitude;
    this._set('floor', e.floor, `${above.toFixed(0)} m`);
    e.floor.classList.toggle('warn', above < 150);
    this._set('air', e.air, `${(rider.state === 'riding' ? 0 : rider.airT).toFixed(1)} s`);

    const max = 3;
    const pct = (x) => `${Math.min(100, (x / max) * 100).toFixed(1)}%`;
    this._set('rho', e.rho, `${rider.dbg.rho.toFixed(2)} / ${rider.dbg.thr.toFixed(2)}`);
    e.fill.style.width = pct(rider.dbg.rho);
    e.fill.classList.toggle('ok', rider.dbg.rho >= rider.dbg.thr);
    e.base.style.left = pct(P.rideThreshold);
    e.thr.style.left = pct(rider.dbg.thr);
    const faceText = rider.state === 'riding' ? (rider.face === 'outside' ? `outside face, ${Math.round(rider.faceAngle)}° from the top (limit ${Math.round(P.outsideReach)}°)` : 'inside face') : '';
    this._set('face', e.face, faceText);

    const padText = input.padName ? `${input.padName}` : 'No controller. Press any button on it, or use the keyboard.';
    this._set('pad', e.pad, padText);
    e.pad.classList.toggle('connected', !!input.padName);
    const m = Math.floor(skyTime / 60), s = Math.floor(skyTime % 60);
    this._set('clock', e.clock, `sky ${m}:${String(s).padStart(2, '0')}`);
    this._set('res', e.res, `${gpuMs !== null ? `gpu ${gpuMs.toFixed(1)} ms · ` : ''}${renderScale < 0.999 ? `res ${(renderScale * 100).toFixed(0)}% · ` : ''}clouds ${(cloudScale * 100).toFixed(0)}%`);

    const st = rider.stats;
    this._set('run', e.run, `top ${st.maxSpeed.toFixed(0)} m/s · longest air ${st.longestAir.toFixed(1)} s · clean ${st.clean} · sketchy ${st.sketchy} · wipeouts ${st.wipeouts}`);

    // Boost gauge and target.
    const gv = P.boostInfinite ? 1 : rider.gauge;
    e.gauge.style.width = `${(gv * 100).toFixed(1)}%`;
    e.gauge.classList.toggle('on', rider.boosting);
    const mode = rider.state !== 'riding' && rider.falling ? 'flies' : '';
    this._set('gaugeV', e.gaugeV, (mode ? 'free fall: boost flies · ' : '') + (P.boostInfinite ? 'infinite' : `${Math.round(gv * 100)}%`));
    const tg = rider.boostTarget;
    let reach = '', reachKind = '';
    if (P.reachScan) {
      if (tg) {
        const dir = tg.d > 30 ? `, ${km(tg.d)} ${compass(Math.atan2(tg.x - rider.pos.x, -(tg.z - rider.pos.z)))}` : ' overhead';
        const h = tg.dh >= 0 ? `${Math.round(tg.dh)} m up` : `${Math.round(-tg.dh)} m down`;
        const need = tg.need < 0.01 ? 'no boost needed' : `needs ${Math.round(tg.need * 100)}%`;
        reach = `${tg.kind === 'rescue' ? 'Rescue' : 'Climb'}: ${h}${dir}, ${need}`;
        reachKind = tg.kind;
      } else if (rider.reachNone) { reach = 'Nothing reachable below or around you'; reachKind = 'none'; }
    }
    this._set('reach', e.reach, reach);
    if (this._last.reachKind !== reachKind) { e.reach.dataset.kind = reachKind; this._last.reachKind = reachKind; }

    e.slice.hidden = !P.showSlice;
    if (P.showSlice) {
      const w = Math.min(420, window.innerWidth - 28);
      e.slice.style.bottom = `${52 + Math.round((w * 360) / 640) + 6}px`;
      e.slice.style.width = `${w}px`;
    }

    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) e.banner.hidden = true; }
    if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT <= 0) e.notice.hidden = true; }
  }
}
