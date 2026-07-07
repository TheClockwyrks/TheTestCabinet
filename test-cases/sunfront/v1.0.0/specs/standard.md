# Sunfront — Skirmish (standard mode)

This is the game's playable mode. It defines the standard one-versus-one match and
its main-menu entry. It builds on the common specs (`specs/overview.md`,
`specs/playfield.md`, `specs/economy.md`, `specs/units.md`, `specs/waves.md`,
`specs/flow.md`) and adds nothing new to their rules — it is the baseline match
they describe.

## Menu entry

The main menu lists this mode first, as:

- **`SKIRMISH`** — a full match against the AI on the standard front.

`HOW TO PLAY` follows the mode entry (`specs/flow.md`).

## The match

- One **human** commands the **left** legion; the **AI** (`specs/flow.md`)
  commands the **right**. The field, both bases, and both Reliquaries are the
  standard layout in `specs/playfield.md`.
- Both sides start with `200` sol and the standard fixed income rate
  (`specs/economy.md`), and share the **full ten-unit roster** in
  `specs/units.md` — every spawner type is buildable from the first second.
- The **wave clock** runs as in `specs/waves.md` (first wave at `20 s`, then every
  `45 s`), and the match ends when a base is razed (`specs/flow.md`).

There are no rule changes, handicaps, or restrictions in Skirmish: it is the game
exactly as the common specs define it, and it is the mode the reference
screenshots depict.
