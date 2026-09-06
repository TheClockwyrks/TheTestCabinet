# Showcase capture driver

`base.showcase-capture.test.ts` (re)records everything in `showcase/base/` — the
`gameplay.json.gz` replay and its five `.png` stills — from `references/none`,
playing a REAL round. The build opens on its title screen, `PLAY` is taken with a
real key press through the registered `confirm` action, and every move after that
is a real mouse press, drag and release onto a neighboring gem. The board, the
chains, the strain, the cuts and the refill are all the build's own.

Nothing is posed mid-play: the driver never calls `loadBoard` or `setGem`, and
the only surface operations it uses are the clock (`setAutoStep` and `advance`,
which nothing outside an engineless build owns), `reset` for the seed, and
`snapshot` for reading. What it plans with is the case's own rule helpers in
`validation/none/board.ts` — `legalSwaps`, `swapped`, `runSeed`, `expandClearSet`
— so each candidate swap is played forward under R1, R3, R4, R5 and R6 before it
is made and the player takes the move that clears the most. The escalation in the
clip, from single runs to a primed corner going all at once, is the ruleset's
rather than a script's.

Two of the build's own clocks decide the pace, and the driver never counts frames
against either of them. A chain is polled to its end on `phase`, so a step holds
for the `lastWaves * WAVE_SECONDS + lastFall * FALL_SECONDS_PER_ROW +
STEP_SECONDS` the snapshot reports as `stepHold` rather than for a written-down
span; and the two stills that frame a step in motion are timed off that step's
own `lastWaves` and `lastFall` through `board.ts`'s `shatterEnd` and `landAt` —
one while the clear set is coming apart in waves, the other part way through the
fall that follows it.

Reaching the level's target opens the `levelclear` screen and the round waits
there, so the driver reads it, takes `CONTINUE` from it by pressing the screen's
`menu-0` pointer target, and plays on into the next level. The clip therefore
carries a level clear and the fresh board that pours in after it.

## Running it

Stage the `none` validator project into the reference workspace, drop the driver
in as a test, and lift the two frame caps the validators impose on a replay — the
recorder's in-page bound and the written recording's:

```sh
cd test-cases/full-stack/easy/facet/v1.0.0/references/none
rm -rf validation
cp -r ../../validation/none validation
cp ../../showcase/capture/base.showcase-capture.test.ts \
  validation/showcase-capture.test.ts
# The page holds at most 600 frames and decimates as it fills; the file holds at
# most 300. A 24-second take is about 1520 frames, so both have to go up for the
# clip to play at the rate it was driven at.
sed -i 's/^  const KEEP_MAX = 600;$/  const KEEP_MAX = 2600;/' \
  validation/recorder-init.js
sed -i 's/^export const MAX_REPLAY_FRAMES = 300;$/export const MAX_REPLAY_FRAMES =\
  Number(process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300");/' \
  validation/constants.ts
TCAB_VALIDATION_MEDIA_DIR=/tmp/facet-showcase \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1600 \
  TCAB_SHOWCASE_SEED=8 TCAB_SHOWCASE_PHASE=1 \
  TCAB_SHOWCASE_MIN_SECONDS=22 TCAB_SHOWCASE_MAX_SECONDS=40 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

The outputs land under
`/tmp/facet-showcase/validation/showcase-capture.test.ts/`. Copy
`gameplay.json.gz`, `a-corner-goes.png`, `deep-chain.png`, `strained-board.png`,
`level-clear.png` and `fresh-board.png` into `showcase/base/`, then delete the
staged `validation/` copy — `references/*/validation` is scratch, it is
gitignored, and nothing may be left behind in it. Deleting the copy is also what
undoes the two `sed` edits, which are made to it rather than to the case's own
`validation/none/`.

## The knobs

| Variable                                                 | Does                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_VALIDATION_MEDIA_DIR`                              | Where the media is written. Nothing is written without it.                                                                                                      |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES`                        | The written recording's frame cap, after the patch above. `1600` keeps every frame of a 24-second take, so the replay plays back at the 64 Hz it was driven at. |
| `TCAB_SHOWCASE_SEED`, `TCAB_SHOWCASE_PHASE`              | The take to record. Naming a seed skips the audition.                                                                                                           |
| `TCAB_SHOWCASE_SEEDS`, `TCAB_SHOWCASE_PHASES`            | The takes auditioned when no seed is named, as comma-separated lists.                                                                                           |
| `TCAB_SHOWCASE_MIN_SECONDS`, `TCAB_SHOWCASE_MAX_SECONDS` | The clip's bounds in game time. The take ends on the first settled board past the minimum, never mid-chain and never on the level-clear screen.                 |
| `TCAB_SHOWCASE_QA_STILLS`                                | `1` writes a still every two seconds, for eyeballing a take.                                                                                                    |

## Auditioning

The take is deterministic: the same seed and phase replay the identical session,
which is what lets a take be judged with the recorder off and then re-run with it
on. Running with no `TCAB_SHOWCASE_SEED` auditions every seed in
`TCAB_SHOWCASE_SEEDS` against every phase in `TCAB_SHOWCASE_PHASES`, prints what
each one did — moves, chain steps, gems cleared, the largest single step, the
deepest chain, the richest move, the most flawed gems standing at once, the
levels cleared, the longest stretch with nothing clearing, and whether it ended
settled — and records the best. A phase rotates the choice between moves the
planner rated equally, so it varies a take without ever handing the player a
worse move than the one it had.

The committed take is seed `8`, phase `1`, chosen from sixteen: twenty-three and
three quarter seconds, fourteen moves, twenty-seven chain steps, a hundred and
seventy-one stones cleared, a chain five steps deep, a single step that took
twenty-two stones off the board, a best move of seven hundred and seventy, and a
level cleared and continued from, ending settled at level two.

## What the size is

The replay is about 2.7 MB, and almost all of it is the two hundred and ninety
produced images the build draws with — the gems in their four cracked states, the
cuts, the break sheets and the effect frames — which the recording has to carry
for the console's player to draw what the build drew. The frame and operation
tables gzip to almost nothing beside them, which is why the clip runs at the full
64 frames a second rather than being thinned to buy back weight it would not buy.
