# Modes — Standard and Hardcore

This file defines the two **modes** a player chooses before an expedition, and the
**mode-select** menu that leads into them. It builds on the miner's death conditions
(`specs/character.md`: out of fuel, hull destroyed, and the Core Sample detonation of
`specs/hazards.md`), the cargo and materials (`specs/mining.md`), and the states and
menus (`specs/flow.md`).

There is exactly **one campaign** and **one balance**. The mode changes **only what
happens when the miner dies** — nothing else. The world generation, the ore values,
the fuel and hull numbers, the upgrade prices, the rocket costs, the hazards, and the
scanner all work identically in both modes. The numeric values elsewhere are fixed;
the mode is purely the **death rule**.

## The menu flow

The title menu's play action is a single **NEW EXPEDITION** entry (followed by
`HOW TO PLAY`; see Game states in `specs/flow.md`). Choosing it does not start a game
directly — it opens the **mode select** menu. From there:

- Choosing **Standard** or **Hardcore** starts a fresh expedition in that mode.
- A **BACK** choice returns to the title menu.

The mode-select menu must show each mode with a clear, readable description of its
death rule (below) so the player understands the stakes before choosing, and must
offer a way back to the title menu.

## What a "death" is

A **death** is any of: running **out of fuel** underground, **hull reaching 0**, or
the **Core Sample detonating** when its timer expires (`specs/character.md`,
`specs/hazards.md`). All three are handled by the mode's death rule below. In **both**
modes, a death **destroys the Core Sample** if the miner was carrying it
(`specs/mining.md`, `specs/hazards.md`) — the Core Sample never survives a death — and
**leaves every already-installed rocket component installed** (`specs/rocket.md`): the
rocket checklist is durable progress that no death undoes.

## Standard

The forgiving mode, modeled on Minecraft / Terraria's normal death: **you lose the
trip, not the run.**

- On death, the miner **drops the cargo it was carrying** (all unsold ore) and **any
  uninstalled exotic materials** in the satchel (Resonite / Cryenite — but **not** the
  Core Sample, which is destroyed) as a **retrievable cache** at the death site,
  marked so the player can find it again.
- The miner **respawns at the surface** with **full fuel and repaired hull**, keeping
  all banked **Credits**, all **upgrade tiers**, and all **installed rocket components**.
- To recover the dropped haul, the player **descends to the cache and collects it** —
  a real risk (the cache may sit in the deep, near the hazards that killed you), but
  never a run-ender. If the player dies again before retrieving an old cache, the
  standard behavior is that the newest death drops a fresh cache; keeping the world to
  a **single** most-recent cache is acceptable (older uncollected caches may be
  superseded).
- **Standard has no Game Over from death** (`specs/flow.md`): the expedition continues
  until the player launches the rocket (Victory) or quits. The cost of dying is the
  lost trip and the retrieval, plus — on a failed core run — going back down for a
  fresh Core Sample.

## Hardcore

The unforgiving mode: **death ends the expedition.**

- On death, the run is **over immediately** — the game goes to the **Game Over** state
  (`specs/flow.md`), showing the run summary (deepest depth, Credits, components
  installed, and how the miner died).
- There is **no respawn and no dropped cache** — Hardcore is permadeath. **PLAY AGAIN**
  starts a completely fresh Hardcore expedition (new world, `0` Credits, tier-1 gear,
  an empty rocket); **MENU** returns to the title.
- Because a single mistake ends everything, Hardcore rewards caution — banking Credits
  often, upgrading hull and fuel before pushing deep, and treating the 90-second core
  run as the genuine gamble it is.

The mode-select menu makes this contrast explicit: **Standard** — "die and you drop
your haul but respawn at the surface; retrieve it and keep going"; **Hardcore** — "one
death ends the expedition." Both play the same mine to the same rocket; only the price
of dying differs.
