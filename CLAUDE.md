# CLAUDE.md — Stellar Sandbox

Notes for future Claude sessions on this project. The README is for users;
this file is for you.

## What this is

Toy interactive solar evolution model. Originally a single self-contained
HTML file built by another model; refactored into a Vite + TypeScript project
with a Bun CLI driver. Started 2026-05-04.

## Stack

- **Frontend:** Vite + TypeScript, no framework. `<script type="module">`
  loads `src/main.ts`. The browser sandbox shows: SVG cross-section, live
  luminosity history canvas plot, stat readouts, intervention buttons.
- **CLI:** Bun runs `src/cli.ts` directly (no compile step). Persists state
  to `.state.json` so commands chain across invocations.
- **TypeScript:** strict, `moduleResolution: bundler`, `types: ["bun"]`.
  Imports use `.js` extensions (Vite/Bun resolve to `.ts` source).

## File map

```
index.html         markup + font links only — no inline JS or CSS
src/main.ts        entry, animation loop, sub-stepping cap
src/physics.ts     pure model — State, derived quantities, step, interventions
src/render.ts      SVG star + canvas plot, no DOM I/O outside this file
src/ui.ts          DOM stat updates, phase banner, button wiring (data-action)
src/cli.ts         Bun CLI — reads/writes .state.json
src/style.css
tsconfig.json
package.json       npm scripts: dev, build, typecheck. Bun script: cli.
.gitignore         excludes node_modules, dist, .state.json, bun.lock kept
stellar_sandbox.html.bak  original single-file prototype, kept for reference
```

## Physics model (current)

40-shell Lagrangian stellar interior, post-MS phenomenology layered on top,
plus a phase-2 Earth/climate module (orbit, equilibrium temperature with
greenhouse + water-vapor feedback, habitable zone) and a stabilization
control loop that holds Earth's climate constant via continuous-rate He
extraction.

### Main sequence physics

- 40 concentric mass shells, each `{ M_H, M_He, M_Z }`. Lagrangian — shell
  identity is preserved as masses change, so positions in m̃ are recomputed
  from cumulative mass each step (`profileFactors`).
- Temperature profile: `T(m̃) = T_c · (1 − m̃)^β` with `β = 2`. Concentrates
  burning in the inner shells.
- Central temperature: `T_c ∝ μ_central · M^0.3`. `μ_central` is **just
  shell 0's μ** — using a wider average flattens the evolution because the
  unchanging envelope dominates. Don't change this without retuning.
- Per-shell burning: `L_i = K · X_i² · T_i⁴ · m_i` (pp-chain X² and T⁴).
- `K_LUM` is a `let` calibrated at module load by fixed-point iteration to
  give L = 1 L☉ at age 4.57 Gyr. Iteration runs ~20 rounds, converges in 5-8.

### Post-MS phenomenology

Triggered by `inertCoreFraction(s)` exceeding `F_SC = 0.05`. The fraction is a
squared-depletion-weighted sum over contiguous inner shells, normalized by
**initial** mass M0:
`f = Σ (X0 − X_i)² · m_i / (X0² · M0)`. Squaring suppresses the mild
depletion of outer shells (so we measure deeply-burned-through inner mass,
not "anywhere helium has accumulated"). At ZAMS, f = 0; for a 1 M☉ Sun this
reaches 0.05 around real turnoff (~9-10 Gyr). M0 (not current M) in the
denominator: stripping envelope mass (mineH) shouldn't artificially trigger
post-MS evolution — the depletion fraction is a property of the core's
absolute state, independent of whether the envelope is intact.

Two multipliers, both exponential in `dx = max(0, f − F_SC)`, both capped:

- **α (T_c boost):** `min(ALPHA_MAX, 1 + ALPHA_A · expm1(ALPHA_K · dx))`.
  Drives the L climb. Hard cap at `ALPHA_MAX = 8` so peak L ≈ 2200 L☉.
- **β (radius boost):** same form. Hard cap at `BETA_MAX = 130` so RGB
  photosphere expands ~130× before T_eff hits the Hayashi floor.

`β` grows faster than `α` (`BETA_K > ALPHA_K`), so envelope expansion
outpaces the L climb and `T_eff` drops on the giant branch. Hayashi floor
clamps `T_eff ≥ 3200 K`.

### Interventions

- `addH(s, ΔM)` distributes hydrogen evenly over the outer half of shells.
- `mineH(s, ΔM)` peels mass off outermost-shell-first, H first then He.
- `extractHe(s)` zeroes He in inner `N_CORE` shells; mass leaves the system.
- `extractHeAmount(s, ΔM)` continuous-rate variant: removes up to ΔM of He
  from inner shells, working outward from shell 0. Returns amount actually
  removed (capped by `coreHePool(s)`). Used by `stabilize` CLI command.
- `mixStar(s)` redistributes composition to global average; shell masses
  unchanged.

