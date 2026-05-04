// DOM updates (stats, banner, comp bars) and event wiring.

import {
  type State,
  X_core, Y_core, X_env, Y_env,
  luminosity, surfaceT, totalMass, muCore, remainingLifetime,
  addH, mineH, extractHe, mixStar, reset, record, evolutionaryPhase,
} from './physics.js';

const BANNERS = {
  MS:        { cls: 'alive',     text: '◊ Hydrostatic equilibrium · Main-sequence hydrogen burning' },
  turnoff:   { cls: 'turnoff',   text: '◇ Approaching turnoff · Core hydrogen depleting' },
  subgiant:  { cls: 'subgiant',  text: '◆ Subgiant · Core contracting, envelope expanding' },
  RGB:       { cls: 'rgb',       text: '★ Red giant branch · Shell burning around inert He core' },
  exhausted: { cls: 'dead',      text: '✕ Hydrogen exhausted · Main sequence terminated' },
};

const FLASH_IDS = ['stat-mass', 'stat-l', 'stat-x', 'stat-y', 'stat-mu', 'stat-env'];

function setText(id: string, html: string): void {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function flashStats(): void {
  for (const id of FLASH_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.remove('flash');
    void el.offsetWidth; // restart animation
    el.classList.add('flash');
  }
}

export function updateStats(s: State): void {
  const M = totalMass(s);
  const L = luminosity(s);
  const T = surfaceT(s);
  const X = X_core(s), Y = Y_core(s);
  const mu = muCore(s);

  setText('stat-mass',  `${M.toFixed(3)} <span class="unit">M☉</span>`);
  setText('stat-l',     `${L.toFixed(3)} <span class="unit">L☉</span>`);
  setText('stat-tsurf', `${Math.round(T)} <span class="unit">K</span>`);
  setText('stat-x', X.toFixed(3));
  setText('stat-y', Y.toFixed(3));
  setText('stat-mu', mu.toFixed(3));
  setText('stat-env', `${X_env(s).toFixed(3)} / ${Y_env(s).toFixed(3)}`);
  setText('stat-age', `${(s.age / 1e9).toFixed(3)} <span class="unit">Gyr</span>`);

  const remaining = remainingLifetime(s);
  const remStr = s.alive
    ? (isFinite(remaining) ? `~${remaining.toFixed(2)}` : '∞')
    : '0.00';
  setText('stat-remaining', `${remStr} <span class="unit">Gyr</span>`);

  const Zc = Math.max(0, 1 - X - Y);
  const Ze = Math.max(0, 1 - X_env(s) - Y_env(s));
  const coreBar = document.getElementById('comp-bar-core');
  const envBar = document.getElementById('comp-bar-env');
  if (coreBar) coreBar.innerHTML = `
    <div class="comp-h" style="flex:${X}"></div>
    <div class="comp-he" style="flex:${Y}"></div>
    <div class="comp-z" style="flex:${Zc}"></div>`;
  if (envBar) envBar.innerHTML = `
    <div class="comp-h" style="flex:${X_env(s)}"></div>
    <div class="comp-he" style="flex:${Y_env(s)}"></div>
    <div class="comp-z" style="flex:${Ze}"></div>`;

  const banner = document.getElementById('status-banner');
  if (banner) {
    const b = BANNERS[evolutionaryPhase(s)];
    banner.className = `status-banner ${b.cls}`;
    banner.textContent = b.text;
  }
}

// Wraps an intervention so it flashes the UI and snapshots history afterwards.
function intervene(s: State, fn: () => void): void {
  fn();
  flashStats();
  record(s);
}

export function wireControls(s: State): void {
  const pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement | null;
  pauseBtn?.addEventListener('click', () => {
    s.paused = !s.paused;
    pauseBtn.textContent = s.paused ? 'play' : 'pause';
  });

  document.querySelectorAll<HTMLButtonElement>('#speed-buttons button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#speed-buttons button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      s.yearsPerSecond = parseFloat(btn.dataset.speed ?? '1e7');
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const amount = parseFloat(btn.dataset.amount ?? '0.05');
      switch (action) {
        case 'add-h':      intervene(s, () => addH(s, amount)); break;
        case 'mine-h':     intervene(s, () => mineH(s, amount)); break;
        case 'extract-he': intervene(s, () => extractHe(s)); break;
        case 'mix':        intervene(s, () => mixStar(s)); break;
        case 'reset':      intervene(s, () => reset(s)); break;
      }
    });
  });
}
