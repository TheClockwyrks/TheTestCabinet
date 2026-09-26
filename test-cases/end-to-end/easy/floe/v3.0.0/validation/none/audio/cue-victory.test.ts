// Floe — audio/cue-victory: the hop that wins the run sounds more than the bay
// fill before it.
//
// Cue NAMES are not observable outside an engineless build; see audio/cue-hop for
// the doctrine every check here rests on. The winning hop is an accepted hop AND
// a bay fill AND the end of the run — `specs/bays.md` clears a level on "the hop
// that fills its last open bay" and `specs/progression.md` wins the run when that
// happens at `TOTAL_LEVELS` — so it lawfully carries several cues at once and
// presence alone cannot tell it from a hop that only fills a bay.
//
// WHAT CAN. Each cue is one defined sound, emitting the same number of sources
// every time it plays, so the winning hop emits strictly MORE than the plain bay
// fill before it. The check drives both on one posed strait at level `8`, from a
// stationary raft under each of the two bays left open, so the two hops are the
// same hop and the only difference between them is that the second wins the run.
//
// `specs/ui.md` gives the run being won its OWN cue, separate from a level being
// cleared, which is why this point and `audio/cue-level-clear` are two points and
// why this one is driven at `TOTAL_LEVELS` and that one below it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
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
const HOLD_TICKS = ticksPast(BAYFILL_PAUSE) + ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds more on the hop that wins the run than on the bay fill before it", async () => {
  // An empty strait at the last level, three bays posed filled, and a stationary
  // raft under each of the two that are left.
  await startCrossing(h, TOTAL_LEVELS);
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
  const measured = await captureReplay(h, "victory", async () => {
    // The fill that leaves one bay open: the run is not won (specs/bays.md).
    const beforeFill = played.length;
    await hop(h, "up");
    const fill = played.length - beforeFill;
    const afterFill = await h.snapshot();

    // The hold out, and a fresh crossing from it. Nothing here raises an event.
    const beforeHold = played.length;
    await h.advance(HOLD_TICKS);
    const hold = played.length - beforeHold;
    const fresh = await h.snapshot();

    // The same hop again, into the last open bay of the last level.
    await h.debug.addCritter(BAYS[LAST_BAY][0], WATER_TOP);
    const beforeWin = played.length;
    await hop(h, "up");
    const win = played.length - beforeWin;
    const won = await h.snapshot();

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

  // The hold really ran out into a fresh crossing, silently.
  assertEqual(measured.hold, 0, "no sound over the bay-fill hold");
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

  assertGreaterThan(
    measured.win,
    measured.fill,
    `the winning hop plays its sting on top of the bay fill's ` +
      `(${measured.fill} sound(s) on the fill that won nothing)`,
  );
});
