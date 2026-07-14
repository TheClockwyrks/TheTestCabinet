# Arc Foundry — The Salvage campaign

This file (`specs/mode.md`) defines the campaign start this run plays and its
main-menu entry. It builds on the board and its maps in `specs/board.md`, the Load
in `specs/enemies.md`, the components in `specs/towers.md`, the scrap-press build
loop in `specs/build.md`, the controls in `specs/controls.md`, the difficulties in
`specs/modes.md`, and the flow in `specs/flow.md`.

## Menu entry

This start adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `SALVAGE`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always
shown last in the menu.)

## The start

- **Salvage** — the standard campaign. Choosing it opens the **map select**
  (`specs/board.md`, `specs/flow.md`), where you pick which yard to defend — **The
  Substation**, **The Switchyard**, or **The Transformer Yard** — and then the
  **difficulty select** (`specs/modes.md`), where you pick **Easy**, **Medium**, or
  **Hard**. You then begin with a **starting Charge of `130`** and a **starting
  Grid Integrity of `20`**, and play the chosen difficulty's full wave run
  (`specs/modes.md`) on that map: stamp components from the scrap-press, wall the
  yard into a maze, and burn the Load down before it reaches the Collector, banking
  and spending Charge across the escalating waves, until you either clear the final
  wave with Grid Integrity to spare (victory) or Grid Integrity reaches `0`
  (overload). The `130` opening buys the first few stamps rather than a finished
  board, so the opening build phase is the first real layout decision.

This start uses every system exactly as the common specs define it, with no
overrides beyond the chosen difficulty's wave count and enemy toughness
(`specs/modes.md`):

- the **board**, its three maps, ordered waypoints, and tower-as-wall mazing from
  `specs/board.md`;
- the **Load** — its unit roster, hit points, the flyer, and the Dynamo boss —
  from `specs/enemies.md`;
- the **components**, their quality ladder, targeting, and selling from
  `specs/towers.md`;
- the **scrap-press build loop** — the random stamp, keep / slag / combine — from
  `specs/build.md`;
- the controls from `specs/controls.md`;
- and the economy, Grid Integrity, the wave progression with its Dynamo, scoring,
  the states, and the HUD from `specs/flow.md`.
