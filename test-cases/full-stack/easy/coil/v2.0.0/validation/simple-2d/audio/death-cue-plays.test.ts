// audio/death-cue-plays — the death cue sounds once, on the tick the head enters
// a fatal cell.
//
// WHAT THE SPECIFICATION FIXES. `specs/ui.md` names the event: `death` plays when
// "the head enters a fatal cell", and "each plays on the tick its event resolves,
// at most once on that tick". `specs/movement.md` puts that at step 3: "test the
// new head cell for a fatal collision. If it is fatal, the round ends and steps 4
// to 6 do not run", with "no grace tick and no second chance", and
// `specs/board.md` makes a wall cell one of the three fatal kinds.
//
// THE WORLD THIS POSES. A chain travelling east along a clear row toward the wall
// border, two ticks short of it, with the pellet off the board and the obstacle
// course cleared — so the only event the drive can resolve is the collision, and
// the two ticks before it are ordinary travel on which nothing may sound.
//
// THE FATAL CELL IS THE WALL. `specs/board.md` gives the board a border one cell
// thick on all four sides, so the cell one step east of the last interior column
// is a wall cell in every mode and under either variant's course. Which of the
// three fatal kinds ends a round is `collision/*`'s business; this point only
// needs a round to end, and the wall is the ending every build has.
//
// WHAT IS OBSERVED. Which cue sounded, by name. `specs/assets.md` binds each cue
// to its produced file through the engine's cue bus and the build plays each by
// the name `specs/ui.md` fixes, so the engine announces the name and `watchCues`
// reads it — which separates a build that plays the wrong cue at the end of a
// round from one that plays the right one. The cue is asked for whether or not
// its produced file loaded, since `specs/assets.md` leaves the game running when
// one does not arrive.
//
// THE CLIP RUNS ON PAST THE DEATH IN FRAMES RATHER THAN TICKS, because
// `specs/movement.md` stops the tick the moment a round ends: nothing advances on
// the `gameover` screen, so more ticks would be more of nothing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import { CUES, INTERIOR_COL_MAX } from "../constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  cuesNamed,
  secondFrames,
  watchCues,
  type Cell,
  type Harness,
} from "../harness";

/** Ticks of ordinary travel before the collision, on which nothing may sound. */
const LEAD_TICKS = 2;

/** Seconds of the ended round kept in the clip after the collision. */
const TRAIL_SECONDS = 0.75;

/** The last interior cell of row 8: one step east of it is the wall border. */
const BRINK: Cell = { col: INTERIOR_COL_MAX, row: 8 };

/** Where the head starts, so the wall is the cell it enters after the lead. */
const HEAD = ahead(BRINK, "left", LEAD_TICKS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the death cue once, on the tick the head enters the wall", async () => {
  arrangeStep(h, {
    head: HEAD,
    dir: "right",
    length: 3,
    pellet: null,
  });

  const cues = watchCues(h);
  const driven = await captureReplay(h, "death", async () => {
    await h.tick(LEAD_TICKS);
    const approach = [...cues];
    const lastQuietFrame = h.frame();
    const ended = await h.tick();
    const atDeath = { frame: h.frame(), played: [...cues] };
    await h.advance(secondFrames(TRAIL_SECONDS));
    return { approach, lastQuietFrame, ended, atDeath };
  });

  // The drive reached the collision: the round ended on the tick the head
  // entered the wall.
  assertEqual(
    driven.ended.screen,
    "gameover",
    "the screen after the tick the head entered the wall",
  );

  assertLength(
    cuesNamed(driven.approach, CUES.death),
    0,
    `death cues sounded over the ${LEAD_TICKS} ticks of travel before the collision`,
  );

  const deaths = cuesNamed(driven.atDeath.played, CUES.death);
  assertLength(
    deaths,
    1,
    "death cues sounded by the end of the tick the head entered the wall",
  );
  assertGreaterThan(
    deaths[0].frame,
    driven.lastQuietFrame,
    "the frame the death cue sounded on, against the last frame before the fatal tick",
  );
  assertLessThanOrEqual(
    deaths[0].frame,
    driven.atDeath.frame,
    "the frame the death cue sounded on, against the last frame of the fatal tick",
  );
});
