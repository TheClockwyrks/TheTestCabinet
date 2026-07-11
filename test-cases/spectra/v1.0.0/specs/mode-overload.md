# Spectra — Sortie and Overload

This file defines the game's two modes and their main-menu entries. It builds on
the stage in `specs/playfield.md`, polarity in `specs/polarity.md`, the controls
in `specs/controls.md`, the drones in `specs/enemies.md`, and the wave flow in
`specs/flow.md`.

## Menu entries

This file adds the following entries to the main menu (see Game states in
`specs/flow.md`), in this order, before `HOW TO PLAY`:

- `LAUNCH` — starts the standard **Sortie** mode (below).
- `OVERLOAD` — starts the **Overload** mode (below).

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Sortie

- **Sortie** — the single-ship defense. You pilot the resonator-fighter against
  wave after wave of the drone swarm, flipping bands to match what you fire at and
  to shield what fires at you, clearing each stage and pressing into faster,
  deeper stages until your last life is lost.

Sortie uses every system exactly as the common specs define it, with no overrides:

- the **two bands** and the **match-to-destroy** rule from `specs/polarity.md`,
  with a **mismatched** shot — one opposite the drone's current band —
  **wasted**: it is absorbed and the bullet consumed, dealing no damage and
  having no other effect (you cannot harm a drone of the band you are not tuned
  to);
- the **dual-use shield** and the **resonance meter and discharge** from
  `specs/polarity.md`;
- the movement, firing, and flip controls from `specs/controls.md`;
- the full set of three drones — the Shard, the Flux, and the Prism, including the
  Prism's spectral inversion — from `specs/enemies.md`;
- the stages, challenge stages, scoring, lives, and stage scaling from
  `specs/flow.md`.

## Overload

- **Overload** — the same defense as Sortie, but **mismatched shots are no longer
  harmless**. A wrong-band shot now **feeds** the drone it hits, charging it toward
  an **overload** that makes it more dangerous. You can no longer spray the swarm
  and ignore your band — every shot must match, or you are arming the enemy.

**Overload changes one rule (mismatched shots).** In Overload, the "mismatch is
wasted" behavior of Sortie is replaced with the following. Each drone carries a
**charge** counter, starting at `0`:

- A **matching** shot still **destroys** the drone (or its exposed layer, for the
  Prism) exactly as in `specs/polarity.md`.
- A **mismatched** shot — opposite the drone's current band — no longer does
  nothing. It **adds `1` charge** to that drone (and is consumed). When a drone's
  charge reaches **`3`**, it **overloads**: it performs its overload reaction
  (below) and its charge **resets to `0`** (it can overload again).

A Flux struck during its **shimmer** (`specs/enemies.md`) takes no effect at
all — it has no band to mismatch, so it is neither destroyed nor charged. The
dual-use shield, the resonance meter, the discharge, and every other rule are
unchanged; only what a mismatched **offensive** shot does is different.

### Overload reactions

Each drone overloads in a way true to its identity:

- **Shard.** It immediately **launches a headlong dive** — peeling out of
  formation (or redirecting a dive) into a fast, straight plunge down the field
  toward the player's current `x`, faster than a normal dive. Feeding a Shard the
  wrong band sends it at you.
- **Flux.** It immediately **flips its band** (ending any held window or shimmer)
  and **fires a spread** of **three** bullets, fanned downward, in its **new**
  band, then resumes its cycle. Wrong shots make it lash out and re-tune.
- **Prism.** The **exposed layer** overloads: it **emits a two-shot burst** (one
  cyan and one magenta), and — if the **shell** is the exposed layer — the Prism
  **spawns one extra Shard escort** (of a random band) alongside it. Feeding a
  Prism the wrong band on its shell only grows the swarm around it.

Everything else in Overload is exactly as in Sortie: the two bands and matching
kills, the dual-use shield, the resonance meter and discharge, all three drones
and the Prism's spectral inversion, and the stages, challenge stages, scoring,
lives, and stage scaling. Only what a **mismatched shot** does changes.
