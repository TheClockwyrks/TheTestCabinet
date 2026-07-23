# Valence — UI: game states, menus, and the HUD

This file defines the game's screens — the menus and the state machine that
moves between them — the HUD shown during play, and what is out of scope. It
refers to the board (`specs/board.md`), the matter (`specs/matter.md`), the
towers (`specs/towers.md`), and the controls (`specs/controls.md`), and to the
campaign start, economy, integrity, rounds, and scoring in `specs/gameplay.md`.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. Title / main menu. Shows the title `VALENCE`, a tagline, and a vertical menu
   listing the playable start defined in `specs/gameplay.md` (which declares its
   own entry), followed by `HOW TO PLAY`. The selected item is highlighted. A dim
   slice of a live board may show behind the menu for atmosphere.
2. Map select. Reached from the campaign start on the main menu
   (`specs/gameplay.md`). Lists the maps the campaign offers (`specs/board.md`), at
   least the Easy single-path, the Medium branching, and the Hard
   multiple-separate-path maps, each showing its name, difficulty, topology
   (single / branching / multiple), and path style (curved / straight), with a
   small preview of its path shape. Choosing a map begins the 40-round campaign
   on it; a BACK choice returns to the main menu.
3. How to play. Describes the goal (break matter down before it reaches the
   collector), the controls, the hit-point / damage-type model, and the three
   stackable traits and what each asks of the board: bonded (chip its bond pool,
   any tower, kinetic best), heavy (kinetic or nuclear only), inert (needs a
   detector), plus the Moderator's slow, the Catalyst's reveal, and the economy
   and integrity. Returns to the menu.
4. In play. The live game: the chosen map's paths, matter flowing along them,
   the towers firing and the support auras, and the full HUD and build panel.
   This covers both the build phase (countdown running, no matter spawning) and
   the round phase (matter active); building is allowed in both
   (`specs/controls.md`). Play can be paused in place here (ticks freeze while
   the board stays fully interactive, with no menu over it) via the status-bar
   pause control or `Space` during a round (`specs/controls.md`).
5. Paused. The `Esc` overlay menu, reachable in play. Offers Resume, Restart,
   and Quit to menu. The board is visible but frozen behind the menu. This is
   separate from the in-place pause of state 4: the menu freezes the game and
   covers it, whereas the in-place pause freezes the game but keeps it playable.
6. Victory. Shown when the final round is cleared with integrity remaining.
   Displays the final score, rounds survived (all `40`), and integrity
   remaining, with PLAY AGAIN and MENU.
7. Containment failed. Shown when integrity reaches `0`. Displays the final
   score and the round reached, with PLAY AGAIN (or TRY AGAIN) and MENU.

## Required menus

Every menu and screen below must be present and reachable. Each entry states its
content (what must appear) and its navigation (where its choices lead); the
visual layout, styling, and interaction details are yours, subject to the
palette and type of `specs/overview.md`. The campaign start's menu entry is in
`specs/gameplay.md`.

- Main menu, the title, a tagline, the playable start from `specs/gameplay.md`,
  then HOW TO PLAY. The start leads to the map-select screen; HOW TO PLAY leads
  to the how-to-play screen.
- Map select, the maps the campaign offers, each with its name, difficulty,
  topology, and path style (`specs/board.md`); choosing one begins a game on
  that map; BACK returns to the main menu.
- How to play, the goal, the controls, the hit-point / damage-type model, the
  three stackable traits and what each asks of the board, and the economy; a way
  back to the menu.
- Pause menu, Resume, Restart, and Quit to menu, over the frozen board.
- Victory screen and Containment-failed screen, the end-of-game results with
  PLAY AGAIN and MENU. PLAY AGAIN replays the same campaign start on the same
  map; MENU returns to the main menu.

Every menu must be fully operable with the mouse alone, with the keyboard
accelerators of `specs/controls.md` as an alternative. This specification fixes
the content and navigation of these menus, not their layout or presentation.

## HUD

The HUD is the top status bar and the right build panel (`specs/board.md`),
drawn in code (`specs/assets.md`; only their small icons may be produced
sprites), always fully visible:

- Status bar (`y` in `[0, 56]`): energy, integrity (turning to the alert color
  as it runs low), the round indicator `ROUND n / 40` with the current round's
  progress or the build-phase countdown, and the speed, pause, and mute
  controls.
- Build panel (`x` in `[1000, 1280]`): the shop (each tower's name, cost, icon,
  and on hover its info), the selected-tower inspector (level, live stats,
  upgrade and sell), the next-round preview (the coming round's types, shown
  when nothing is selected or hovered), and the START ROUND / send-early control
  with the speed toggle.

On the board, each unit carries its integrity read (a free atom's shells, a
bonded cluster's draining bond pool, a heavy's draining shells, a shroud/reveal
mark on inert matter, `specs/matter.md`) and each tower reads as its type,
damage type, and chosen branch, and shows its range when selected or held. A
player must be able to read, without hunting, whether they can afford the next
tower, how close integrity is to zero, what the coming round needs, and which
capability each unit on the board demands.

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between
  sessions.
- Touch or gamepad input (mouse and keyboard only for this version).
- A board editor or procedurally generated maps; the maps are the fixed,
  hand-authored set of `specs/board.md` (the player chooses among them at map
  select, but cannot edit or generate one).
- An in-run research or tech tree beyond the per-tower upgrades of
  `specs/towers.md`.
- Any matter form, tower, or mechanic beyond those specified here; keep the
  scope to the systems above, done well.
