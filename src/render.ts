// Rendering: star SVG + luminosity time-series canvas.

import {
  type State,
  X0,
  X_core,
  inertCoreFraction,
  luminosity,
  radius,
  surfaceT,
  earthDistance,
  earthEngulfed,
  hzInner,
  hzOuter,
  totalMass,
} from './physics.js';

// Visual orbit radius for Earth at a = 1 AU. Star peaks at ~85 in the same
// units, so 92 keeps a clear gap at ZAMS while letting the swelling RGB
// star visibly engulf Earth at the tip.
const EARTH_ORBIT_VIS_AU = 92;
// Visual rotation rate (rad/s) — decoupled from physical year so the orbit
// is visible regardless of the simulation time-rate. Modulated by year length
// so a longer real year still rotates noticeably slower.
const EARTH_VIS_OMEGA = 0.6;

type RGB = [number, number, number];

const TEMP_STOPS: { t: number; c: RGB }[] = [
  { t: 2500,  c: [255,  80,  40] },
  { t: 3500,  c: [255, 130,  60] },
  { t: 5000,  c: [255, 200, 110] },
  { t: 6000,  c: [255, 240, 180] },
  { t: 7500,  c: [255, 250, 230] },
  { t: 10000, c: [220, 230, 255] },
  { t: 20000, c: [180, 200, 255] },
  { t: 40000, c: [150, 180, 255] },
];

function tempToColor(T: number): RGB {
  if (T <= TEMP_STOPS[0].t) return TEMP_STOPS[0].c;
  if (T >= TEMP_STOPS[TEMP_STOPS.length - 1].t) return TEMP_STOPS[TEMP_STOPS.length - 1].c;
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    if (T < TEMP_STOPS[i].t) {
      const a = TEMP_STOPS[i - 1], b = TEMP_STOPS[i];
      const f = (T - a.t) / (b.t - a.t);
      return [0, 1, 2].map(j => Math.round(a.c[j] + f * (b.c[j] - a.c[j]))) as RGB;
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1].c;
}

const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`element #${id} not found`);
  return el;
}

export function updateStarSVG(s: State): void {
  const R = radius(s);
  const L = luminosity(s);
  const T = surfaceT(s);
  const X = X_core(s);

  // Compress R visually: real RGB stars are ~100× the Sun's radius, way more
  // than the SVG box. R^0.3 keeps ZAMS visible at modest size and lets the
  // RGB tip fill the panel without clamping the giant phase to a single value.
  const visR = 25 * Math.pow(Math.max(R, 0.05), 0.3);
  const Rdisplay = Math.min(85, Math.max(10, visR));
  const haloR = Rdisplay * (1.3 + 0.15 * Math.log10(L + 0.1));
  // Core contracts as the envelope expands — by RGB tip the He core is a
  // tiny fraction of the photospheric radius. Inverse sqrt(R) captures this
  // qualitatively without needing a separate core-radius physics calc.
  const coreR = Rdisplay * 0.38 / Math.sqrt(Math.max(R, 1));

  const tc = tempToColor(T);
  const surfaceCenter = `rgb(${Math.min(255, tc[0] + 25)},${Math.min(255, tc[1] + 25)},${Math.min(255, tc[2] + 25)})`;
  const surfaceEdge = rgb(tc);
  const surfaceDeep = `rgb(${Math.max(0, tc[0] - 60)},${Math.max(0, tc[1] - 90)},${Math.max(0, tc[2] - 110)})`;

  const Xfrac = Math.max(0, Math.min(1, X / X0));
  const coreInner = s.alive
    ? `rgb(255,${Math.round(220 + 30 * Xfrac)},${Math.round(180 * Xfrac + 50 * (1 - Xfrac))})`
    : `rgb(180,160,140)`;
  const coreOuter = s.alive
    ? `rgb(${Math.round(180 + 75 * Xfrac)},${Math.round(80 + 50 * Xfrac)},${Math.round(20 + 30 * Xfrac)})`
    : `rgb(120,100,80)`;

  const surfStops = document.querySelectorAll('#surfaceGrad stop');
  surfStops[0].setAttribute('stop-color', surfaceCenter);
  surfStops[1].setAttribute('stop-color', surfaceEdge);
  surfStops[2].setAttribute('stop-color', surfaceDeep);

  const haloStops = document.querySelectorAll('#haloGrad stop');
  haloStops[0].setAttribute('stop-color', surfaceEdge);
  haloStops[0].setAttribute('stop-opacity', String(Math.min(0.85, 0.3 + 0.25 * Math.log10(L + 0.1) + 0.1)));
  haloStops[1].setAttribute('stop-color', surfaceEdge);

  const coreStops = document.querySelectorAll('#coreGrad stop');
  coreStops[0].setAttribute('stop-color', coreInner);
  coreStops[1].setAttribute('stop-color', coreOuter);

  // Inert helium ash sits at the very centre of the burning core. Sized by
  // depletion so it grows from invisible at ZAMS to filling the burning core
  // at the RGB tip, with the bright burning region squeezed into a thin shell.
  const heAshR = coreR * Math.min(1, inertCoreFraction(s) * 8);

  $('halo').setAttribute('r', String(haloR));
  $('surface').setAttribute('r', String(Rdisplay));
  $('core').setAttribute('r', String(coreR));
  $('he-ash').setAttribute('r', String(heAshR));

  // Earth: orbit ring scales linearly with a (mass-loss expands the orbit);
  // angle uses real-time so the planet's motion is always visible.
  const aAU = earthDistance(s);
  const orbitR = EARTH_ORBIT_VIS_AU * aAU;
  // Slow visual orbit when the physical year is long: ω ∝ 1/T_yr^(1/3) gives
  // a perceptible-but-honest slowdown without going imperceptibly slow.
  const yearLen = Math.pow(aAU, 1.5) / Math.sqrt(Math.max(0.01, totalMass(s)));
  const omega = EARTH_VIS_OMEGA / Math.cbrt(Math.max(0.1, yearLen));
  const theta = (performance.now() / 1000) * omega;
  const ex = orbitR * Math.cos(theta);
  const ey = orbitR * Math.sin(theta);

  const aIn = hzInner(s);
  const aOut = hzOuter(s);
  const inR = EARTH_ORBIT_VIS_AU * aIn;
  const outR = EARTH_ORBIT_VIS_AU * aOut;
  // Band stroke spans inner→outer; centre it between them and set width to span.
  const bandR = 0.5 * (inR + outR);
  const bandW = Math.max(0.5, outR - inR);
  const hzBand = $('hz-band');
  hzBand.setAttribute('r', String(bandR));
  hzBand.setAttribute('stroke-width', String(bandW));
  $('hz-inner').setAttribute('r', String(inR));
  $('hz-outer').setAttribute('r', String(outR));

  const orbitEl = $('earth-orbit');
  const earthEl = $('earth');
  orbitEl.setAttribute('r', String(orbitR));
  if (earthEngulfed(s)) {
    earthEl.setAttribute('opacity', '0');
    orbitEl.setAttribute('opacity', '0.3');
  } else {
    earthEl.setAttribute('opacity', '1');
    orbitEl.setAttribute('opacity', '1');
    earthEl.setAttribute('cx', String(ex));
    earthEl.setAttribute('cy', String(ey));
  }
}


