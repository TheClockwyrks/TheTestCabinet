// Floe — audio/cue-victory: the hop that wins the run plays the victory cue, and
// the bay fill before it plays none.
//
// The cue is read BY NAME off the engine's bus; see audio/cue-hop for the reading
// every check in this directory rests on. The winning hop is an accepted hop AND
// a bay fill AND the end of the run — `specs/bays.md` clears a level on "the hop
// that fills its last open bay" and `specs/progression.md` wins the run when that
// happens at `TOTAL_LEVELS` — so it lawfully plays several cues at once and only
// the NAME separates the one this point is about from the others.
//
// THE PLAIN BAY FILL IS THE CONTROL, and the two hops are made as alike as they
// can be: three bays are posed filled at level `8`, and the critter is stood on a
// stationary raft under each of the two that are left, so each hop is the same
// hop up into an open bay. The only difference between them is that the second
// one wins the run — so a build that plays the victory sting on every bay fill,
// or on every level cleared, is heard on the first one.
//
// `specs/ui.md` gives the run being won its OWN cue, separate from a level being
// cleared, which is why this point and `audio/cue-level-clear` are two points and
// why this one is driven at `TOTAL_LEVELS` and that one below it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  BAYFILL_PAUSE,
  BAYS,
  CUES,
  ROW_NEAR,
  START_COL,
  TOTAL_LEVELS,
  WATER_TOP,
} from "../../src/constants";
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

/** The bay filled first, which leaves one open and wins nothing. */
const FIRST_BAY = 3;

/** The bay filled second: the last open bay of the last level. */
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

it("plays the victory cue on the hop that wins the run, and not on the bay fill before it", async () => {
  // An empty strait at the last level, three bays posed filled, and a stationary
  // raft under each of the two that are left.
  startCrossing(h, TOTAL_LEVELS);
  for (const index of BAYS.keys()) {
    if (index !== FIRST_BAY && index !== LAST_BAY) h.debug.setBay(index, true);
  }
  poseLane(h, WATER_TOP, APPROACH_KIND, [
    BAYS[FIRST_BAY][0],
    BAYS[LAST_BAY][0],
  ]);
  h.debug.addCritter(BAYS[FIRST_BAY][0], WATER_TOP);

  const played = watchCues(h);
  const measured = await captureReplay(h, "victory", async () => {
    // The fill that leaves one bay open: the run is not won (specs/bays.md).
    const beforeFill = played.length;
    await hop(h, "up");
    const fill = sounded(played, beforeFill, CUES.victory);
    const afterFill = h.snapshot();

    // The hold out, and a fresh crossing from it. Nothing here raises an event.
    const beforeHold = played.length;
    await h.advance(HOLD_TICKS);
    const hold = sounded(played, beforeHold, CUES.victory);
    const fresh = h.snapshot();

    // The same hop again, into the last open bay of the last level.
    h.debug.addCritter(BAYS[LAST_BAY][0], WATER_TOP);
    const beforeWin = played.length;
    await hop(h, "up");
    const win = played
      .slice(beforeWin)
      .filter((entry) => entry.cue === CUES.victory);
    const won = h.snapshot();

    return { fill, afterFill, hold, fresh, win, won };
  });

  // The first hop really filled its bay and won nothing.
  assertEqual(
    measured.afterFill.bays[FIRST_BAY],
    true,
    "the first hop filled its bay",
  );
  assertEqual(
    measured.afterFill.screen,
    "playing",
    "one bay is still open, so the run is still being played",
  );
  assertEqual(measured.fill, 0, "no victory cue on the fill that won nothing");

  // The hold really ran out into a fresh crossing, with no cue of its own.
  assertEqual(measured.hold, 0, "no victory cue over the bay-fill hold");
  assertDeepEqual(
    { col: measured.fresh.critter.col, row: measured.fresh.critter.row },
    { col: START_COL, row: ROW_NEAR },
    "a fresh crossing began from the near shore",
  );
  assertEqual(
    measured.fresh.level,
    TOTAL_LEVELS,
    "the fresh crossing is still on the last level",
  );

  // And the second hop really won the run (specs/progression.md).
  assertDeepEqual(
    measured.won.bays,
    BAYS.map(() => true),
    "the second hop filled the last level's last open bay",
  );
  assertEqual(measured.won.screen, "victory", "the run was won on that hop");

  assertLength(
    measured.win,
    1,
    "victory cues played on the hop that won the run",
  );
});
