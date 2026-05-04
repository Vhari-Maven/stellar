// Toy stellar evolution: multi-shell Lagrangian model.
//
// The star is N concentric mass shells. Each shell tracks its own (H, He, Z)
// composition by mass. A fixed temperature profile T(m̃) = T_c · (1 − m̃)^β
// determines where burning is hot. As inner shells exhaust hydrogen, burning
// migrates outward — that's the qualitative gain over the original 2-zone model.

export const N_SHELLS = 40;
export const BETA = 2.0;             // T-profile steepness; T ∝ (1 − m̃)^β
export const X0 = 0.71;
export const Y0 = 0.27;
export const Z0 = 0.02;
export const MU0 = 1 / (2 * X0 + 0.75 * Y0 + 0.5 * Z0);

// M☉ of H burned per year per L☉ via pp-chain (L = 0.007 c² · dM/dt).
export const BURN_CONST = 9.65e-12;

// Below this hydrogen fraction a shell stops contributing to burning.
const X_BURN_THRESHOLD = 0.005;

// "Core" = innermost CORE_BOUNDARY of mass, used only for the X_core / Y_core
// diagnostics that the UI displays. Has no dynamical role.
export const CORE_BOUNDARY = 0.20;
const N_CORE = Math.max(1, Math.round(N_SHELLS * CORE_BOUNDARY));

export interface Shell {
  M_H: number;
  M_He: number;
  M_Z: number;
}

export interface HistoryPoint {
  age: number;
  L: number;
  M: number;
  X: number;
}

export interface State {
  shells: Shell[];
  age: number;
  paused: boolean;
  yearsPerSecond: number;
  alive: boolean;
  history: HistoryPoint[];
  lastRecord: number;
}

function freshShells(): Shell[] {
  const dm = 1 / N_SHELLS;
  return Array.from({ length: N_SHELLS }, () => ({
    M_H:  X0 * dm,
    M_He: Y0 * dm,
    M_Z:  Z0 * dm,
  }));
}

export function createState(): State {
  return {
    shells: freshShells(),
    age: 0,
    paused: false,
    yearsPerSecond: 1e7,
    alive: true,
    history: [],
    lastRecord: 0,
  };
}

// ---- per-shell helpers ----

const shellMass = (sh: Shell) => sh.M_H + sh.M_He + sh.M_Z;
const shellX = (sh: Shell) => { const m = shellMass(sh); return m > 0 ? sh.M_H  / m : 0; };
const shellY = (sh: Shell) => { const m = shellMass(sh); return m > 0 ? sh.M_He / m : 0; };
const shellZ = (sh: Shell) => { const m = shellMass(sh); return m > 0 ? sh.M_Z  / m : 0; };

function shellMu(sh: Shell): number {
  const X = shellX(sh), Y = shellY(sh), Z = shellZ(sh);
  const denom = 2 * X + 0.75 * Y + 0.5 * Z;
  return denom > 0 ? 1 / denom : MU0;
}

// ---- bulk diagnostics (preserve original public API) ----

export const totalMass = (s: State): number =>
  s.shells.reduce((a, sh) => a + shellMass(sh), 0);

function bulkComp(shells: Shell[]): { X: number; Y: number; Z: number } {
  let H = 0, He = 0, Z = 0, M = 0;
  for (const sh of shells) {
    H += sh.M_H; He += sh.M_He; Z += sh.M_Z;
    M += shellMass(sh);
  }
  return M > 0 ? { X: H / M, Y: He / M, Z: Z / M } : { X: 0, Y: 0, Z: 0 };
}

const coreShells = (s: State) => s.shells.slice(0, N_CORE);
const envShells  = (s: State) => s.shells.slice(N_CORE);

export const X_core = (s: State) => bulkComp(coreShells(s)).X;
export const Y_core = (s: State) => bulkComp(coreShells(s)).Y;
export const Z_core = (s: State) => bulkComp(coreShells(s)).Z;
export const X_env  = (s: State) => bulkComp(envShells(s)).X;
export const Y_env  = (s: State) => bulkComp(envShells(s)).Y;

export function muCore(s: State): number {
  const { X, Y, Z } = bulkComp(coreShells(s));
  const denom = 2 * X + 0.75 * Y + 0.5 * Z;
  return denom > 0 ? 1 / denom : MU0;
}

// μ that drives T_c. Hydrostatic equilibrium ties T_c to μ at the centre, so
// we evaluate it at the innermost shell. Using a wider average (or μ over the
// whole star) damps the evolution: shell 0 fills with helium first and is
// what actually changes the central pressure-temperature balance.
function muCentral(s: State): number {
  return shellMu(s.shells[0]);
}

// ---- temperature profile and luminosity ----

// Compute T-profile factor (1 − m̃)^β at the *center* of each shell, using the
// shells' actual masses (Lagrangian coords adapt as mass changes).
function profileFactors(s: State): number[] {
  const M = totalMass(s);
  const out = new Array<number>(s.shells.length);
  if (M <= 0) return out.fill(0);
  let cum = 0;
  for (let i = 0; i < s.shells.length; i++) {
    const m = shellMass(s.shells[i]);
    const mTilde = (cum + m / 2) / M;
    out[i] = Math.pow(Math.max(0, 1 - mTilde), BETA);
    cum += m;
  }
  return out;
}

// Non-dim central temperature: T_c / T_c(Sol, ZAMS) = (μ_c/μ_c₀) · M^0.3
function tCentralNorm(s: State): number {
  return (muCentral(s) / MU0) * Math.pow(totalMass(s), 0.3);
}