All interventions revive `s.alive` if any shell now has burnable hydrogen.
Because `inertCoreFraction` is recomputed live, interventions feed straight
into α and β — `extract-he` on an RGB star drops `f` to ~0 and the model
reverts to MS instantly. This is the desired property.

## Earth / climate model (phase 2)

Single test particle around the Sun, no back-reaction on the star.

### Orbit

- `State` carries `M0` and `a0AU` reference values (1 M☉, 1 AU at ZAMS).
- `earthDistance(s) = a0 · M0 / M`. Adiabatic invariant for slow mass loss
  (`a · M = const`). Sudden mass loss isn't this, but our sim's mass changes
  are slow enough.
- `earthYear(s) = a^(3/2) / √M` from Kepler in solar units. Year length
  scales as `1/M²` since `a ∝ 1/M`.
- Earth's spin not modelled — solar tides on Earth are negligible vs lunar.

### Equilibrium temperature

`T_surf = T_eq · greenhouseFactor(T_eq)` where
`T_eq = T_REF · L^¼ / √a · albedoFactor`, with `T_REF = 254.6 K` (the bare
no-greenhouse equilibrium for L=1, a=1, A=0.3 — the textbook number).

Greenhouse uses the grey-atmosphere relation `(1 + 3τ/4)^¼` with two regimes:

- **Earth's actual atmosphere** (`greenhouseFactor`): τ = 0.84 base,
  ramps quadratically above present-day T_eq via water-vapor feedback.
  Calibrated so present-day Earth (L=1, a=1) reads exactly 288 K. ZAMS reads
  263 K — the Faint Young Sun paradox shows up honestly; resolution is
  early-Earth CO₂ which we don't model.
- **Hypothetical Earth-twin colder than present** (`greenhouseFactorOuter`):
  τ ramps *upward* below present-day T_eq, capped at `TAU_MAX_OUTER ≈ 3.6`,
  representing carbonate-silicate cycle accumulating CO₂ until clouds limit
  the greenhouse. Used **only** for `hzOuter` — Earth itself doesn't get
  this treatment because its atmosphere is what it is.

`earthClimate(s)` returns `frozen | cold | temperate | hot | boiling | engulfed`
on water-phase thresholds; UI renders a coloured chip.

### Habitable zone

`hzInner(s)` and `hzOuter(s)` find the orbital radii where `T_surf = 373 K`
and `T_surf = 273 K` respectively, by bisection in `tempAtDistance(L, a, useOuter)`.
Inner uses Earth's water-feedback greenhouse, outer uses the cold-side
CO₂-thickening greenhouse. At present Sun: 0.94 – 1.67 AU, matching
Kopparapu (2013) runaway-greenhouse and max-greenhouse limits.

### Stabilization control loop

`bun run cli stabilize` holds T_earth at the current value by extracting
He each step. Invariant is the closed form
`L · M² = L₀ M₀²` (because `T_eq ∝ L^¼ · √M` once `a · M = const`).

Per 0.1 Gyr step: advance physics, measure `L · M²`, bisect for the ΔM_He
that brings the product back to target, apply, repeat. Stops when:
- `coreHePool(s)` is exhausted, or
- Even maximum extraction can't reduce `L · M²` to target (depletion has
  migrated outside extractable inner shells), or
- The post-MS phenomenology fires hard enough that bisection thrashes.

For 1 M☉ initial conditions starting from age 4.57 Gyr, holds for ~9 Gyr
before failing — extracts ~0.025 M☉ of helium total, requires 0.001-0.006
M☉/Gyr extraction rate (rate jumps ~6× when post-MS multipliers kick in
around stellar age 10 Gyr).

### Public API (what UI/CLI consume)

```ts
// Stellar
createState, totalMass, X_core, Y_core, Z_core, X_env, Y_env, muCore,
luminosity, radius, surfaceT, remainingLifetime, inertCoreFraction,
evolutionaryPhase, step, addH, mineH, extractHe, extractHeAmount,
coreHePool, mixStar, reset, record,
// Earth / climate
earthDistance, earthYear, earthTemp, earthEngulfed, earthClimate,
hzInner, hzOuter, inHabitableZone
```

UI/CLI never touch shell internals directly.

## Tuning warnings

- **Don't crank `ALPHA_K` above ~30 with `F_SC < 0.05`.** Once `dx > 0.5` or
  so, the exponential grows past the cap so fast that one timestep can burn
  all H in a shell, propagating NaN into μ → infinite T_c → integrator blows
  up. The module-load calibration loop oscillates and the process hangs.
  Caps were added specifically because of this.
- **Calibration depends on f staying below F_SC at 4.57 Gyr.** With the
  current model and `F_SC = 0.05`, f at 4.57 Gyr ≈ 0.011, well below the
  threshold, so no boosts during the calibration window. If you change the
  `inertCoreFraction` definition or shrink F_SC, re-verify.
