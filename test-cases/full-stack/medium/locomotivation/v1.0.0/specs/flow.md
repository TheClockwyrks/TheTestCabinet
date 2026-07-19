# Locomotivation — shift, states, and HUD

This file defines the shift rules (clock, lives, win/fail), the scoring, the game
state machine and required menus, and the HUD. Numbers are initial, tunable values.

## The shift: clock, lives, win, fail

Each level is one shift:

- Shift clock: a per-level countdown (`specs/levels.md`) that runs while the level
  is live (it pauses only on the Esc pause menu). When it reaches zero the shift
  ends.
- Lives: 3 per level. A death (any train contact, `specs/trains.md`) spends one
  life, destroys all carried cargo (`specs/cargo.md`), and respawns the worker at
  the level's spawn after a brief beat. Banked deliveries persist across a death.
  Lives do not carry between levels; each level starts fresh with 3.

Win: the level is complete the moment the full required quota is satisfied (every
dispenser quota count met and every unique package delivered, `specs/cargo.md`,
`specs/levels.md`). On completion the shift ends in success and the Level Complete
screen shows.

Fail: the level fails on any of:

1. the shift clock reaches zero with the required quota not yet met;
2. lives reach zero (the third death);
3. a unique required package is destroyed (smashed on a track, or lost by dying
   while carrying it), which is an immediate fail regardless of clock or lives.

Optional freight (`specs/cargo.md`) never affects win or fail, only score.

If a level has a last train (`specs/trains.md`) and the required quota is already
met, boarding it ends the level in success early (with the bonus); if the quota is
met and the player does not board, the level still completes in success when the
clock ends. If the quota is not met when the clock ends, the level fails whether or
not a last train is present: the last train is a bonus, never a substitute for the
quota.

## Scoring

A per-level score is shown on the Level Complete screen and summed for the campaign.
Compute it from (initial weights, tunable):

- Required deliveries: a base value per required package delivered (dispenser plus
  unique).
- Optional deliveries: a higher value per optional package delivered (the greed
  reward).
- Time bonus: proportional to the shift clock remaining at completion.
- Lives bonus: a bonus per unused life.
- Near-miss bonus: a small living-dangerously bonus each time the worker survives
  passing very close to a moving train (a brush inside a small margin); this rewards
  courting the trains and lifts the score ceiling.
- Last-train bonus: a large one-off bonus for boarding the last train
  (`specs/trains.md`), the top of the leaderboard on levels that offer one.

Exact coefficients are yours to set; the ordering is fixed (optional greater than
required per item; a meaningful time and lives bonus; a headline last-train bonus).

## Game states

Every state below is reachable and behaves correctly. Menus are keyboard-navigable
(`specs/controls.md`) and drawn in the palette and monospace type
(`specs/overview.md`).

- Title: the game name and menu (PLAY, HOW TO PLAY). Audio does not autostart before
  the first interaction (`specs/assets.md`).
- Level select / campaign map: the six levels, showing which are unlocked (completed
  levels and the next; later levels locked until reached) and the best score per
  completed level. PLAY enters the first uncompleted level, or the selected unlocked
  level. A simple linear progression that jumps straight into the next level is
  acceptable, but the player can see progress and replay a completed level.
- How to play: a concise controls-and-rules screen: move, sprint, pick up and drop,
  deliver to matching color, trains kill on any contact, drop cargo off the tracks
  or a train smashes it, the clock and 3 lives, unique packages fail the level if
  lost, and the optional last train.
- In-level (playing): the live shift: the ¾ yard, the worker, trains, cargo, and the
  HUD.
- Pause (Esc): an overlay pausing the clock and simulation: Resume, Restart level,
  Quit to menu. Also exposes the mute toggle.
- Level Complete: on a win: the score breakdown (required, optional, time, lives,
  near-miss, last-train bonus), the total, and Next (to the next level) and Menu.
  After the final level this instead leads to Victory.
- Level Failed: on a fail: which fail condition triggered (out of time, out of
  lives, unique lost), the partial summary, and Retry and Menu.
- Victory: after completing Level 6: a campaign summary (per-level scores and the
  total), and Play Again (from Level 1) and Menu.

## HUD

The top status bar (`y` in `[0, 80]`, `specs/overview.md`) shows, legibly and at a
glance:

- the shift clock (mm:ss or a countdown bar), turning to the alert color and
  pulsing under a low threshold (with the low-clock alarm, `specs/assets.md`);
- the quota progress: for each required color, delivered / required (for example
  `RED 1/1`, `BLUE 2/3`), and each unique package's status (carried, delivered, or
  lost), so the player always knows what remains;
- lives remaining (for example three worker pips);
- the carried-load weight bar: the current load as a fraction of `W_max`, with the
  ~50% and ~80% thresholds marked, reading toward OVERWEIGHT as it fills and showing
  SPRINT LOCKED past the 80% line (`specs/character.md`);
- the sprint bar: the recharging sprint charge, draining while sprinting and
  refilling otherwise, greyed or LOCKED when the load is over the threshold;
- the pause and mute controls.

The current level name or number and the score so far may appear in the bar or a
corner. The HUD, the crossing telegraph cues over the world (`specs/trains.md`), and
all menus are drawn in code in the palette; only small icons may be produced
sprites.

## Out of scope

To keep the build focused: no online play, accounts, or persistence beyond
in-session progress; no level editor; no difficulty settings beyond the campaign's
own ramp; no story cutscenes. A single self-contained campaign, played start to
finish, is the whole game.
