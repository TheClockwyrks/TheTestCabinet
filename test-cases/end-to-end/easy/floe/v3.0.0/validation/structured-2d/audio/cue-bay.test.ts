// Floe — audio/cue-bay: the hop that ends a crossing in an open bay plays the bay
// cue, and the same hop taken along the row plays none.
//
// The cue is read BY NAME off the engine's bus; see audio/cue-hop for the reading
// every check in this directory rests on. That reading is what lets this point be
// decided cleanly, because a bay-filling hop is ALSO an accepted hop:
// `specs/ui.md` gives the `hop` cue to "an accepted hop" and the `bay` cue to "a
// crossing ends in a bay", so the bay hop lawfully plays TWO cues at once and only
// the NAME separates them.
//
// THE PLAIN HOP IS THE CONTROL. Both hops are taken from the same raft, a quarter
// second of the same game apart, and the only difference between them is that the
// second lands in an open bay. So a build that plays the bay cue on every accepted
// hop — which is the wrong model this control exists to catch — is heard on the
// first one.
//
// AND THE BAY IS NOT THE LEVEL'S LAST. Four bays are left open, so `specs/bays.md`
// clears no level on this hop and nothing about a clear or a win can reach the
// count. `audio/cue-level-clear` and `audio/cue-victory` are the points that grade
// those.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { BAYS, CUES, WATER_TOP } from "../constants";
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
  type TimedCue,
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
 * Twice `HOP_COOLDOWN` (`0.12` s), so the second hop is offered a critter whose
 * cooldown has reached `0` (`specs/hopping.md`) rather than one the cadence would
 * refuse. The lane is posed at a speed of `0` ({@link poseLane}), so nothing on
 * the strait moves through the window and any cue inside it belongs to neither
 * hop.
 */
const GAP_TICKS = ticksFor(0.25);

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

it("plays the bay cue on the hop into the open bay, and not on a hop along the row", async () => {
  // An empty strait, all five bays open, and one stationary raft under the bay's
  // two columns. Nothing else is on it, so nothing else can raise an event.
  startCrossing(h);
  poseLane(h, WATER_TOP, APPROACH_KIND, [BAY_COL]);
  h.debug.addCritter(BAY_COL, WATER_TOP);

  const played = watchCues(h);
  const measured = await captureReplay(h, "bay", async () => {
    // A hop ALONG the row: accepted, on the same raft, ending in no bay.
    const beforePlain = played.length;
    await hop(h, "right");
    const plain = sounded(played, beforePlain, CUES.bay);
    const alongside = critterTile(h.snapshot());

    const beforeGap = played.length;
    await h.advance(GAP_TICKS);
    const gap = sounded(played, beforeGap, CUES.bay);

    // And the same hop taken UP, into the open bay above it.
    const beforeBay = played.length;
    await hop(h, "up");
    const filling = played
      .slice(beforeBay)
      .filter((entry) => entry.cue === CUES.bay);
    const filled = h.snapshot();

    return { plain, alongside, gap, filling, filled };
  });

  // The plain hop really was accepted, and it ended no crossing.
  assertDeepEqual(
    measured.alongside,
    { col: BAY_COL + 1, row: WATER_TOP },
    "the plain hop moved the critter one tile along the raft",
  );
  assertEqual(measured.plain, 0, "no bay cue on the hop along the row");
  assertEqual(
    measured.gap,
    0,
    "no bay cue on the held strait between the hops",
  );

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

  assertLength(
    measured.filling,
    1,
    "bay cues played on the hop that filled the bay",
  );
});