- **β = 2 is load-bearing for MS lifetime.** It's chosen so a single
  innermost shell has enough mass × T-share to burn for ~10 Gyr alone (see
  `TSUM4_ZAMS` arithmetic). Larger β concentrates burning further → faster
  central depletion → shorter MS.
- **`muCentral` uses shell 0 only.** Don't widen the average without
  retuning everything else; see physics notes above.

## Common tasks

### Add a CLI command

Add a `case` to the switch in `cli.ts`. The command pattern is: deserialise
state, mutate via a physics function, optionally `record(s)` for history,
serialise back, print stats. The `intervene` helper in `ui.ts` does the
same shape for the browser side.

### Add a new intervention

Implement in `physics.ts` (mutates `State`, no DOM/console). Wire to UI:
add a `<button data-action="...">` in `index.html` and a `case` in
`wireControls` in `ui.ts`. Wire to CLI: add a `case` in `cli.ts`.

### Re-tune post-MS coefficients

Use a temporary `scripts/track.ts` (gitignored — make a `scripts/` dir as
needed) that walks state forward in 1 Myr steps and prints L, T_eff, phase
at checkpoints. Aim for: turnoff ~9-10 Gyr, RGB tip L ≈ 2000-2500 at
T_eff ≈ 3200 K. Adjust `ALPHA_MAX` for peak L, `BETA_MAX` for peak R, ratio
of `ALPHA_K`/`BETA_K` for HR-track angle. Delete the script before
committing.

### Verify a change

```sh
npm run typecheck       # TS strict mode, must be clean
npm run build           # also typechecks via tsc as a build prerequisite
bun run cli init && bun run cli step 4.57G   # smoke test (T_earth = 288 K)
bun run cli stabilize   # exercises the full Earth + control loop path
```

Sanity numbers worth knowing:
- present Sun: L = 1.000, T_earth = 288 K [temperate], HZ 0.94 – 1.67 AU
- ZAMS: L = 0.701, T_earth = 263 K [frozen] (Faint Young Sun)
- `stabilize` from age 4.57 Gyr survives ~9 Gyr extension before failing

## What's NOT modelled

**Stellar:** CNO cycle, opacity, real EOS, gravitational settling, convective
mixing (beyond the `mix` intervention), shell-burning thermal pulses, He flash,
mass loss winds, structural relaxation after mass-change interventions,
rotation, magnetic fields.

**Earth-side:** atmosphere loss to solar wind, ice-albedo feedback (albedo
fixed at 0.3), tidal coupling between Earth and Sun (irrelevant outside late
RGB anyway), CO₂ depletion via the carbonate-silicate cycle, geodynamo decay
as Earth's core solidifies, ocean evaporation kinetics. The greenhouse
feedback is τ-based, not a real radiative-transfer calc — moist greenhouse
threshold is approximate.

Don't claim self-consistency that isn't there.

Other known limitations that surface only when interventions push the model
far from natural evolution (heavily mass-stripped stars, RGB-tip behaviour,
etc.) are documented in [docs/known-limitations.md](docs/known-limitations.md).
Read that file before designing experiments that mine large mass fractions,
study engulfment, or otherwise stress the model outside its calibrated regime.

## Future directions

### Phase 3 (proposed, not started): orbital migration

Add an `extractMass(s, ΔM)` or `migrateEarth(s, Δa)` intervention that
nudges `a0AU` upward independently of solar mass loss, representing
engineered migration via repeated asteroid gravitational assists
(Korycansky et al. 2001). Would let users compare "stabilize Sun + move
Earth outward" vs. "stabilize Sun alone" for total habitability time. Easy
to add — `a0AU` is already a State field, just needs a setter and UI/CLI
wiring.

### Other ideas considered, not pursued

- **Atmosphere module** for Earth (albedo, pressure, composition) — would let
  us model magnetosphere loss, atmospheric stripping, ice-albedo bistability.
  Big scope jump.
- **Retune post-MS phenomenology** to hit literature L_peak ≈ 2300 L☉ and
  enable RGB-tip engulfment. Needs raising `ALPHA_MAX`/`BETA_MAX` and
  re-running the K_LUM calibration. CLAUDE.md flags this as risky.
- **L1 magnetic shield** intervention or **biosphere/CO₂ depletion** model —
  both interesting but require modelling Earth's atmosphere or biosphere,
  which we currently abstract entirely.

## Original prompt history (one-liner)

User wanted to study how composition interventions affect L and lifetime. We
chose pure-frontend (no Python backend) because the math is light. Started
from a 2-zone homology model (overshot present-day L by 4×), moved to 40-shell
Lagrangian (calibration spot-on), then added phenomenological post-MS
phenomenology to capture the subgiant + RGB phases. Phase 2 (Earth orbit,
equilibrium temperature, water-vapor greenhouse, habitable zone, He-extraction
stabilization control loop) added 2026-05-04. Phase 3 future direction:
orbital migration as an additional intervention.
