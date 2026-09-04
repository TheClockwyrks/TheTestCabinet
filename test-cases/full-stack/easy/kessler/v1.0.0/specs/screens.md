# Kessler — Screens and the HUD

This file fixes the screens the game moves between, what each one shows, the
menus, and the HUD over the field. The actions the screens are driven by are
in `specs/controls.md`, the field the play screens frame is in
`specs/field.md`, and the figures the HUD reports are in `specs/scoring.md`
and `specs/rings.md`.

## Presentation

Kessler fixes no palette, no font, and no layout for its screens. Every piece
of text a screen shows is legible against whatever sits behind it at the
logical stage size of `1000 x 1000` that `specs/overview.md` fixes.

## The screens

The snapshot's `screen` field, fixed in `specs/instrumentation.md`, names the
screen the game is in, and the game opens on `title`.

| `screen` | The screen |
| --- | --- |
| `title` | The title and main menu. |
| `howto` | How to play. |
| `playing` | The live field. |
| `waveclear` | The interstitial after a wave is cleared. |
| `paused` | The pause menu over the frozen field. |
| `gameover` | The end of a session out of lives. |

### `title`

Shows the title, `KESSLER`, and the menu:

| Entry | Copy |
| --- | --- |
| `0` | `START` |
| `1` | `HOW TO PLAY` |

`confirm` on `START` starts a fresh session and sets `screen` to `playing`,
with wave 1 laid out as `specs/rings.md` states and a ball parked on the
deflector as `specs/deflector-and-ball.md` states. `confirm` on `HOW TO PLAY`
sets `screen` to `howto`. The field may show behind the menu, dimmed or
otherwise quieted, if that suits the look you design.

### `howto`

How to play, written in a player's words rather than as rules of a system. It
covers:

- that the deflector circles the planet and reflects the ball back out;
- that a ball reaching the planet burns up, and that losing the last ball
  costs a life;
- that hitting the derelicts scores, and that clearing every one ends the
  wave;
- that destroyed derelicts shed salvage pods, which the deflector catches;
- the controls, naming the keys bound to each action in `specs/controls.md`.

`confirm` and `back` both return to `title`.

### `playing`

The live field, and the only screen the simulation advances on. It shows the
planet, the three rings and their derelicts, the deflector, every ball, every
falling pod, the shield ring while one is active, the containment field, and
the HUD. `back` and `pause` set `screen` to `paused`; the life loss that
spends the last life, fixed in `specs/deflector-and-ball.md`, sets it to
`gameover`; the clearing event, fixed in `specs/rings.md`, sets it to
`waveclear`.

### `waveclear`

A banner announcing the cleared wave, shown over the field for `180` ticks.
That count is the interstitial timer the snapshot reports as
`interstitialTicks` in `specs/instrumentation.md`, and the clearing event sets
it to `180`. Only that timer advances during the interstitial, and no input is
read. When it lapses, `screen` returns to `playing` with the next wave laid
out as `specs/rings.md` states.

### `paused`

The pause menu, over the field drawn exactly as the tick that paused it left
it:

| Entry | Copy |
| --- | --- |
| `0` | `RESUME` |
| `1` | `QUIT` |

`confirm` on `RESUME` returns to `playing` with the session intact, and `back`
and `pause` both do exactly what `RESUME` does. `confirm` on `QUIT` discards
the session and returns to `title`.

### `gameover`

Shows the heading `GAME OVER`, the final score, and the wave the session
reached. Entering it plays the `game-over` cue, and `confirm` returns to
`title`.

## Menus

`title` and `paused` carry a menu, indexed as the tables above index it. The
snapshot's `menu.index`, fixed in `specs/instrumentation.md`, is the
highlighted entry, drawn distinctly from the others so a player always sees
which entry `confirm` would accept. On a screen with no menu `menu.index`
rests at `0`.

`up` moves the highlight to the previous entry and `down` moves it to the
next, each wrapping past the end to the other, and each move plays the
`menu-move` cue. `confirm` accepts the highlighted entry and plays the
`menu-select` cue.

Both menu-bearing screens are driven by pointer and by touch as well as by the
keyboard, as `specs/controls.md` fixes, and each reports a hit region for
every entry it shows through the `menuItemRect` reading of
`specs/instrumentation.md`.

### What is highlighted on arrival

Arriving at a menu-bearing screen highlights the entry that led away from it
to the screen just left, and entry `0` otherwise.

| Arrival | Highlighted entry |
| --- | --- |
| `title`, entered from `howto` | `1`, `HOW TO PLAY` |
| `title`, entered from `playing`, `paused`, or `gameover` | `0`, `START` |
| `title`, when the game opens | `0`, `START` |
| `paused`, on every entry into it | `0`, `RESUME` |

## What advances on each screen

| Screen | What advances |
| --- | --- |
| `playing` | Every part of the simulation. |
| `waveclear` | The interstitial's `180`-tick timer, and nothing else. |
| `title`, `howto`, `paused`, `gameover` | Nothing. |

Pausing freezes the whole simulation: the ring orbits, the effect and
interstitial timers, the falling pods, the balls in flight, and the ball
sprite's animation all hold exactly as the pausing tick left them, and
resuming carries on from there. Particle effects are presentation, not
simulation: one already playing keeps playing over a frozen field.

## The HUD

The HUD is drawn on `playing`, clear of the containment field, so nothing it
draws crosses the field of play, and each readout is legible at a glance.
Where on the stage it sits is yours.

| Readout | Content |
| --- | --- |
| Score | The score, in digits, as `specs/scoring.md` fixes it. |
| Lives | The lives remaining. |
| Wave | The number of the wave in play. |
| Effects | The active effects, as below. |

The effects readout indicates each timed effect currently in force and whether
a shield is active. It may reuse the produced pod sprites `specs/assets.md`
lists, and how it looks is yours.

## Out of scope

- Network or online play, leaderboards, and any server interaction.
- Persistence of the score or any setting between sessions. Each session
  starts fresh.
