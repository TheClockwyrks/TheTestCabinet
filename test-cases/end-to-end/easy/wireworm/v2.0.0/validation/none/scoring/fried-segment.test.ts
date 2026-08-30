// scoring/fried-segment — a discharge pays 10 for every segment it destroys.
//
// `specs/scoring.md`'s table: "A discharge destroys a worm segment" pays
// `SCORE_FRY` (`10`), and the paragraph under it: the figure is paid "for every
// segment a discharge destroys, whatever its place in the chain".
//
// WHY THIS POINT READS A DIFFERENCE RATHER THAN A TOTAL. A discharge always
// removes at least the node the bolt detonated, and `specs/scoring.md` pays
// `SCORE_PURGE_NODE` for that (`scoring.purge-node`). So there is no scenario in
// which the score's whole movement is the fry figure, and a point that asserted a
// total would be asserting the purge figure too — a build with correct frying and
// a wrong purge would fail both items, and a grade could no longer say which one
// the build got wrong. Two discharges are driven instead, each detonating exactly
// one node and so paying exactly the same purge, and the DIFFERENCE between what
// they paid is the fry figure alone.
//
// THE TWO WORMS DIFFER BY EXACTLY TWO SEGMENTS IN REACH, AND BY NOTHING ELSE.
// Each is laid as a ramp running outward from its detonation, one segment at each
// Chebyshev distance from `1` to `5`; the second worm carries two further
// segments at distance `1`. So however far a build's blast actually reaches, both
// worms lose the same number of ramp segments and the second loses those two on
// top — the difference is `2` at every reach from `1` to `4`, and the point turns
// on the figure rather than on the reach `discharge.fries-segments-in-reach`
// grades. The far end of each ramp is what keeps a worm on the board through its
// own discharge, so no board ever empties and no level-clear bonus enters the
// reading (`specs/progression.md`).
//
// The two scenarios are staged far enough apart that neither discharge can touch
// the other's worm: `DISCHARGE_RADIUS` (`2`) reaches two rows, and eight rows
// separate them.
//
// WHAT EVERY WRONG MODEL READS. A build that pays the figure once per discharge
// rather than once per segment reads `0`; one that pays the head figure for the
// leading segment it fries reads `110`; one that pays nothing for a fried segment
// reads `0`. Each is a different number from `20`.
//
// The worms' own faculties are off. This point is about what a discharge PAYS,
// not about where a worm walks, so both are posed holding their tiles.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_FRY } from "../constants";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { detonateAt } from "./payment";

/** The first discharge, and the ramp beside it: one segment at each distance 1..5. */
const FIRST_STRUCK = { c: 10, r: 4 };
const FIRST_CHAIN = [
  { c: 11, r: 4 },
  { c: 12, r: 4 },
  { c: 13, r: 4 },
  { c: 14, r: 4 },
  { c: 15, r: 4 },
] as const;

/**
 * The second discharge, and the same ramp with two extra segments at distance
 * `1`: `(11, 11)` and `(11, 13)` flank `(11, 12)`, and the chain leaves the
 * cluster along row `13`.
 */
const SECOND_STRUCK = { c: 10, r: 12 };
const SECOND_CHAIN = [
  { c: 11, r: 11 },
  { c: 11, r: 12 },
  { c: 11, r: 13 },
  { c: 12, r: 13 },
  { c: 13, r: 13 },
  { c: 14, r: 13 },
  { c: 15, r: 13 },
] as const;

/** Heading left, so each chain trails away from its head, where it is laid. */
const HEADING = -1;

/** How many more segments the second discharge destroys than the first. */
const EXTRA_SEGMENTS = SECOND_CHAIN.length - FIRST_CHAIN.length;

/**
 * What those extra segments must add to the second discharge's payment.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = EXTRA_SEGMENTS * SCORE_FRY;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays 10 for each further segment a discharge destroys", async () => {
  await startPlaying(h);
  await poseWorm(h, {
    c: FIRST_CHAIN[0].c,
    r: FIRST_CHAIN[0].r,
    segments: FIRST_CHAIN,
    dh: HEADING,
    stepping: false,
    body: false,
  });
  await poseWorm(h, {
    c: SECOND_CHAIN[0].c,
    r: SECOND_CHAIN[0].r,
    segments: SECOND_CHAIN,
    dh: HEADING,
    stepping: false,
    body: false,
  });

  const start = (await h.snapshot()).score;
  await detonateAt(h, FIRST_STRUCK.c, FIRST_STRUCK.r);
  const between = (await h.snapshot()).score;
  await detonateAt(h, SECOND_STRUCK.c, SECOND_STRUCK.r);

  await captureStill(h, "scored");
  const end = (await h.snapshot()).score;
  assertEqual(
    end - between - (between - start),
    EXPECTED,
    "the extra points the discharge over two further segments paid",
  );
});
