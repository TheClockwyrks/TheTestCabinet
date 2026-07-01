# Fathom — Reserve mode

This file defines the **Reserve** mode, which sits alongside the standard Trench
mode. It builds on the standard mode in `specs/modes/standard.md` and overrides
the ink rule from `specs/movement.md`; everything else is unchanged.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `RESERVE`

Place it after `DIVE` and before `HOW TO PLAY`.

## Mode

- **Reserve** — the same dive as Trench, but ink is no longer a recharging
  cooldown: it is a **limited reserve of charges** you must replenish by finding
  **ink-glands** in the maze. Ink becomes a resource to ration, not a button to
  mash.

**Override (ink).** In Reserve, replace the cooldown-based ink in
`specs/movement.md` with charges:

- You hold up to **3** ink charges and **start each trench with 2**. Each ink
  release spends **one** charge and produces the same cloud as in
  `specs/movement.md` (same radius, duration, and blinding effect on the Lure and
  Flarefish; still no effect on the Listener). There is no cooldown beyond a brief
  `1 s` lockout to prevent a double-trigger; with no charges, ink cannot be
  released.
- **Ink-glands.** Four glowing **ink-glands** are placed in the maze, symmetric
  left-to-right (`specs/playfield.md`), distinct from plankton. Eating a gland
  restores **one** ink charge (up to the max of 3). A consumed gland **reappears
  about `20 s` later** at the same spot, so ink is renewable but scarce — you
  detour for glands the way you weigh every other risk. Glands are subject to the
  same fog of war as everything else (`specs/sensing.md`); eating a gland does not
  count as a plankton and is not required to clear the trench.

**HUD.** The ink readiness indicator (`specs/playfield.md`) shows the **number of
charges held** (0-3) in Reserve, rather than a cooldown gauge.

Everything else is exactly as in Trench (`specs/modes/standard.md`): the fog,
line-of-sight light, omni sonar, brightness, all three predators, and the scoring,
lives, and depth scaling. Only ink changes.

The mode label shown in the HUD during a Reserve dive is `RESERVE`.
