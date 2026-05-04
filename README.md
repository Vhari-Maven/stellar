# Stellar Sandbox

A toy model of solar evolution. Multi-shell stellar physics in the browser plus
a CLI driver, intended for exploring "what if" scenarios — adding hydrogen,
mining the surface, extracting helium ash from the core — and watching the
star's response in luminosity, temperature, and lifetime.

This is a **phenomenological toy**, not a stellar evolution code. Real
evolution codes (MESA et al.) solve the full coupled hydrostatic and energy
transport equations across thousands of mass shells with realistic opacities
and equations of state. This project uses 40 shells and curve-fit
post-main-sequence multipliers tuned against published 1 M☉ tracks. The
qualitative response to interventions is what comes through cleanly.

## Setup

```sh
npm install
```

Requires Node ≥ 20 (for Vite) and Bun ≥ 1.1 (for the CLI).

## Browser sandbox

```sh
npm run dev
```

Opens an interactive UI: cross-section visualisation of the star (with
contracting helium ash core and expanding envelope on the RGB), live
luminosity history plot, intervention buttons, and a phase-aware status banner
(MS / turnoff / subgiant / RGB / exhausted).

```sh
npm run build       # typecheck + production bundle to dist/
npm run typecheck   # tsc --noEmit
```

## CLI

The same physics, driven from a shell. State persists in `.state.json`
(gitignored), so commands compose across invocations.

```sh
bun run cli init                # reset to ZAMS
bun run cli stats               # show current state
bun run cli step 4.57G          # advance 4.57 Gyr (also accepts 100M, 1e8, etc.)
bun run cli add-h 0.1           # add 0.1 M☉ of hydrogen to the envelope
bun run cli mine-h 0.05         # mine 0.05 M☉ from the surface
bun run cli extract-he          # strip helium ash from the inner core
bun run cli mix                 # full convective mixing
bun run cli plot                # ASCII luminosity-vs-age plot
bun run cli history 20          # last 20 history points
bun run cli reset               # alias for init
bun run cli help
```

### Example: faint young Sun → present → RGB tip

```sh
bun run cli init
bun run cli step 4.57G   # L≈1.00, T_eff≈5778 K — present-day Sun
bun run cli step 5.7G    # L≈2200, T_eff=3200 K — RGB tip (~10.3 Gyr total)
```

### Example: rejuvenating a red giant

```sh
bun run cli init
bun run cli step 10.3G   # RGB, L≈2000, T_eff=3200 K
bun run cli extract-he   # strips He ash from inert core
bun run cli stats        # phase reverts to MS, L drops, mass reduced
```

## Files

```
index.html          markup + font links only
src/main.ts         entry, animation loop
src/physics.ts      multi-shell model — pure functions, no DOM
src/render.ts       SVG cross-section + canvas plot
src/ui.ts           stat readouts, phase banner, button wiring
src/cli.ts          Bun CLI driver
src/style.css       styles
```

## Physics in one paragraph

The star is 40 concentric mass shells (Lagrangian coordinates), each tracking
its own H/He/Z composition. A fixed temperature profile `T(m̃) = T_c · (1 − m̃)²`
puts most burning near the centre; `T_c` scales as `μ_central · M^0.3` from
hydrostatic equilibrium, evaluated at the innermost shell. Each shell burns
hydrogen to helium at a rate proportional to `X² · T⁴ · m_shell` (pp-chain
temperature dependence). The luminosity calibration constant is tuned at
module load so present-day Sun (4.57 Gyr) lands at exactly 1 L☉ — this
auto-recovers the faint-young-Sun value of ~0.7 L☉ at ZAMS. Past the
Schönberg-Chandrasekhar threshold (squared-depletion-weighted core fraction
> 0.05), two phenomenological multipliers fire: α boosts T_c (core
contraction → hotter shell burning, drives positive feedback to true central
exhaustion) and β expands the photosphere (mirror principle, drops T_eff
toward the Hayashi limit at 3200 K). Coefficients are tuned against published
1 M☉ tracks: turnoff at ~9 Gyr, RGB tip at L≈2200 L☉ and T_eff=3200 K.

What this toy ignores: convection zones, opacity, equation of state effects,
gravitational settling, the CNO cycle, real shell-burning energetics, He
flash, and any structural response to mass loss. So interventions move the
star around in a way that's qualitatively right but isn't a self-consistent
stellar evolution code.
