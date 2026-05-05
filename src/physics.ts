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

// Schönberg-Chandrasekhar trigger on the squared-depletion f. At ZAMS f=0;
// for a Sun-like star this reaches ~0.05 near real turnoff (~10 Gyr).
const F_SC = 0.05;

// Phenomenological post-MS coefficients, tuned against published 1 M☉ tracks
// to land RGB tip near L≈2000 at T_eff≈3500 K, with a ~1-2 Gyr subgiant +
// RGB transition. β grows faster than α so the photosphere outpaces the L
// climb, dropping T_eff into Hayashi. Hard caps prevent numerical blow-up.
const ALPHA_A = 1.0;  const ALPHA_K = 14;  const ALPHA_MAX = 8.0;
const BETA_A  = 6.0;  const BETA_K  = 22;  const BETA_MAX  = 130;

// Hayashi limit on convective envelope: real cool giants don't go below this.
const T_HAYASHI = 3200;

// Earth: Bond albedo and reference equilibrium temperature at 1 AU around a
// 1 L☉ star with A = 0.3. Derived from T = ((1−A)·L☉ / (16π σ (1AU)²))^(1/4)
// ≈ 254.6 K. Greenhouse effect not modelled (real surface is ~288 K).
const EARTH_ALBEDO = 0.3;
const T_EQ_REF = 254.6;
// Grey-atmosphere greenhouse: T_surf = T_eq · (1 + 3τ/4)^(1/4). At present
// (T_eq = 254.6 K) τ = 0.84 calibrates Earth to 288 K. Above the present-day
// equilibrium temperature, water-vapor feedback ramps τ up quadratically —
// this gives a moist-greenhouse onset around L ≈ 1.1 (~1 Gyr from now) and
// runaway saturation by L ≈ 1.4, matching Kasting / Leconte estimates.
// τ keyed on T_eq (no-greenhouse temp) keeps the function explicit instead
// of needing a self-consistent solve.
const EARTH_TAU_BASE = 0.84;
const EARTH_TAU_MAX = 8.0;
const TAU_T_THRESHOLD = 254.6;   // K — present-day T_eq, where feedback starts
const TAU_SLOPE = 0.05;          // K⁻² coefficient on (T_eq − threshold)²

function greenhouseFactor(T_eq: number): number {
  const excess = Math.max(0, T_eq - TAU_T_THRESHOLD);
  const tau = Math.min(EARTH_TAU_MAX, EARTH_TAU_BASE + TAU_SLOPE * excess * excess);
  return Math.pow(1 + 0.75 * tau, 0.25);
}

// τ for a hypothetical Earth-twin colder than present: the carbonate-silicate
// cycle slows weathering, mantle outgassing accumulates atmospheric CO₂, and
// the column thickens until clouds cap the greenhouse. Used only for outer-
// edge HZ — Earth itself doesn't get this treatment because its atmosphere is
// what it is. Linear ramp in (T_thresh − T_eq), capped at TAU_MAX_OUTER ≈ 3.6
// chosen so present-Sun outer edge lands near Kopparapu's 1.67 AU max-CO₂.
const TAU_MAX_OUTER = 3.6;
const TAU_OUTER_SLOPE = 0.048;  // K⁻¹

function greenhouseFactorOuter(T_eq: number): number {
  const deficit = Math.max(0, TAU_T_THRESHOLD - T_eq);
  const tau = Math.min(TAU_MAX_OUTER, EARTH_TAU_BASE + TAU_OUTER_SLOPE * deficit);
  return Math.pow(1 + 0.75 * tau, 0.25);
}

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
  // Reference values captured at ZAMS so Earth's orbit can track mass loss
  // adiabatically: a · M = const. Both in solar units (M☉, AU).
  M0: number;
  a0AU: number;
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
    M0: 1,
    a0AU: 1,
  };
}

// ---- Earth (single test particle in Keplerian orbit) ----

