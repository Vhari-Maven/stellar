// Toy stellar evolution model.
// Two-zone (core / envelope), homology scaling for L, pp-chain mass-energy
// conversion for the burning rate.

export const CORE_FRAC = 0.20;
export const X0 = 0.71;
export const Y0 = 0.27;
export const Z0 = 0.02;
export const MU0 = 1 / (2 * X0 + 0.75 * Y0 + 0.5 * Z0);

// M☉ of H burned per year per L☉ via pp-chain (L = 0.007 c² · dM/dt)
export const BURN_CONST = 9.65e-12;

// Core hydrogen fraction at which the main sequence ends.
const X_MS_END = 0.05;

export interface HistoryPoint {
  age: number;
  L: number;
  M: number;
  X: number;
}

export interface State {
  M_H_core: number;
  M_He_core: number;
  M_Z_core: number;
  M_H_env: number;
  M_He_env: number;
  M_Z_env: number;
  age: number;
  paused: boolean;
  yearsPerSecond: number;
  alive: boolean;
  history: HistoryPoint[];
  lastRecord: number;
}

const INITIAL_COMP = {
  M_H_core:  X0 * CORE_FRAC,
  M_He_core: Y0 * CORE_FRAC,
  M_Z_core:  Z0 * CORE_FRAC,
  M_H_env:   X0 * (1 - CORE_FRAC),
  M_He_env:  Y0 * (1 - CORE_FRAC),
  M_Z_env:   Z0 * (1 - CORE_FRAC),
} as const;

export function createState(): State {
  return {
    ...INITIAL_COMP,
    age: 0,
    paused: false,
    yearsPerSecond: 1e7,
    alive: true,
    history: [],
    lastRecord: 0,
  };
}

// ---- derived quantities ----

export const coreMass  = (s: State) => s.M_H_core + s.M_He_core + s.M_Z_core;
export const envMass   = (s: State) => s.M_H_env  + s.M_He_env  + s.M_Z_env;
export const totalMass = (s: State) => coreMass(s) + envMass(s);

export const X_core = (s: State) => { const m = coreMass(s); return m > 0 ? s.M_H_core  / m : 0; };
export const Y_core = (s: State) => { const m = coreMass(s); return m > 0 ? s.M_He_core / m : 0; };
export const Z_core = (s: State) => { const m = coreMass(s); return m > 0 ? s.M_Z_core  / m : 0; };
export const X_env  = (s: State) => { const m = envMass(s);  return m > 0 ? s.M_H_env   / m : 0; };
export const Y_env  = (s: State) => { const m = envMass(s);  return m > 0 ? s.M_He_env  / m : 0; };

export function muCore(s: State): number {
  const X = X_core(s), Y = Y_core(s), Z = Z_core(s);
  const denom = 2 * X + 0.75 * Y + 0.5 * Z;
  return denom > 0 ? 1 / denom : MU0;
}

export function luminosity(s: State): number {
  const M = totalMass(s);
  if (M <= 0 || !s.alive) return 0;
  const muRatio = muCore(s) / MU0;
  return Math.pow(M, 3.5) * Math.pow(muRatio, 4);
}

export function surfaceT(s: State): number {
  const M = totalMass(s);
  if (M <= 0) return 0;
  const R = Math.pow(M, 0.7);
  const L = luminosity(s);
  if (L <= 0) return 2500;
  return 5778 * Math.pow(L / (R * R), 0.25);
}

export function remainingLifetime(s: State): number {
  if (!s.alive) return 0;
  const L = luminosity(s);
  if (L <= 0) return Infinity;
  const fuel = Math.max(0, s.M_H_core - X_MS_END * coreMass(s));
  return fuel / (BURN_CONST * L) / 1e9; // Gyr
}

// ---- evolution ----

export function step(s: State, dtYears: number): void {
  if (!s.alive) return;
  const L = luminosity(s);
  if (L <= 0) { s.alive = false; return; }
  let burn = BURN_CONST * L * dtYears;

  const minH = X_MS_END * coreMass(s);
  if (s.M_H_core - burn < minH) {
    burn = Math.max(0, s.M_H_core - minH);
    s.alive = false;
  }

  s.M_H_core  -= burn;
  s.M_He_core += burn;
  s.age       += dtYears;
}

// ---- interventions ----

export function addH(s: State, deltaM: number): void {
  s.M_H_env += deltaM;
}

export function mineH(s: State, deltaM: number): void {
  const remove = Math.min(deltaM, s.M_H_env);
  s.M_H_env -= remove;
  const leftover = deltaM - remove;
  if (leftover > 0) {
    s.M_He_env -= Math.min(leftover, s.M_He_env);
  }
}

export function extractHe(s: State): void {
  s.M_He_core = 0;
  const targetCore = CORE_FRAC * totalMass(s);
  const deficit = targetCore - coreMass(s);
  const eMass = envMass(s);
  if (deficit > 0 && eMass > 0) {
    const transfer = Math.min(deficit, eMass);
    const fH = X_env(s), fHe = Y_env(s);
    const fZ = Math.max(0, 1 - fH - fHe);
    s.M_H_core  += fH  * transfer;
    s.M_He_core += fHe * transfer;
    s.M_Z_core  += fZ  * transfer;
    s.M_H_env   -= fH  * transfer;
    s.M_He_env  -= fHe * transfer;
    s.M_Z_env   -= fZ  * transfer;
  }
  if (s.M_H_core > X_MS_END * coreMass(s)) s.alive = true;
}

export function mixStar(s: State): void {
  const totH  = s.M_H_core  + s.M_H_env;
  const totHe = s.M_He_core + s.M_He_env;
  const totZ  = s.M_Z_core  + s.M_Z_env;
  const totM  = totH + totHe + totZ;
  if (totM <= 0) return;
  const X = totH / totM, Y = totHe / totM, Z = totZ / totM;
  const Mc = totM * CORE_FRAC, Me = totM * (1 - CORE_FRAC);
  s.M_H_core  = X * Mc;  s.M_He_core = Y * Mc;  s.M_Z_core = Z * Mc;
  s.M_H_env   = X * Me;  s.M_He_env  = Y * Me;  s.M_Z_env  = Z * Me;
  if (X > X_MS_END) s.alive = true;
}

export function reset(s: State): void {
  Object.assign(s, INITIAL_COMP);
  s.age = 0;
  s.alive = true;
  s.history = [];
  s.lastRecord = 0;
}

export function record(s: State): void {
  s.history.push({
    age: s.age,
    L: luminosity(s),
    M: totalMass(s),
    X: X_core(s),
  });
  if (s.history.length > 1200) s.history.shift();
}
