// Floe — audio/cue-bay: the hop that ends a crossing in a bay sounds MORE than
// the same hop taken along the row.
//
// Cue NAMES are not observable outside an engineless build; see audio/cue-hop for
// the doctrine every check here rests on. That doctrine is what shapes this
// check, because a bay-filling hop is ALSO an accepted hop: `specs/ui.md` gives
// the `hop` cue to "an accepted hop" and the `bay` cue to "a crossing ends in a
// bay", and it plays each of the cues an event raised, so the bay hop lawfully
// carries TWO cues at once. Presence alone therefore cannot tell a build that
// plays both from one that plays its hop cue and nothing else.
//
// WHAT CAN. Each cue is one defined sound, so a given cue emits the same number
// of sources every time it plays; a hop that also fills a bay therefore emits
// strictly MORE than a hop that does not. The check drives both on one posed
// strait — a hop sideways along the floe, then a hop up into the open bay — and
// holds the bay hop's emission strictly above the plain hop's.
//
// AND THE BAY IS NOT THE LEVEL'S LAST. Four bays are left open, so `specs/bays.md`
// clears no level on this hop and no `level-clear` or `victory` cue can leak into
// the count. `audio/cue-level-clear` is the point that grades that one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { BAYS, WATER_TOP } from "../constants";
import {
  captureReplay,
  createHarness,
  critterTile,
  hop,
  poseLane,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/** The bay the crossing is ended in. Any of the five decides the same rule. */
const BAY_INDEX = 2;

/** Its left column, which `specs/strait.md` fixes as one of that bay's two. */
const BAY_COL = BAYS[BAY_INDEX][0];

/**
 * The floe the approach is taken from: a `raft3`, `3` tiles by `specs/water.md`,
 * with its left edge on the bay's left column, so it carries both of the bay's
 * columns and the critter has somewhere to stand on row `2`.
 *
 * `specs/bays.md`: a crossing ends on "a hop up from row `2`", and row `2` is
 * `WATER_TOP`, so the approach has to be taken off a floe.
 */
const APPROACH_KIND = "raft3";

/**
 * A quarter second of held strait between the two hops.
 *
 * The lane is posed at a speed of `0` (`poseLane`), so nothing on the strait
 * moves through it and any sound inside it belongs to neither hop.
 */
const GAP_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds more on the hop that fills the bay than on a plain hop", async () => {
  // An empty strait, all five bays open, and one stationary raft under the bay's
  // two columns. Nothing else is on it, so every sound below is one of the hops'.
  await startCrossing(h);
  await poseLane(h, WATER_TOP, APPROACH_KIND, [BAY_COL]);
  await h.debug.addCritter(BAY_COL, WATER_TOP);
  await h.armAudio();

  const played = watchCues(h);
  const measured = await captureReplay(h, "bay", async () => {
    // A hop ALONG the row: accepted, on the same raft, ending in no bay.
    const beforePlain = played.length;
    await hop(h, "right");
    const plain = played.length - beforePlain;
    const alongside = critterTile(await h.snapshot());

    const beforeGap = played.length;
    await h.advance(GAP_TICKS);
    const gap = played.length - beforeGap;

    // And the same hop taken UP, into the open bay above it.
    const beforeBay = played.length;
    await hop(h, "up");
    const filling = played.length - beforeBay;
    const filled = await h.snapshot();

    return { plain, alongside, gap, filling, filled };
  });

  // The plain hop really was accepted, and it ended no crossing.
  assertDeepEqual(
    measured.alongside,
    { col: BAY_COL + 1, row: WATER_TOP },
    "the plain hop moved the critter one tile along the raft",
  );

  assertEqual(measured.gap, 0, "no sound on the held strait between the hops");

  // The second hop really ended the crossing in that bay, and in no other
  // (specs/bays.md).
  assertDeepEqual(
    measured.filled.bays,
    BAYS.map((_, index) => index === BAY_INDEX),
    "the hop filled that bay and no other",
  );
  assertEqual(
    measured.filled.critter.present,
    false,
    "the crossing ended, so the critter left the strait",
  );

  assertGreaterThan(
    measured.filling,
    measured.plain,
    `the bay-filling hop plays its cue on top of the hop's ` +
      `(${measured.plain} sound(s) on the plain hop)`,
  );
});
