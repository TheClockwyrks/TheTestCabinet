// Floe — audio/cue-level-clear: the hop that fills the level's LAST open bay
// plays the level-clear cue, and the hop that filled the one before it plays
// none.
//
// The cue is read BY NAME off the engine's bus; see audio/cue-hop for the reading
// every check in this directory rests on. Here the names matter twice over,
// because a level-clearing hop is an accepted hop AND a bay fill AND a clear:
// `specs/bays.md` makes "a level cleared by the hop that fills its last open
// bay", so the clearing hop lawfully plays three cues at once and only the NAME
// separates the one this point is about from the two beside it.
//
// THE PLAIN BAY FILL IS THE CONTROL, and the two hops are made as alike as they
// can be: three bays are posed filled, and the critter is stood on a stationary
// raft under each of the two that are left, so each hop is the same hop up into
// an open bay off the same kind of floe. The only difference between them is that
// the second one takes the LAST bay — so a build that plays the level-clear cue
// on every bay fill is heard on the first one.
//
// AND THE LEVEL IS BELOW `TOTAL_LEVELS`, which is what the rule says: at level `8`
// the run is won instead and `specs/ui.md` gives that its own cue, which
// `audio/cue-victory` grades.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertLessThan,
} from "../assert";
import {
  BAYFILL_PAUSE,
  BAYS,
  CUES,
  ROW_NEAR,
  START_COL,
  TOTAL_LEVELS,
  WATER_TOP,
} from "../constants";
import {
  captureReplay,
  createHarness,
  hop,
  poseLane,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";

/** The level the clear is driven on: below `TOTAL_LEVELS`, as the rule says. */
const LEVEL = 1;

/** The bay filled first, which leaves one open and clears nothing. */
const FIRST_BAY = 3;

/** The bay filled second: the level's last open one. */
const LAST_BAY = 4;

/** The floe each approach is taken from — `3` tiles by `specs/water.md`. */
const APPROACH_KIND = "raft3";

/**
 * Ticks driven to carry the bay-fill hold out.
 *
 * `specs/progression.md` holds `BAYFILL_PAUSE` (`0.5` s) after a bay is filled
 * and begins a fresh crossing when it expires, and `specs/bays.md` puts the
 * critter out of play for the whole of it, so the second approach cannot be posed
 * until the hold has run. A tenth of a second past it, so the verdict cannot turn
 * on where a tick boundary fell.
 */
const HOLD_TICKS = ticksFor(BAYFILL_PAUSE + 0.1);

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

it("plays the level-clear cue on the hop that fills the last open bay, and not on the fill before it", async () => {
  // An empty strait at a level below the last, three bays posed filled, and a
  // stationary raft under each of the two that are left.
  startCrossing(h, LEVEL);
  for (const index of BAYS.keys()) {
    if (index !== FIRST_BAY && index !== LAST_BAY) h.debug.setBay(index, true);
  }
  poseLane(h, WATER_TOP, APPROACH_KIND, [
    BAYS[FIRST_BAY][0],
    BAYS[LAST_BAY][0],
  ]);
  h.debug.addCritter(BAYS[FIRST_BAY][0], WATER_TOP);

  const played = watchCues(h);
  const measured = await captureReplay(h, "clear", async () => {
    // The fill that leaves one bay open: no clear (specs/bays.md).
    const beforeFill = played.length;
    await hop(h, "up");
    const fill = sounded(played, beforeFill, CUES.levelClear);
    const afterFill = h.snapshot();

    // The hold out, and a fresh crossing from it. Nothing here raises an event.
    const beforeHold = played.length;
    await h.advance(HOLD_TICKS);
    const hold = sounded(played, beforeHold, CUES.levelClear);
    const fresh = h.snapshot();

    // The same hop again, into the level's last open bay. `addCritter` puts it
    // there with its cooldown at `0` (specs/instrumentation.md), so the cadence
    // `specs/hopping.md` fixes cannot refuse this hop.
    h.debug.addCritter(BAYS[LAST_BAY][0], WATER_TOP);
    const beforeClear = played.length;
    await hop(h, "up");
    const clear = played
      .slice(beforeClear)
      .filter((entry) => entry.cue === CUES.levelClear);
    const cleared = h.snapshot();

    return { fill, afterFill, hold, fresh, clear, cleared };
  });

  // The first hop really filled its bay and cleared nothing.
  assertEqual(
    measured.afterFill.bays[FIRST_BAY],
    true,
    "the first hop filled its bay",
  );
  assertEqual(
    measured.afterFill.phase,
    "crossing",
    "one bay is still open, so no level cleared",
  );
  assertEqual(
    measured.fill,
    0,
    "no level-clear cue on the fill that cleared nothing",
  );

  // The hold really ran out into a fresh crossing, with no cue of its own.
  assertEqual(measured.hold, 0, "no level-clear cue over the bay-fill hold");
  assertDeepEqual(
    { col: measured.fresh.critter.col, row: measured.fresh.critter.row },
    { col: START_COL, row: ROW_NEAR },
    "a fresh crossing began from the near shore",
  );

  // And the second hop really cleared the level (specs/bays.md,
  // specs/progression.md).
  assertDeepEqual(
    measured.cleared.bays,
    BAYS.map(() => true),
    "the second hop filled the level's last open bay",
  );
  assertEqual(
    measured.cleared.phase,
    "clearing",
    "the last bay opened the level-clear hold",
  );
  assertLessThan(
    measured.cleared.level,
    TOTAL_LEVELS,
    "the level cleared was below the last one",
  );

  assertLength(
    measured.clear,
    1,
    "level-clear cues played on the hop that cleared the level",
  );
});
