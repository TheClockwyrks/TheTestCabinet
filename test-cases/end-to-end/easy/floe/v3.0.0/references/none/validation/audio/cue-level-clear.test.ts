// Floe — audio/cue-level-clear: the hop that fills the level's LAST open bay
// sounds more than the hop that filled the one before it.
//
// Cue NAMES are not observable outside an engineless build; see audio/cue-hop for
// the doctrine every check here rests on. Here it bites twice over, because a
// level-clearing hop is an accepted hop AND a bay fill AND a clear:
// `specs/bays.md` makes "a level cleared by the hop that fills its last open
// bay", so the clearing hop lawfully carries THREE cues and presence alone cannot
// tell it from a hop that carries the first two.
//
// WHAT CAN. Each cue is one defined sound, emitting the same number of sources
// every time it plays, so a hop that also clears the level emits strictly MORE
// than a hop that only fills a bay. The check drives BOTH on one posed strait,
// and makes them as alike as it can: three bays are posed filled, and the critter
// is stood on a stationary raft under each of the two that are left, so each hop
// is the same hop up into an open bay. The only difference between them is that
// the second one takes the last bay.
//
// AND THE LEVEL IS BELOW `TOTAL_LEVELS`, which is what the review item says: at
// level `8` the run is won instead and `specs/ui.md` gives that its own cue, which
// `audio/cue-victory` grades.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";
import {
  BAYFILL_PAUSE,
  BAYS,
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
  ticksPast,
  watchCues,
  type Harness,
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
const HOLD_TICKS = ticksPast(BAYFILL_PAUSE) + ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds more on the hop that clears the level than on the bay fill before it", async () => {
  // An empty strait at a level below the last, three bays posed filled, and a
  // stationary raft under each of the two that are left.
  await startCrossing(h, LEVEL);
  for (const index of BAYS.keys()) {
    if (index !== FIRST_BAY && index !== LAST_BAY) {
      await h.debug.setBay(index, true);
    }
  }
  await poseLane(h, WATER_TOP, APPROACH_KIND, [
    BAYS[FIRST_BAY][0],
    BAYS[LAST_BAY][0],
  ]);
  await h.debug.addCritter(BAYS[FIRST_BAY][0], WATER_TOP);
  await h.armAudio();

  const played = watchCues(h);
  const measured = await captureReplay(h, "clear", async () => {
    // The fill that leaves one bay open: no clear (specs/bays.md).
    const beforeFill = played.length;
    await hop(h, "up");
    const fill = played.length - beforeFill;
    const afterFill = await h.snapshot();

    // The hold out, and a fresh crossing from it. Nothing here raises an event.
    const beforeHold = played.length;
    await h.advance(HOLD_TICKS);
    const hold = played.length - beforeHold;
    const fresh = await h.snapshot();

    // The same hop again, into the level's last open bay.
    await h.debug.addCritter(BAYS[LAST_BAY][0], WATER_TOP);
    const beforeClear = played.length;
    await hop(h, "up");
    const clear = played.length - beforeClear;
    const cleared = await h.snapshot();

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

  // The hold really ran out into a fresh crossing, silently.
  assertEqual(measured.hold, 0, "no sound over the bay-fill hold");
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

  assertGreaterThan(
    measured.clear,
    measured.fill,
    `the clearing hop plays its cue on top of the bay fill's ` +
      `(${measured.fill} sound(s) on the fill that cleared nothing)`,
  );
});
