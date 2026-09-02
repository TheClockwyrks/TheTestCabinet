# Gantry — Screens, readouts, and audio

This file defines the game's screens, what each shows and offers, the run
screen's readouts, the failure copy, and the audio cues. The actions named
here are the ones `specs/controls.md` binds.

## The screens

| Screen | Purpose |
| --- | --- |
| `title` | The front door: the title, the tagline, and the main menu. |
| `howto` | How the game is played, in a player's words. |
| `select` | The six sites: progress, scores, and entry. |
| `build` | The yard and the structure editor. |
| `program` | The yard and the tape editor. |
| `run` | The tape playing out under the simulation. |
| `results` | A cleared site's score. |

The menus are driven by the key actions alone: the pointer operates the 3D
scene and the tape editor, never a menu. On every menu `up` and `down` move
the highlight by one entry and wrap at both ends, `confirm` takes the
highlighted entry, and `left` and `right` reach the menu but leave the
highlight where it is. Where `back` leads is stated per screen below.

### Title

The game opens on `title`, showing `TITLE_TEXT` (`GANTRY`), `TAGLINE_TEXT`
(`RIG THE CRANE. RUN THE TAPE.`), and the menu `TITLE_ITEMS` (`SITES`,
`HOW TO PLAY`), with `menuIndex` `0` on arriving. `SITES` opens `select`,
`HOW TO PLAY` opens `howto`, and `back` does nothing.

### How to play

`howto` explains the game in a player's words: reading a site, the build tools
and the parts they place, the ring and what the arm turns on, writing a tape
and what each axis does, why speed loads the structure and swings the load,
and setting a load down inside the tolerances. It names the tool, `undo`,
`check`, screen-switch, and `run` bindings. `back` returns to `title` with
`menuIndex` `0`.

### Site select

`select` lists the `SITE_COUNT` (`6`) sites in order, each showing its number,
its name, and its state: locked, open, or cleared, with a cleared site's best
score, cost and time, beside it. Site `1` is open from the start; clearing
site `n` opens site `n + 1`, and cleared and open sites stay so for the
session. A site's state reads without relying on hue alone.

`confirm` on an open or cleared site enters it, opening the `build` screen
with that site's stored structure and tape; `confirm` on a locked site does
nothing; and `back` returns to `title`. On arriving, the highlight sits on the
site most recently entered or cleared, and on site `1` before any has been
entered.

### Build

`build` shows the yard through the camera: the ground, the lattice and
envelope aids, the anchors, the obstacles, the loads at their starting poses,
the pads, and the structure as built, with the picked node highlighted and a
pending first node marked. Its readouts show the site's name, the cost against
the budget, the tool palette with each tool's binding and the selected tool
marked, and the tape's step count.

The `check` action runs the static check (`specs/structure.md`) and shows what
it reports: the issues by name, and, on a structure with none, whether it
stands and each member colored by its static utilization on the utilization
ramp (`specs/overview.md`).

A refused edit is visible in the moment it is refused, in whatever form suits
the look, so a player is never left wondering why a click did nothing.

`program` switches to the tape, `run` starts the run, and `back` returns to
`select`. A refused start (`specs/program.md`) stays on the screen and shows
the refusing issues by name.

### Program

`program` shows the same yard and readouts, with the tape editor over it: the
steps in order, each move's commands and each action legible, and the editing
the tape editor offers (`specs/controls.md`). `build` switches back, `run`
starts the run, and `back` returns to `select`.

### Run

`run` shows the tape playing out. Its readouts, over the live scene:

- Each axis's value and its command's target while one is live.
- The live step as `step m / n`, with `m` the live step counted from `1` and
  `n` the tape's step count.
- The run clock, in seconds, and the crane's cost.
- The watch speed, cycled by `speed` through `RUN_SPEEDS`
  (`specs/program.md`).
- A legend for the utilization ramp (`specs/overview.md`), so the member
  coloring reads.

A cleared run moves to `results`. A failed run stays here, the scene as it
stood, with the failure copy below shown plainly and `back` returning to
`build`. `back` during a running run aborts it, as `specs/program.md` states.

### Results

`results` shows `CLEARED_TEXT` (`SITE CLEARED`), the run's cost and time
beside the site's par cost and par time (`specs/sites.md`), and the menu
`RESULTS_ITEMS` (`NEXT SITE`, `REPLAY`, `SITE SELECT`), with `menuIndex` `0`
on arriving. On the last site `NEXT SITE` is left out and the menu is the
other two entries in the same order. `NEXT SITE` opens the next site's `build`
screen, `REPLAY` returns to this site's `build` screen, and `SITE SELECT` and
`back` return to `select`.

A clear records the site's best score: the first clear as it stands, and a
later clear replaces it when its cost is lower, or equal with a lower time.

## The failure copy

Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
gives it:

| Cause | Copy |
| --- | --- |
| `collapse` | `THE STRUCTURE COLLAPSED` |
| `ring-overload` | `THE SLEW RING GAVE WAY` |
| `cable-snap` | `THE HOIST CABLE SNAPPED` |
| `structure-struck-obstacle` | `THE CRANE STRUCK AN OBSTACLE` |
| `load-struck-obstacle` | `THE LOAD STRUCK AN OBSTACLE` |
| `load-struck-ground` | `THE LOAD STRUCK THE GROUND` |
| `attach-missed` | `NOTHING TO ATTACH` |
| `release-misplaced` | `THE LOAD WAS DROPPED` |
| `command-out-of-range` | `A COMMAND WAS OUT OF RANGE` |
| `loads-unplaced` | `THE TAPE ENDED WITH LOADS UNPLACED` |

## Audio

The game's sounds are the produced files `specs/assets.md` lists, played on
these cues:

| Cue | Plays |
| --- | --- |
| `place` | a structure edit places a member, the ring, or a counterweight |
| `delete` | a structure edit removes one of those, and every `undo` |
| `run-start` | a run starts |
| `attach` | a load attaches |
| `placed` | a load is set down on its pad |
| `creak` | a member's utilization crosses `CREAK_THRESHOLD` (`0.8`) upward; at most once per `CREAK_COOLDOWN` (`0.5`) seconds across the structure |
| `break` | a tick breaks one or more members, once for the tick |
| `collapse` | a run fails as `collapse` or `ring-overload` |
| `complete` | a run clears the site |
| `fail` | a run fails, whatever the cause |
| `motor` | loops while any axis's rate is nonzero, and is silent otherwise |

Each cue is a distinct sound. A cue plays once for the event that raises it,
and at most once on a given tick or edit; `motor` is the one loop. The title
and select screens carry the produced music bed, and whether it continues
under the other screens is the build's choice. The `mute` action toggles all
sound from any screen, and the game stays fully playable muted.
