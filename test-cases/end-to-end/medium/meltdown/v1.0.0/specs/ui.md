# UI: menus, game states, the HUD, and audio

This file defines the game's screens — the menus and the state machine that moves
between them — the heads-up display drawn in the build panel during a match, and the
game's audio. The values the HUD shows (money, lives, waves, and scoring) are defined
in `specs/economy.md` and `specs/gameplay.md`; the build panel's place on the stage is
in `specs/playfield.md`; how the shop, inspector, and wave controls are operated is in
`specs/controls.md`; and the modes and difficulties the menus choose are in
`specs/modes.md`.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. Title / main menu. Shows the title `MELTDOWN`, the tagline `RUN IT HOT`, and a
   vertical menu of two entries: PLAY, then HOW TO PLAY. The selected item is
   highlighted. A dim slice of the floor with a few glowing towers may show behind
   the menu for atmosphere.
2. Mode select. Reached from PLAY. Lists the selectable modes (`specs/modes.md`): the
   standard Containment mode and the special modes. Mousing over (or focusing) a mode
   shows that mode's description, what it is and how it changes the game, before it is
   chosen, so the player can read a mode before committing to it. Selecting Containment
   goes to Difficulty select; selecting a special mode starts it. A control returns to
   the main menu.
3. Difficulty select. Reached by selecting Containment on mode select. Lists the three
   difficulties, Easy, Medium, Hard (`specs/modes.md`), showing what each changes (its
   starting money and wave count) before it is chosen; selecting one starts a
   Containment game at that difficulty. A control returns to mode select.
4. How to play. Describes the goal (stop the surge from reaching the exhausts), the
   controls, heat as power and the redline trip, the Forge and Sink, the heat-averse
   Rime, flyers, air-capable emitters, and the air-only Flak, that each wave fields a
   single intruder type and what each type demands (`specs/surge.md`), and the economy.
   Returns to the main menu.
5. In match. The live game: the floor and its maze, the surge walking and flying, the
   towers firing and heating, and the build panel. This covers both the build phase
   (countdown running, no surge spawning) and the wave phase (surge active); building
   is allowed in both (`specs/controls.md`).
6. Paused. Reachable in match. Offers Resume, Restart, and Quit to menu. The floor is
   visible but frozen behind the pause menu.
7. Victory. Shown when the final wave is cleared with lives remaining. Displays the
   final score, waves survived (all `N`), and lives remaining, with PLAY AGAIN and
   MENU.
8. Game over. Shown when lives reach 0. Displays the final score and the wave reached,
   with PLAY AGAIN and MENU.

## Required menus

Every menu and screen below must be present and reachable. Each entry states its
content (what must appear) and its navigation (where its choices lead) only; the
visual layout, styling, and interaction details are yours, subject to the palette and
type of `specs/overview.md`. The mode and difficulty content lives in `specs/modes.md`.

- Main menu: the title, the tagline, and the entries PLAY and HOW TO PLAY. PLAY goes to
  mode select; HOW TO PLAY goes to the how-to-play screen.
- Mode select: an entry for the standard Containment mode and one for each special
  mode, plus a way back to the main menu. Each mode's description must be readable
  before it is selected (for example on hover or focus). Containment goes to difficulty
  select; a special mode starts that mode; back goes to the main menu.
- Difficulty select: an entry for Easy, Medium, and Hard, each showing its starting
  money and wave count before selection, plus a way back to mode select. A difficulty
  starts Containment at it; back goes to mode select.
- How to play: the goal, the controls, and the signature systems; a way back to the
  main menu.
- Pause menu: Resume, Restart, and Quit to menu, over the frozen floor.
- Victory screen and Game over screen: the end-of-game results with PLAY AGAIN and
  MENU. PLAY AGAIN replays the same mode and difficulty; MENU returns to the main menu.
  PLAY AGAIN is the focused entry when either screen opens, so the confirm key
  (`specs/controls.md`) replays the run.

Every menu is fully operable with the mouse or touch alone, with the keyboard
accelerators of `specs/controls.md` as an alternative. This specification fixes the
content and navigation of these menus, not their layout or presentation.

## The HUD

The HUD lives in the build panel, the right strip (`x` in `[986, 1280]`, full height)
defined in `specs/playfield.md`. It is drawn on the panel background (`#1b1f26`),
separated from the floor by a divider (`#2c323c`), and is always fully visible at every
window size (`specs/overview.md`). This section fixes what the panel draws and roughly
where; how each element is operated (arming from the shop, the shop-hover info panel,
selecting a tower, upgrading, selling, and the wave controls) is defined in
`specs/controls.md`.

Top to bottom, the panel holds:

- Status readouts: the current money (in `#ffcf4d`), the lives remaining, and the wave
  indicator (`WAVE n / N`, the current wave over the run's total, with a read of the
  current wave's progress or the build-phase countdown; a mode with a single onslaught
  reads that instead, `specs/modes.md`). Their meanings are in `specs/economy.md` and
  `specs/gameplay.md`.
- The shop: a grid of buyable towers, one button per type (the six emitters plus the
  Forge and Sink of `specs/towers.md`), each showing the tower's icon, name, and cost.
  A type the player cannot currently afford is drawn disabled.
- The selected-tower inspector: the area that shows a selected tower's readouts — its
  type and level, its stats (size, range, damage or effect, fire rate, targeting, mass,
  and radiator faces), its live heat read (a labeled bar from 0% to 100% with the
  tower's redline marker at its max-efficiency point, `specs/heat.md`), and its
  per-instance kill and total-damage tallies. When nothing is selected and no shop
  tower is hovered, this area shows a brief hint or the next-wave preview. What appears
  here on shop-hover and on selection, and the actions it offers, are in
  `specs/controls.md`.
- Wave controls: the Send next wave action (which reads Start in the untimed opening
  build phase before Wave 1), the game-speed toggle (1x / 2x), and Pause.

A next-wave preview — what types the coming wave contains — is shown during the build
phase (in the inspector area when no tower is selected and no shop tower is hovered) so
the player can re-shape the maze for it.

On the floor, towers carry their own at-a-glance heat read (`specs/overview.md`,
`specs/heat.md`) and surge units carry health bars (`specs/surge.md`); these are drawn
on the play area, not in the panel.

## Audio

Audio is required: synthesize it with the Web Audio API (no audio files), with distinct
short cues for at least an emitter firing, a tower tripping its redline, a surge unit
dying, a unit leaking an exhaust, placing a tower, clearing a wave, and the Victory and
Game-over stings. The game stays fully playable with sound muted and never fails to run
or load if audio cannot start. Provide a mute toggle (`specs/controls.md`), and do not
start audio until the player first interacts (browsers block autoplay).

The mute control shows which state it is in. It is a control in the build panel
(`specs/controls.md`), and it reads on screen as on or off — a struck-through or
otherwise distinctly drawn icon, a label that changes, a lit/unlit button, whatever fits
the HUD — so a player who has muted the game can see that they have, and can tell a
muted game from one whose audio failed to start. The toggle changes that read
immediately, whether it was operated by the on-screen control or by the mute hotkey.