// ---- plot ----

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

export function initPlot(canvasEl: HTMLCanvasElement): void {
  canvas = canvasEl;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('2d context unavailable');
  ctx = c;
  resizePlot();
  window.addEventListener('resize', resizePlot);
}

export function resizePlot(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}

export function drawPlot(s: State): void {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const padL = 50, padR = 16, padT = 12, padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const hist = s.history;
  if (hist.length < 2) {
    ctx.strokeStyle = 'rgba(232, 214, 176, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, plotW, plotH);
    ctx.fillStyle = 'rgba(232, 214, 176, 0.4)';
    ctx.font = '11px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('— accumulating data —', padL + plotW / 2, padT + plotH / 2);
    return;
  }

  const ageMaxGyr = hist[hist.length - 1].age / 1e9;
  const xMax = Math.max(0.5, ageMaxGyr * 1.05);
  let Lmax = 0.5, Lmin = 1e9;
  for (const p of hist) { if (p.L > Lmax) Lmax = p.L; if (p.L < Lmin) Lmin = p.L; }
  const yMin = Math.max(0, Math.min(0.5, Lmin * 0.85));
  const yMax = Math.max(2, Lmax * 1.1);

  ctx.strokeStyle = 'rgba(232, 214, 176, 0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    const x = padL + (i / 4) * plotW;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(232, 214, 176, 0.2)';
  ctx.strokeRect(padL, padT, plotW, plotH);

  ctx.fillStyle = 'rgba(232, 214, 176, 0.55)';
  ctx.font = '10px JetBrains Mono';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * plotH;
    const v = yMax - (i / 4) * (yMax - yMin);
    ctx.fillText(v.toFixed(v < 10 ? 2 : 1), padL - 6, y + 3);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const x = padL + (i / 4) * plotW;
    const v = (i / 4) * xMax;
    ctx.fillText(v.toFixed(v < 1 ? 2 : 1), x, h - padB + 14);
  }

  ctx.strokeStyle = '#ffaa33';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  hist.forEach((p, i) => {
    const x = padL + (p.age / 1e9 / xMax) * plotW;
    const y = padT + (1 - (p.L - yMin) / (yMax - yMin)) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const yRef = padT + (1 - (1 - yMin) / (yMax - yMin)) * plotH;
  if (yRef > padT && yRef < h - padB) {
    ctx.strokeStyle = 'rgba(136, 170, 255, 0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(padL, yRef); ctx.lineTo(w - padR, yRef); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(136, 170, 255, 0.6)';
    ctx.textAlign = 'left';
    ctx.fillText('L☉', padL + 4, yRef - 4);
  }

  const last = hist[hist.length - 1];
  const cx = padL + (last.age / 1e9 / xMax) * plotW;
  const cy = padT + (1 - (last.L - yMin) / (yMax - yMin)) * plotH;
  ctx.fillStyle = '#ffaa33';
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 2 * Math.PI); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 245, 221, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 2 * Math.PI); ctx.stroke();
}
