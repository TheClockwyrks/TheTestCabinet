// Meltdown — heat/mass-divides-the-cooling: mass divides the cooling too.
//
// specs/heat.md divides the WHOLE of a frame's change by the tower's thermal
// mass — `dH_T = (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) /
// mass(T)` — and says what that means: "mass changes how fast a tower answers a
// flow and never where it settles". So it divides a loss exactly as it divides a
// gain, and two towers with the SAME face layout at the same heat cool in inverse
// proportion to their masses.
//
// THE PAIR IS THE ARC AND THE FLAK, because specs/towers.md gives them the same
// 2x2 footprint and the same radiator faces, N and S, and different masses: `1.0`
// against `0.9`. Their air-loss coefficient is therefore identical — four
// radiator edge-tiles and four plain ones each — and the only thing left to
// separate their losses is the mass. Posed at the same heat, at two quiet anchors
// far enough apart that neither conducts with the other and both have all four
// faces on open floor.
//
// The reading is the ratio of the two losses, over one frame each: what either
// loss comes to on its own is `heat/air-cooling-rate`'s requirement. A build that
// never divides by mass reads a ratio of `1` where the specification requires
// `0.9`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { massOf } from "./roster";
import { freeSite } from "./sites";

/** Two 2x2 emitters with radiator faces N and S, and different masses. */
const HEAVY = "arc";
const LIGHT = "flak";

/** The heat both are posed at; the coefficient is the same, so it cancels. */
const HEAT = 80;

/** What the specification requires: the heavy tower's loss over the light one's. */
const EXPECTED_RATIO = massOf(LIGHT) / massOf(HEAVY);

/**
 * How close the ratio must come, as decimal places.
 *
 * Two places is `0.005`, half of one percent of the `0.9` required. Both losses
 * are one frame of a build's own arithmetic over identical face layouts at
 * identical heats, so a conformant build lands on `0.9` to within float slack.
 * The bound is twenty times smaller than the distance to the wrong model this
 * item exists to name: cooling that ignores mass reads `1.0`.
 */
const RATIO_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Mass divides the cooling too", async () => {
  startRun(h);
  const heavySite = freeSite(0);
  const lightSite = freeSite(1);
  const heavy = poseIdleTower(h, HEAVY, heavySite.col, heavySite.row, 0, HEAT);
  const light = poseIdleTower(h, LIGHT, lightSite.col, lightSite.row, 0, HEAT);

  await h.advance(1);
  captureStill(h, "cooling");
  const cooled = h.snapshot();
  const heavyLoss = HEAT - towerOf(cooled, heavy).heat;
  const lightLoss = HEAT - towerOf(cooled, light).heat;

  assertGreaterThan(lightLoss, 0, `the ${LIGHT} really cooled`);
  assertCloseTo(
    heavyLoss / lightLoss,
    EXPECTED_RATIO,
    RATIO_DIGITS,
    `the ${HEAVY}'s loss over the ${LIGHT}'s, which specs/towers.md's masses ` +
      `put at ${massOf(LIGHT)} / ${massOf(HEAVY)}`,
  );
});
