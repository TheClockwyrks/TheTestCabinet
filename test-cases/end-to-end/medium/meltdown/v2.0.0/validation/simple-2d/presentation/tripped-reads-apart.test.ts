// presentation/tripped-reads-apart — an offline tower is unmistakable.
//
// THE RULE. specs/overview.md's legibility table: "A tripped tower is
// unmistakable and reads apart from an online tower at the same heat."
// specs/heat.md is what makes the qualification load-bearing: a tripped emitter
// "fires nothing and acquires no target for the whole of its cooldown" and takes
// part in no term of the frame's resolution, so it is doing nothing at all for
// five seconds while the surge walks past it. A player looking at a floor of hot
// towers has to pick it out — and if a build says "tripped" only by drawing the
// tower hotter, there is nothing to pick out, because an online tower reaches the
// same heat on its way there.
//
// AT THE SAME HEAT, WHICH IS WHY THE PAIR IS POSED THIS WAY. The two readings are
// the SAME TYPE on the SAME TILE at the SAME heat on two consecutive frames, one
// tripped and one not. So the heat cannot account for the difference, the tile
// cannot, and the type cannot: the only thing that changed is the state the point
// is about. A build that draws its trip as a point on the heat ramp reads zero,
// and that is the wrong model this arrangement is posed to name.
//
// The heat is held where the pose put it. The trip is a CROSSING, not a value
// (specs/heat.md), so the tripped tower is posed rather than manufactured; and a
// real tripped tower would be bleeding to `0` at 20 a second, so both towers hold
// the thermal faculty (presentation/pose.ts) and both are still carrying the same
// heat on the frame that draws them.
//
// WHAT IS DECIDED, AND WHERE THE BAR COMES FROM. specs/overview.md fixes no
// palette, and in particular it does not say a tripped tower is red — how
// unmistakable the trip looks is the reviewer's to judge. What is decided here is
// that the build drew something for it: the same body ring on the same tile,
// online and tripped. How far that ring moves on its own is measured, by reading
// it on two frames while the tower is online, and the trip has to beat that by
// `NOISE_MARGIN`. The ring rather than the whole footprint, because specs/hud.md
// lets a build put its heat read on the footprint and `hud.on-floor-heat-read` is
// the point that grades it.
//
// WHAT IT DOES NOT DECIDE. That the tower actually goes offline, bleeds its heat
// and comes back after `TRIP_TIME` are the `trip` group's; that the trip plays a
// cue is `audio.trip-cue`; that the colour tracks the heat while ONLINE is
// `heat-glow-ramp`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import type { TowerType } from "../surface";
import { poseStillTower, poseStillTrippedTower } from "./pose";
import { NOISE_MARGIN, bodyRing, largestShift, readPoints } from "./read";

/**
 * The tower the pair is read on, where it stands, and the heat both carry.
 *
 * The Lance, because its 4x4 footprint is the largest in the roster. The heat is
 * in the middle of the band where the two states are genuinely confusable: high
 * enough that an online tower is well up its own ramp, and below the `100` at
 * which the trip happens, so neither reading is at an end of the scale.
 */
const TYPE: TowerType = "lance";
const COL = 8;
const ROW = 22;
const HEAT = 60;

/** The ring inside the tower's body every reading here is taken on. */
const RING = bodyRing(COL, ROW, sizeOf(TYPE));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a tripped tower apart from an online one at the same heat", async () => {
  startRun(h);
  poseStillTower(h, TYPE, COL, ROW, 0, HEAT);
  await h.advance(1);
  const first = readPoints(h, RING);
  await h.advance(1);
  captureStill(h, "online");
  const online = readPoints(h, RING);
  const noise = largestShift(first, online);

  // The same type on the same tile at the same heat, offline this time.
  startRun(h);
  poseStillTrippedTower(h, TYPE, COL, ROW, HEAT);
  await h.advance(1);
  captureStill(h, "tripped");
  const tripped = readPoints(h, RING);

  assertGreaterThanOrEqual(
    largestShift(online, tripped),
    noise + NOISE_MARGIN,
    `an online ${TYPE} at heat ${HEAT} against a tripped ${TYPE} at the same ` +
      `heat on the same tile: its body ring is drawn differently, by more ` +
      `than the ${noise} two frames of it running moved on their own ` +
      `(specs/overview.md: a tripped tower is unmistakable and reads apart ` +
      `from an online tower at the same heat)`,
  );
});
