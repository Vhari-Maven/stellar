#!/usr/bin/env bun
// CLI driver for the stellar sandbox.
// Persists simulation state to .state.json so commands can be chained.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type State,
  X_core, Y_core, X_env, Y_env,
  createState, luminosity, surfaceT, totalMass, muCore, remainingLifetime,
  earthDistance, earthYear, earthTemp, earthEngulfed, earthClimate,
  hzInner, hzOuter, inHabitableZone,
  step, addH, mineH, extractHe, extractHeAmount, coreHePool, mixStar, record, evolutionaryPhase,
} from './physics.js';

const STATE_FILE = resolve(import.meta.dir, '..', '.state.json');
const SUB_STEP_YEARS = 5e6;

function load(): State {
  if (!existsSync(STATE_FILE)) {
    const s = createState();
    record(s);
    return s;
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
}

function save(s: State): void {
  writeFileSync(STATE_FILE, JSON.stringify(s));
}

function fmt(n: number, d = 3): string {
  if (!isFinite(n)) return '∞';
  return n.toFixed(d);
}

function printStats(s: State): void {
  const M = totalMass(s);
  const L = luminosity(s);
  const T = surfaceT(s);
  const status = s.alive ? evolutionaryPhase(s).toUpperCase() : 'EXHAUSTED';
  const rem = s.alive ? `${fmt(remainingLifetime(s), 2)} Gyr` : '0';

  console.log(`─── stellar sandbox ─── [${status}]`);
  console.log(`  age          ${fmt(s.age / 1e9, 4)} Gyr`);
  console.log(`  mass         ${fmt(M)} M☉`);
  console.log(`  luminosity   ${fmt(L)} L☉`);
  console.log(`  T_surface    ${Math.round(T)} K`);
  console.log(`  μ (core)     ${fmt(muCore(s))}`);
  console.log(`  core   X=${fmt(X_core(s))}  Y=${fmt(Y_core(s))}`);
  console.log(`  env    X=${fmt(X_env(s))}  Y=${fmt(Y_env(s))}`);
  const earthT = earthEngulfed(s) ? 'engulfed' : `${Math.round(earthTemp(s))} K`;
  console.log(`  earth        a=${fmt(earthDistance(s))} AU  yr=${fmt(earthYear(s))}  T=${earthT}  [${earthClimate(s)}]`);
  const aOut = hzOuter(s);
  const hzStr = `${fmt(hzInner(s))} – ${isFinite(aOut) ? fmt(aOut) : '∞'} AU`;
  console.log(`  HZ           ${hzStr}  ${inHabitableZone(s) ? '[earth in zone]' : '[earth outside]'}`);
  console.log(`  remaining    ${rem}  (at current L)`);
  console.log(`  history pts  ${s.history.length}`);
}

function advance(s: State, years: number): void {
  const target = years;
  const steps = Math.max(1, Math.ceil(target / SUB_STEP_YEARS));
  const subdt = target / steps;
  const recordEvery = Math.max(1, Math.floor(steps / 80));
  for (let i = 0; i < steps; i++) {
    step(s, subdt);
    if (i % recordEvery === 0) record(s);
    if (!s.alive) break;
  }
  record(s);
}

function parseYears(arg: string | undefined): number {
  if (!arg) throw new Error('expected a number of years (e.g. 1e8, 100M, 1G)');
  const m = arg.match(/^([0-9.eE+-]+)\s*([MGmgyrYR]*)$/);
  if (!m) return Number(arg);
  const v = Number(m[1]);
  const suf = m[2].toUpperCase();
  if (suf.startsWith('G')) return v * 1e9;
  if (suf.startsWith('M')) return v * 1e6;
  return v;
}

function plot(s: State): void {
  const h = s.history;
  if (h.length < 2) { console.log('(not enough history)'); return; }
  const W = 64, H = 18;
  const ages = h.map(p => p.age);
  const ls = h.map(p => p.L);
  const aMin = ages[0], aMax = ages[ages.length - 1];
  const lMin = Math.min(...ls), lMax = Math.max(...ls);
  const aRange = aMax - aMin || 1;
  const lRange = lMax - lMin || 1;
  const grid: string[][] = Array.from({ length: H }, () => Array(W).fill(' '));
  for (const p of h) {
    const x = Math.round(((p.age - aMin) / aRange) * (W - 1));
    const y = H - 1 - Math.round(((p.L - lMin) / lRange) * (H - 1));
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = '·';
  }
  const last = h[h.length - 1];
  const lx = Math.round(((last.age - aMin) / aRange) * (W - 1));
  const ly = H - 1 - Math.round(((last.L - lMin) / lRange) * (H - 1));
  if (lx >= 0 && lx < W && ly >= 0 && ly < H) grid[ly][lx] = '●';

  console.log(`L / L☉  (range: ${fmt(lMin)} → ${fmt(lMax)})`);
  console.log('┌' + '─'.repeat(W) + '┐');
  for (const row of grid) console.log('│' + row.join('') + '│');
  console.log('└' + '─'.repeat(W) + '┘');
  console.log(`age:    ${fmt(aMin / 1e9, 3)} Gyr ${' '.repeat(Math.max(0, W - 28))}${fmt(aMax / 1e9, 3)} Gyr`);
}

function help(): void {
  console.log(`stellar — CLI for the stellar sandbox

usage: bun run cli <command> [args]

commands:
  init                       reset state to ZAMS, write fresh .state.json
  stats                      print current state
  step <years>               advance time (accepts 1e8, 100M, 1G, 1.5G, ...)
  add-h <ΔM>                 add ΔM solar masses of pure H to the envelope
  mine-h <ΔM>                remove ΔM solar masses from the envelope
  extract-he                 strip He from core, refill from envelope
  mix                        homogenize composition (full convection)
  reset                      same as init
  history [n]                print last n (default 10) history points
  plot                       ASCII plot of L vs age
  help                       this message

state lives in .state.json (gitignored).`);
}

const [cmd, ...rest] = process.argv.slice(2);
const s = load();

switch (cmd) {
  case undefined:
  case 'help':
  case '-h':
  case '--help':
    help();
    break;

  case 'init':
  case 'reset': {
    const fresh = createState();
    record(fresh);
    save(fresh);
    printStats(fresh);
    break;
  }

  case 'stats':
    printStats(s);
    break;

  case 'step': {
    const yrs = parseYears(rest[0]);
    advance(s, yrs);
    save(s);
    printStats(s);
    break;
  }

  case 'add-h': {
    const dm = Number(rest[0] ?? 0.05);
    addH(s, dm);
    record(s);
    save(s);
    printStats(s);
    break;
  }

  case 'mine-h': {
    const dm = Number(rest[0] ?? 0.05);
    mineH(s, dm);
    record(s);
    save(s);
    printStats(s);
    break;
  }

  case 'extract-he':
    extractHe(s);
    record(s);
    save(s);
    printStats(s);
    break;

  case 'mix':
    mixStar(s);
    record(s);
    save(s);
    printStats(s);
    break;

  case 'history': {
    const n = Number(rest[0] ?? 10);
    const tail = s.history.slice(-n);
    console.log('age (Gyr)    L (L☉)    M (M☉)    X_core');
    for (const p of tail) {
      console.log(`${fmt(p.age / 1e9, 4).padEnd(12)} ${fmt(p.L).padEnd(9)} ${fmt(p.M).padEnd(9)} ${fmt(p.X)}`);
    }
    break;
  }

  case 'plot':
    plot(s);
    break;

  case 'stabilize': {
    // Hold T_earth at present-day value by removing helium ash from the core.
    // Invariant: L · M² = L₀ · M₀² (≈ 1 in solar units), since
    // T_eq ∝ L^¼ · √M when orbital adiabatic invariant a·M = const holds.
    // Each 0.1 Gyr, advance physics, then bisect for the ΔM_He that brings
    // L·M² back to target.
    const dtYears = 1e8;       // 0.1 Gyr increments
    const tolerance = 1e-4;    // L·M² convergence
    const maxAge = 30e9;
    const target = luminosity(s) * Math.pow(totalMass(s), 2);

    const cloneState = (st: State): State => ({ ...st, shells: st.shells.map(sh => ({ ...sh })) });

    console.log(`stabilizing T_earth from age ${fmt(s.age / 1e9, 3)} Gyr`);
    console.log(`target invariant L·M² = ${fmt(target, 5)}`);
    console.log('');
    console.log('age(Gyr)  ΔHe(M☉)   rate(M☉/Gyr)  M(M☉)   L(L☉)   T_eq(K) T_earth  L·M²');
    console.log('────────  ────────  ────────────  ──────  ──────  ───────  ───────  ──────');

    let stoppedReason = 'reached max age';
    while (s.age < maxAge && s.alive) {
      advance(s, dtYears);
      if (!s.alive) { stoppedReason = 'star died'; break; }

      const Lpre = luminosity(s);
      const Mpre = totalMass(s);
      const productPre = Lpre * Mpre * Mpre;

      let dM = 0;
      if (productPre > target) {
        const pool = coreHePool(s);
        if (pool < 1e-9) { stoppedReason = 'core He pool exhausted'; break; }
        // Test maximum extraction first; if even that's insufficient, bail.
        const probe = cloneState(s);
        const removed = extractHeAmount(probe, pool * 0.999);
        const productMin = luminosity(probe) * Math.pow(totalMass(probe), 2);
        if (productMin > target + tolerance) {
          stoppedReason = `extraction insufficient (min L·M² = ${fmt(productMin, 4)})`;
          break;
        }
        // Bisect dM ∈ [0, removed] to hit target.
        let lo = 0, hi = removed;
        for (let it = 0; it < 50; it++) {
          dM = 0.5 * (lo + hi);
          const trial = cloneState(s);
          extractHeAmount(trial, dM);
          const product = luminosity(trial) * Math.pow(totalMass(trial), 2);
          if (product > target) lo = dM; else hi = dM;
          if (Math.abs(product - target) < tolerance) break;
        }
        extractHeAmount(s, dM);
      }
      record(s);

      const M = totalMass(s);
      const L = luminosity(s);
      const Te = earthTemp(s);
      const aAU = earthDistance(s);
      const Teq = 254.6 * Math.pow(L, 0.25) / Math.sqrt(aAU);
      const product = L * M * M;
      const rate = dM / (dtYears / 1e9);

      console.log(
        `${fmt(s.age / 1e9, 3).padStart(8)}  ` +
        `${fmt(dM, 6).padStart(8)}  ` +
        `${fmt(rate, 6).padStart(12)}  ` +
        `${fmt(M).padStart(6)}  ` +
        `${fmt(L).padStart(6)}  ` +
        `${fmt(Teq, 1).padStart(7)}  ` +
        `${fmt(Te, 1).padStart(7)}  ` +
        `${fmt(product, 4).padStart(6)}`
      );
    }
    save(s);
    console.log('');
    console.log(`stopped: ${stoppedReason}`);
    console.log(`final age ${fmt(s.age / 1e9, 3)} Gyr, mass ${fmt(totalMass(s))} M☉`);
    break;
  }

  default:
    console.error(`unknown command: ${cmd}`);
    help();
    process.exit(1);
}