// Adiabatic orbit expansion under slow mass loss: a · M = const, so as the
// Sun loses mass the orbit widens. Re-evaluated live from current totalMass.
export function earthDistance(s: State): number {
  const M = totalMass(s);
  const M0 = s.M0 ?? 1;
  const a0 = s.a0AU ?? 1;
  if (M <= 0) return Infinity;
  return a0 * M0 / M;
}

// Kepler's third law in solar units: T_yr = a^(3/2) / sqrt(M).
export function earthYear(s: State): number {
  const M = totalMass(s);
  if (M <= 0) return Infinity;
  return Math.pow(earthDistance(s), 1.5) / Math.sqrt(M);
}

// Equilibrium black-body temperature; ignores greenhouse, atmosphere,
// rotation/distribution. T = T_ref · L^(1/4) / sqrt(a/AU) for fixed albedo.
export function earthTemp(s: State): number {
  const L = luminosity(s);
  const a = earthDistance(s);
  if (L <= 0 || !isFinite(a) || a <= 0) return 2.7; // CMB floor
  const albedoFactor = Math.pow((1 - EARTH_ALBEDO) / (1 - 0.3), 0.25);
  const T_eq = T_EQ_REF * Math.pow(L, 0.25) / Math.sqrt(a) * albedoFactor;
  return T_eq * greenhouseFactor(T_eq);
}

// Convenience: is Earth inside the Sun's photosphere? R_sun in AU = R / 215.
export function earthEngulfed(s: State): boolean {
  return radius(s) / 215 >= earthDistance(s);
}

// Habitable zone: orbital distance range (in AU) where an Earth-twin's surface
// would lie between freezing (273 K) and boiling (373 K). Inner edge requires
// inverting the τ-feedback greenhouse, so we bisect; outer edge is closed-form
// because below the τ-ramp threshold the greenhouse factor is constant.
function tempAtDistance(L: number, aAU: number, useOuterGreenhouse = false): number {
  if (L <= 0 || aAU <= 0) return 2.7;
  const T_eq = T_EQ_REF * Math.pow(L, 0.25) / Math.sqrt(aAU);
  const g = useOuterGreenhouse ? greenhouseFactorOuter(T_eq) : greenhouseFactor(T_eq);
  return T_eq * g;
}

