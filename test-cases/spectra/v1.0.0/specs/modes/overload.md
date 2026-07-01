# Spectra — Overload mode

This file defines the **Overload** mode, which sits alongside the standard Sortie
mode. It builds on the standard mode in `specs/modes/standard.md` and overrides
**one** rule from `specs/polarity.md` — what a mismatched shot does; everything
else is unchanged.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `OVERLOAD`

Place it after `LAUNCH` and before `HOW TO PLAY`.

## Mode

- **Overload** — the same defense as Sortie, but **mismatched shots are no longer
  harmless**. A wrong-band shot now **feeds** the drone it hits, charging it toward
  an **overload** that makes it more dangerous. You can no longer spray the swarm
  and ignore your band — every shot must match, or you are arming the enemy.

**Override (mismatched shots).** Replace the "mismatch is wasted" rule in
`specs/polarity.md` with the following. Each drone carries a **charge** counter,
starting at `0`:

- A **matching** shot still **destroys** the drone (or its exposed layer, for the
  Prism) exactly as in `specs/polarity.md`.
- A **mismatched** shot — opposite the drone's current band — no longer does
  nothing. It **adds `1` charge** to that drone (and is consumed). When a drone's
  charge reaches **`3`**, it **overloads**: it performs its overload reaction
  (below) and its charge **resets to `0`** (it can overload again).

A Flux struck during its **shimmer** (`specs/enemies.md`) takes no effect at
all — it has no band to mismatch, so neither destroyed nor charged. The dual-use
shield, the resonance meter, the discharge, and every other rule are unchanged;
only what a mismatched **offensive** shot does is different.

## Overload reactions

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

Everything else is exactly as in Sortie (`specs/modes/standard.md`): the two
bands and matching kills, the dual-use shield, the resonance meter and discharge,
all three drones and the Prism's spectral inversion, and the stages, challenge
stages, scoring, lives, and stage scaling. Only what a **mismatched shot** does
changes.