// Calibrate K so L_total = 1 L☉ at the present Sun's age (4.57 Gyr) — that's
// what the canonical "1 L☉" actually refers to, not the zero-age main sequence.
// First set K to a preliminary value that gives L = 1 at ZAMS, then simulate
// forward 4.57 Gyr and rescale by the resulting L.
const TSUM4_ZAMS = (() => {
  let s = 0;
  for (let i = 0; i < N_SHELLS; i++) {
    const m = (i + 0.5) / N_SHELLS;
    s += Math.pow(Math.pow(1 - m, BETA), 4);
  }
  return s / N_SHELLS;
})();
let K_LUM = 1 / (X0 * X0 * TSUM4_ZAMS);

// Self-calibrate by fixed-point iteration: each pass simulates to 4.57 Gyr,
// measures L, and rescales K. Linear rescale alone won't converge because
// changing K changes how far the star evolves in 4.57 Gyr; iterating settles
// it within a few rounds.
K_LUM = (() => {
  const SOL_AGE = 4.57e9;
  const dt = 5e6;
  for (let iter = 0; iter < 20; iter++) {
    const s = createState();
    while (s.age < SOL_AGE) step(s, Math.min(dt, SOL_AGE - s.age));
    const L = luminosity(s);
    K_LUM = K_LUM / L;
    if (Math.abs(L - 1) < 1e-4) break;
  }
  return K_LUM;
})();

export function shellLuminosity(s: State, i: number, T_c?: number, tfrac?: number[]): number {
  const sh = s.shells[i];
  const X = shellX(sh);
  if (X < X_BURN_THRESHOLD) return 0;
  const Tc = T_c ?? tCentralNorm(s);
  const f = (tfrac ?? profileFactors(s))[i];
  const T = Tc * f;
  return K_LUM * X * X * Math.pow(T, 4) * shellMass(sh);
}

export function luminosity(s: State): number {
  if (!s.alive) return 0;
  const Tc = tCentralNorm(s);
  const tfrac = profileFactors(s);
  let L = 0;
  for (let i = 0; i < s.shells.length; i++) L += shellLuminosity(s, i, Tc, tfrac);
  return L;
}

export function surfaceT(s: State): number {
  const M = totalMass(s);
  if (M <= 0) return 0;
  const R = Math.pow(M, 0.7);
  const L = luminosity(s);
  if (L <= 0) return 2500;
  return 5778 * Math.pow(L / (R * R), 0.25);
}

// Rough estimate: total H weighted by current burning relevance, divided by
// current burn rate. Doesn't anticipate L's rise as burning migrates.
export function remainingLifetime(s: State): number {
  if (!s.alive) return 0;
  const L = luminosity(s);
  if (L <= 0) return Infinity;
  const tfrac = profileFactors(s);
  let fuel = 0;
  for (let i = 0; i < s.shells.length; i++) {
    const w = Math.pow(tfrac[i], 4); // burning is T⁴-weighted
    if (w > 1e-3) fuel += s.shells[i].M_H * w;
  }
  return fuel / (BURN_CONST * L) / 1e9;
}

// ---- evolution ----

export function step(s: State, dtYears: number): void {
  if (!s.alive) return;
  const Tc = tCentralNorm(s);
  const tfrac = profileFactors(s);
  let totalL = 0;
  for (let i = 0; i < s.shells.length; i++) {
    const sh = s.shells[i];
    const X = shellX(sh);
    if (X < X_BURN_THRESHOLD) continue;
    const T = Tc * tfrac[i];
    const Li = K_LUM * X * X * Math.pow(T, 4) * shellMass(sh);
    let burn = BURN_CONST * Li * dtYears;
    if (burn > sh.M_H) burn = sh.M_H;
    sh.M_H  -= burn;
    sh.M_He += burn;
    totalL += Li;
  }
  s.age += dtYears;
  if (totalL <= 0) s.alive = false;
}

// ---- interventions ----

export function addH(s: State, deltaM: number): void {
  // Distribute over outer half of shells (accreted onto envelope).
  const start = Math.floor(s.shells.length / 2);
  const n = s.shells.length - start;
  const per = deltaM / n;
  for (let i = start; i < s.shells.length; i++) s.shells[i].M_H += per;
}

export function mineH(s: State, deltaM: number): void {
  // Peel matter from the outermost shells inward, H first then He.
  let remaining = deltaM;
  for (let i = s.shells.length - 1; i >= 0 && remaining > 0; i--) {
    const sh = s.shells[i];
    const takeH = Math.min(remaining, sh.M_H);
    sh.M_H -= takeH; remaining -= takeH;
    if (remaining > 0) {
      const takeHe = Math.min(remaining, sh.M_He);
      sh.M_He -= takeHe; remaining -= takeHe;
    }
  }
}

export function extractHe(s: State): void {
  // Strip helium ash from the inner core shells. Mass leaves the system; the
  // remaining H+Z in those shells stays put (no automatic refill from envelope).
  for (let i = 0; i < N_CORE; i++) s.shells[i].M_He = 0;
  // If the central shell has burnable H again, the star can resume burning.
  if (shellX(s.shells[0]) > X_BURN_THRESHOLD) s.alive = true;
}

export function mixStar(s: State): void {
  // Full convection: redistribute composition to a global average. Each shell
  // keeps its current mass; only the H/He/Z fractions are equalized.
  const M = totalMass(s);
  if (M <= 0) return;
  let totH = 0, totHe = 0, totZ = 0;
  for (const sh of s.shells) { totH += sh.M_H; totHe += sh.M_He; totZ += sh.M_Z; }
  const X = totH / M, Y = totHe / M, Z = totZ / M;
  for (const sh of s.shells) {
    const m = shellMass(sh);
    sh.M_H  = X * m;
    sh.M_He = Y * m;
    sh.M_Z  = Z * m;
  }
  if (X > X_BURN_THRESHOLD) s.alive = true;
}

export function reset(s: State): void {
  s.shells = freshShells();
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
