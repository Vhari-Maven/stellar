# Known model limitations

Issues we've found while stress-testing the sim. None of these affect the
calibrated regime (a 1 M☉ star evolving naturally from ZAMS through ~RGB) —
they all surface when interventions push the star far from its natural state.

## Heavily mass-stripped stars behave wrong (mineH at scale)

**Symptom.** When the `stabilize`-style control loop uses `mineH` instead of
`extractHe`, the loop can remove ~60% of the star's mass (~0.6 M☉) before
hitting its control wall. Once mining stops, L collapses by ~170× over
~10 Gyr (e.g. 6.86 → 0.04 L☉) while the star remains "alive" in the model's
sense. Earth freezes (T_E ≈ 81 K) on a now-fixed 2.6 AU orbit.

**Root cause.** The shell-temperature profile is normalized by *current*
total mass, not initial mass. From `profileFactors` in `src/physics.ts`:

```ts
const mTilde = (cum + m / 2) / M;       // <-- M is current totalMass(s)
out[i] = Math.pow(Math.max(0, 1 - mTilde), BETA);
```

When mining strips outer shells (zeroing their masses), the surviving 15-ish
shells get re-spread across the full `m̃ ∈ [0, 1]` range. A shell that was
originally at m̃ ≈ 0.34 (warm, H-rich, mid-interior) now sits at m̃ ≈ 0.88
(near the photosphere) with `(1 − m̃)²` collapsed by ~30×. T at that shell
drops by the same factor, so T⁴ drops ~10⁶×, and burning shuts off there
even though the shell still holds plenty of hydrogen.

The result is a pathological geometry where:

- the *innermost* surviving shells are hot (post-MS α-boost saturates T_c at
  8× nominal) but have no H left to burn (X ≈ 0.005);
- the *outermost* surviving shells still hold X ≈ 0.6 of hydrogen but sit at
  near-photospheric temperatures and don't fuse;
- a thin "engine" of mid-shells in between briefly bridges the gap, then
  exhausts its H over a few Gyr and dies from the inside out.

The star ends up with L ~ 0.04 L☉ and ~0.4 M☉ of mostly-He inert mass that
in reality would have either compressed into a hot helium-core remnant or
collapsed onto the burning shell. Our model has no machinery for either.

**How to reproduce.**

```sh
# Modify scripts/trace.ts (gitignored) to apply mineH each step:
#   bisect dM ∈ [0, M·0.5] to bring L·M² to target, apply mineH(s, dM)
# Run forward from age 4.57 Gyr in 0.1 Gyr increments.
# At ~11.5 Gyr the loop hits its wall; M ≈ 0.382, L ≈ 6.9.
# Continue evolving without intervention; observe L collapse.
```

(See conversation 2026-05-05 for the full trace.)

**Why it's wrong physically.** A real star losing 60% of its mass would
contract into a different hydrostatic equilibrium with a correspondingly
restructured T-profile. It might expose a hot He-core surface (subdwarf or
white-dwarf-like), or shell H-burning around an inert core could continue to
power the star until that inner H ran out. Our model does neither — it just
treats the survivor set as if it *were* the whole star, with the same
homology relation T_c ∝ μ·M^0.3 and the same `(1 − m̃)^β` profile shape.

**Fixes worth considering.**

1. **Normalize `m̃` by `s.M0` instead of `M`.** Cheapest fix: keeps the
   T-profile geometry pinned to the original star regardless of mining.
   Surviving shells stay at their original m̃ positions, surviving outer
   shells stay cold (correct), but at least the surviving inner shells stay
   warm (currently they unphysically cool when m̃ renormalizes upward, even
   though here they actually *do* stay warm — the issue is at the outer end).
   Probably needs the BETA exponent re-tuned.

2. **Cap `mineH` at the convective envelope mass.** Don't let it eat past
   the convective boundary; below that, mass loss requires structural
   collapse we don't model. Fixes the worst pathology by refusing to enter
   it.

3. **Add a "remnant" mode.** When M < some threshold (say 0.5 M☉), switch
   the burning model from "shell-by-shell sum" to a simpler core-burn or
   shell-burn analytical form. Conceptually right, but a meaningful chunk of
   work.

4. **Just refuse the experiment.** Document that `mineH` is intended for
   small (~few %) envelope perturbations and have the CLI/UI warn when the
   cumulative mined mass crosses ~10% of M0. Cheapest of all but limits the
   sandbox's exploratory value.

The L·M² stabilization control loop using `mineH` is the most natural way
to surface this — `extractHe` doesn't trigger it because He extraction
doesn't shift the m̃ distribution (the inner shells are unchanged in mass
when only their He is removed; well, mostly — `extractHeAmount` does reduce
shell mass, but only modestly compared to mineH). Worth verifying that the
He-extraction stabilize loop doesn't also drift into pathological territory
at very long times.

## RGB-tip luminosity and radius are under-tuned (no engulfment)

**Symptom.** Under natural evolution from ZAMS, a 1 M☉ star in this model
peaks at L ≈ 5 L☉ near the RGB tip — vs. literature ~2300 L☉. Photospheric
radius peaks at ~130 R☉ ≈ 0.6 AU, so Earth is never engulfed. Real
expectation is the Sun's photosphere reaches or exceeds 1 AU at RGB tip.

**Root cause.** The post-MS multipliers are deliberately capped:

```ts
const ALPHA_A = 1.0;  const ALPHA_K = 14;  const ALPHA_MAX = 8.0;
const BETA_A  = 6.0;  const BETA_K  = 22;  const BETA_MAX  = 130;
```

`ALPHA_MAX = 8` caps the T_c boost so peak L ≈ 5 L☉. `BETA_MAX = 130` caps
the photosphere expansion so peak R ≈ 130 R☉. Both caps were added to
prevent the K_LUM module-load calibration loop from blowing up — see the
"Tuning warnings" section of `CLAUDE.md`. Without them, `dx > 0.5` could
push the exponential past the cap so fast that one timestep burned all H
in a shell, propagating NaN through μ → infinite T_c → integrator hang.

**Fix worth considering.** Raise `ALPHA_MAX` and `BETA_MAX` toward
literature values (peak L ~2000 L☉, peak R ~250 R☉ for engulfment), then
add a CFL-style sub-stepping guard so the integrator can't burn more than
some fraction of a shell's H per step regardless of how high T_c got. This
would let the calibration loop converge without needing the caps as a
safety mechanism. Probably a couple-day project including re-running the
4.57 Gyr / L = 1 calibration verification.

A retuning pass would also make engulfment scenarios meaningful (currently
the model can't produce one) and would be a prerequisite for any future
"Earth's fate at RGB tip" study.

## Other things to check (not yet investigated)

- **Earth orbital adiabatic invariant.** `a · M = const` assumes mass loss
  is slow on the orbital timescale. The mineH-with-stabilize scenario can
  remove ~0.04 M☉ in 0.1 Gyr near the end of phase 2 — that's ~4×10⁻¹⁰ M☉
  per orbital period, which is plenty slow, but worth confirming the
  approximation doesn't break elsewhere.

- **Post-MS phenomenology + mining interaction.** The α and β multipliers
  assume the star is structurally intact. Once we've stripped 60% of the
  mass, applying an 8× T_c boost on a 0.4 M☉ remnant is questionable. The
  phenomenology was tuned to natural 1 M☉ evolution.

- **`addH` then evolve.** Untested whether dumping fresh H into the
  envelope (the `add-h` intervention) and continuing evolution behaves
  sensibly. The H lands in shells that may not burn; should verify.