export function hzInner(s: State): number {
  const L = luminosity(s);
  if (L <= 0) return 0;
  // T_surf monotonically decreasing in a, so bisect a where T = 373.
  let lo = 0.01, hi = 100;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const T = tempAtDistance(L, mid);
    if (T > 373) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function hzOuter(s: State): number {
  const L = luminosity(s);
  if (L <= 0) return Infinity;
  // Use the cold-side greenhouse: cooler distances accumulate more CO₂ via
  // the carbonate-silicate cycle, capped at the maximum-greenhouse limit.
  // T_surf monotonically decreasing in a, so bisect.
  let lo = 0.01, hi = 1000;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const T = tempAtDistance(L, mid, true);
    if (T > 273) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function inHabitableZone(s: State): boolean {
  const a = earthDistance(s);
  return a >= hzInner(s) && a <= hzOuter(s);
}

// Climate band from equilibrium T. Thresholds chosen against water phase
// transitions on Earth-like atmosphere; note that with no greenhouse the
// present-day Sun puts Earth at 255 K → "frozen", which is the honest reading
// of the bare equilibrium model.
export type EarthClimate = 'engulfed' | 'boiling' | 'hot' | 'temperate' | 'cold' | 'frozen';
export function earthClimate(s: State): EarthClimate {
  if (earthEngulfed(s)) return 'engulfed';
  const T = earthTemp(s);
  if (T >= 373) return 'boiling';
  if (T >= 303) return 'hot';
  if (T >= 283) return 'temperate';
  if (T >= 273) return 'cold';
  return 'frozen';
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

// Effective helium-core mass fraction. Sums squared depletion over contiguous
// inner shells, suppressing the mild depletion of outer shells (so we measure
// "deeply burned-through inner region" rather than "anywhere helium has
// accumulated"). Squaring also responds non-linearly so the SC trigger fires
// crisply once central depletion is severe.
//
// Denominator is M0 (initial mass), not current total M. Otherwise envelope
// stripping (mineH) shrinks the denominator without changing the numerator —
// the loop breaks at the first un-depleted shell, so outer shells never
// contribute either way — and that would spuriously inflate f, prematurely
// firing the post-MS trigger. Using M0 keeps the trigger tied to the absolute
// state of the depleted inner core.
export function inertCoreFraction(s: State): number {
  if (s.M0 <= 0) return 0;
  let f = 0;
  for (const sh of s.shells) {
    const depl = (X0 - shellX(sh)) / X0;
    if (depl <= 0) break;
    f += depl * depl * shellMass(sh);
  }
  return f / s.M0;
}

// Post-MS multipliers. Both kick in only past the SC threshold so the main
// sequence is unaffected; once triggered, α boosts T_c (core contraction →
// hotter shell burning, positive feedback) and β expands the photosphere.
function postMSFactors(s: State): { tcBoost: number; radiusBoost: number } {
  const dx = Math.max(0, inertCoreFraction(s) - F_SC);
  if (dx === 0) return { tcBoost: 1, radiusBoost: 1 };
  return {
    tcBoost: Math.min(ALPHA_MAX, 1 + ALPHA_A * Math.expm1(ALPHA_K * dx)),
    radiusBoost: Math.min(BETA_MAX, 1 + BETA_A * Math.expm1(BETA_K * dx)),
  };
}

export function evolutionaryPhase(s: State): 'MS' | 'turnoff' | 'subgiant' | 'RGB' | 'exhausted' {
  if (!s.alive) return 'exhausted';
  const f = inertCoreFraction(s);
  if (f < 0.6 * F_SC) return 'MS';
  if (f < F_SC)       return 'turnoff';
  if (f < 2 * F_SC)   return 'subgiant';
  return 'RGB';
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

// Non-dim central temperature: T_c / T_c(Sol, ZAMS) = α · (μ_c/μ_c₀) · M^0.3.
// α is the post-MS contraction boost, ≡ 1 on the main sequence.
function tCentralNorm(s: State): number {
  const { tcBoost } = postMSFactors(s);
  return tcBoost * (muCentral(s) / MU0) * Math.pow(totalMass(s), 0.3);
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

export function radius(s: State): number {
  const M = totalMass(s);
  if (M <= 0) return 0;
  const { radiusBoost } = postMSFactors(s);
  return Math.pow(M, 0.7) * radiusBoost;
}

export function surfaceT(s: State): number {
  const R = radius(s);
  if (R <= 0) return 0;
  const L = luminosity(s);
  if (L <= 0) return 2500;
  const T = 5778 * Math.pow(L / (R * R), 0.25);
  return Math.max(T_HAYASHI, T);
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

// Continuous-rate variant of extractHe: removes up to dM of He from the inner
// core shells, working from shell 0 outward. Returns the amount actually
// removed (capped by total He available in the inner N_CORE shells).
export function extractHeAmount(s: State, dM: number): number {
  if (dM <= 0) return 0;
  let remaining = dM;
  let removed = 0;
  for (let i = 0; i < N_CORE && remaining > 0; i++) {
    const take = Math.min(remaining, s.shells[i].M_He);
    s.shells[i].M_He -= take;
    remaining -= take;
    removed += take;
  }
  if (shellX(s.shells[0]) > X_BURN_THRESHOLD) s.alive = true;
  return removed;
}

// Total He mass in the inner N_CORE shells — the pool extractHeAmount can draw from.
export function coreHePool(s: State): number {
  let H = 0;
  for (let i = 0; i < N_CORE; i++) H += s.shells[i].M_He;
  return H;
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
