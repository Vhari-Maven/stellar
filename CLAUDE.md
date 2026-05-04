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

40-shell Lagrangian, post-MS phenomenology layered on top.

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
squared-depletion-weighted sum over contiguous inner shells:
`f = Σ (X0 − X_i)² · m_i / (X0² · M)`. Squaring suppresses the mild
depletion of outer shells (so we measure deeply-burned-through inner mass,
not "anywhere helium has accumulated"). At ZAMS, f = 0; for a 1 M☉ Sun this
reaches 0.05 around real turnoff (~9-10 Gyr).

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
- `mixStar(s)` redistributes composition to global average; shell masses
  unchanged.

All interventions revive `s.alive` if any shell now has burnable hydrogen.
Because `inertCoreFraction` is recomputed live, interventions feed straight
into α and β — `extract-he` on an RGB star drops `f` to ~0 and the model
reverts to MS instantly. This is the desired property.

### Public API (what UI/CLI consume)

```ts
createState, totalMass, X_core, Y_core, Z_core, X_env, Y_env, muCore,
luminosity, radius, surfaceT, remainingLifetime, inertCoreFraction,
evolutionaryPhase, step, addH, mineH, extractHe, mixStar, reset, record
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
bun run cli init && bun run cli step 4.57G   # smoke test
```

## What's NOT modelled

CNO cycle, opacity, real EOS, gravitational settling, convective mixing
(beyond the `mix` intervention), shell-burning thermal pulses, He flash,
mass loss winds, structural relaxation after mass-change interventions,
rotation, magnetic fields. Don't claim self-consistency that isn't there.

## Original prompt history (one-liner)

User wanted to study how composition interventions affect L and lifetime. We
chose pure-frontend (no Python backend) because the math is light. Started
from a 2-zone homology model (overshot present-day L by 4×), moved to 40-shell
Lagrangian (calibration spot-on), then added phenomenological post-MS
phenomenology to capture the subgiant + RGB phases. Future direction
mentioned: planet temperatures from L and orbital distance — phase 2,
not yet implemented.
