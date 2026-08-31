// bays/filled-stays-filled — a bay filled by one crossing is still filled when
// the next crossing fills a different one.
//
// specs/bays.md: "A bay filled this way stays filled through every later crossing
// of the level, and through a death." This point is the LATER CROSSING half of
// that rule; `progression/bays-survive-death` is the death half.
//
// Two bays are filled by two real hops, in two separate crossings, with the
// bay-fill hold run out between them so the second hop really is taken by the
// fresh critter the first fill produced. The pair is bay `0` and bay `4`, the two
// ends of the far shore, so a build that keeps only the most recent fill, or that
// shifts what it keeps by a bay, reads a different array from the one below.
//
// Nothing between the two hops touches a bay: the second crossing is arranged
// with the same operations the first was, and neither `setBay` nor `clearBays` is
// called anywhere in this file.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BAYFILL_PAUSE, BAY_COUNT } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  keyFor,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { poseAtBayMouth } from "./bay-mouth";

/** The bay the first crossing fills, and the bay the second one fills. */
const FIRST_BAY = 0;
const SECOND_BAY = 4;

/** Both filled and the middle three still open. */
const EXPECTED: boolean[] = Array.from(
  { length: BAY_COUNT },
  (_, index) => index === FIRST_BAY || index === SECOND_BAY,
);

/** The bay-fill hold, plus the one frame of room `fill-starts-fresh-crossing` derives. */
const HOLD_FRAMES = ticksFor(BAYFILL_PAUSE) + 1;

/** Frames of the second hold recorded after the second hop, for the replay alone. */
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the first bay filled when a second crossing fills another", async () => {
  startCrossing(h);

  // The first crossing, and the hold it opens, so the second hop is taken by the
  // fresh critter rather than by a critter posed back onto the strait.
  poseAtBayMouth(h, FIRST_BAY);
  await h.tap(keyFor("up"));
  await h.advance(HOLD_FRAMES);
  const between = h.snapshot();
  assertEqual(between.bays[FIRST_BAY], true, `bay ${FIRST_BAY} filled`);
  assertEqual(
    between.critter.present,
    true,
    "a critter for the second crossing",
  );

  // The second crossing. The first crossing's floe goes with it: the arrangement
  // this one needs is a floe at the OTHER bay's mouth, and leaving the old one
  // lying on the row would put a platform on the strait nothing asked for.
  h.debug.clearFloes();
  poseAtBayMouth(h, SECOND_BAY);

  const both = await captureReplay(h, "fill", async () => {
    await h.tap(keyFor("up"));
    const landed = h.snapshot();
    await h.advance(AFTER_FRAMES);
    return landed;
  });

  assertDeepEqual(
    both.bays,
    EXPECTED,
    "both ends filled, the middle three open",
  );
});
