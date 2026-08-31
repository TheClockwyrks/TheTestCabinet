// Floe — audio/cue-caught: the bear reaching the critter plays the caught cue,
// and the bear held one tile off plays none.
//
// The cue is read BY NAME off the engine's bus; see audio/cue-hop for the reading
// every check in this directory rests on.
//
// THE RULE THIS POINT DECIDES. `specs/ui.md`: the `caught` cue plays when "a bear
// catches the critter". `specs/hunter.md` fixes when that is — the straight-line
// distance between the two centres is at most `BEAR_CATCH_DIST` (`18`) stage
// units — and `specs/instrumentation.md` puts that faculty behind `setCatchTest`,
// the one world gate this item's requirement IS, so it is the one gate this check
// turns back on.
//
// THE BEAR IS POSED WITH ONLY THE FACULTY THE CATCH NEEDS. `specs/hunter.md`
// gives a bear a sense, a routing and a travel, and a catch needs none of the
// first two: the bear is settled one tile from the critter with its sense and its
// routing OFF, so it hunts nothing and chooses nothing, and its travel is turned
// on together with one step committed by hand. The silent window is driven while
// its travel is still off, so nothing but this check decides when it moves.
//
// THE SILENT WINDOW IS A REAL PART OF THE RULE. A settled bear one tile away is
// `TILE` (`32`) units from the critter's centre, comfortably outside
// `BEAR_CATCH_DIST`, and the snapshot's own centres are read back to prove it. A
// build that plays the cue while a bear is merely near the critter is heard there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength, fail } from "../assert";
import {
  BEAR_CATCH_DIST,
  CUES,
  START_COL,
  START_LIVES,
  TILE,
  bearIceSpeed,
} from "../../src/constants";
import {
  bearById,
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";

/**
 * The ice-band row the catch is posed on.
 *
 * Any row a bear and the critter can both stand on decides the same rule; the
 * middle of the ice band is taken so the bear's one step stays on ice footing,
 * which is the speed the window below is sized against.
 */
const CATCH_ROW = 15;

/** A quarter second with the bear held still, proving one tile apart is silent. */
const QUIET_TICKS = ticksFor(0.25);

/**
 * How long the bear is given to close on the critter, in seconds.
 *
 * A whole tile of travel at the level-1 ice speed `specs/hunter.md` fixes
 * (`BEAR_ICE_SPEED`, `3` tiles a second), plus a quarter second. A whole tile is
 * further than it needs — the catch lands as soon as the gap reaches
 * `BEAR_CATCH_DIST`, which is a little over half the tile — so the window carries
 * a build whose bear is slower than the specification's without turning this
 * point into a check on that speed.
 */
const CLOSE_TICKS = ticksFor(1 / bearIceSpeed(1) + 0.25);

/** How many times `cue` sounded in `played`, from index `from` on. */
function sounded(
  played: readonly TimedCue[],
  from: number,
  cue: string,
): number {
  return played.slice(from).filter((entry) => entry.cue === cue).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the caught cue when the bear reaches the critter, and not while it is a tile off", async () => {
  // An empty strait carrying one critter and one bear, the bear settled on the
  // tile beside it with every faculty of its own held off.
  startCrossing(h);
  h.debug.addCritter(START_COL, CATCH_ROW);
  const bear = poseBear(h, START_COL - 1, CATCH_ROW, {
    sense: false,
    routing: false,
    travel: false,
  });
  // The one gate this item's requirement is (specs/instrumentation.md).
  h.debug.setCatchTest(true);

  const played = watchCues(h);
  const measured = await captureReplay(h, "caught", async () => {
    const beforeQuiet = played.length;
    await h.advance(QUIET_TICKS);
    const quiet = sounded(played, beforeQuiet, CUES.caught);
    const apart = h.snapshot();

    h.debug.setBearTravel(bear, true);
    h.debug.setBearStep(bear, "right");

    const beforeClose = played.length;
    await h.advance(CLOSE_TICKS);
    const closing = played
      .slice(beforeClose)
      .filter((entry) => entry.cue === CUES.caught);
    const caught = h.snapshot();

    return { quiet, apart, closing, caught };
  });

  // The held bear really was outside the catch distance the whole time.
  const held = bearById(measured.apart, bear);
  if (held === undefined) {
    fail(
      `the posed bear ${bear} on the strait (specs/instrumentation.md)`,
      "no bear carries that id",
    );
  }
  const gap = Math.hypot(
    held.x - measured.apart.critter.x,
    held.y - measured.apart.critter.y,
  );
  assertGreaterThan(
    gap,
    BEAR_CATCH_DIST,
    `a bear settled one tile (${TILE} units) away is outside the catch`,
  );
  assertEqual(measured.apart.lives, START_LIVES, "the held bear cost no life");
  assertEqual(
    measured.quiet,
    0,
    "no caught cue while the bear is held a tile off",
  );

  // And then it really did catch (specs/hunter.md, specs/progression.md).
  assertEqual(measured.caught.lives, START_LIVES - 1, "the catch cost a life");
  assertEqual(
    measured.caught.phase,
    "dying",
    "the catch opened the death hold",
  );
  assertLength(
    measured.closing,
    1,
    "caught cues played as the bear reached the critter",
  );
});
