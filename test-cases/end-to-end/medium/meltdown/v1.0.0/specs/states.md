# States

## Overview

This file defines the game's state machine, the menus each state requires, and what
the HUD shows. It refers to the floor and build panel in `specs/reactor.md`, the heat
system in `specs/heat.md`, the surge in `specs/surge.md`, the controls in
`specs/controls.md`, the economy in `specs/economy.md`, the run in `specs/waves.md`,
and the modes and difficulties in `specs/modes.md`.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. Title / main menu. Shows the title `MELTDOWN`, the tagline `RUN IT HOT`, and a
   vertical menu of two entries: PLAY, then HOW TO PLAY. The selected item is
   highlighted. A dim slice of reactor floor with a few glowing towers may show behind
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
   Rime, flyers, air-capable emitters, and the air-only Flak, and the economy. Returns
   to the main menu.
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

Every menu is fully operable with the mouse alone, with the keyboard accelerators of
`specs/controls.md` as an alternative. This specification fixes the content and
navigation of these menus, not their layout or presentation.

## HUD

The HUD lives in the build panel (`specs/reactor.md`): money, lives, and the wave
indicator (`WAVE n / N`, the current wave over the run's total, `specs/modes.md`, with
a read of the current wave's progress or the build-phase countdown; a mode with a
single onslaught reads that instead) as status readouts; the shop (whose entries, on
hover, show that tower's info in the inspector area, `specs/reactor.md`); the
selected-tower inspector with the selected tower's live heat read, its targeting, and
its kill and damage counts (`specs/reactor.md`); and the wave controls (send next wave
with its bonus, the 1x/2x speed toggle, and pause). The build panel is always fully
visible (`specs/overview.md`). On the floor, towers carry their own at-a-glance heat
read (`specs/overview.md`, `specs/heat.md`) and surge units carry health bars
(`specs/surge.md`).

A next-wave preview, what types the coming wave contains, is shown during the build
phase (in the panel or as a banner) so the player can re-shape the maze for it. In the
panel it occupies the inspector area when no tower is selected and no shop tower is
hovered (`specs/reactor.md`).
