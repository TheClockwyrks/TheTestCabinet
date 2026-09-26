// camera/lead-is-driven-by-time — the lead takes the same two seconds however
// fast the miner is going.
//
// specs/world.md: the lead moves toward `leadTarget` at
// `CAM_LEAD_MAX / CAM_LEAD_RAMP` (106) units per second, "at a rate driven by
// time, not by speed, so a slow drift and a fast plunge reach full lead over the
// same two seconds", and "it never overshoots `leadTarget` within an update".
// This check decides that: two descents at wildly different speeds, held against
// one ramp, with no sample past `CAM_LEAD_MAX` (212).
//
// WHY THE TRAVEL GATE IS THE ARRANGEMENT. The claim is about two DIFFERENT
// speeds giving the SAME ramp, so the speeds have to be held apart and held
// steady, and nothing in the game does that on its own: a real fall accelerates
// through every speed between the two. specs/instrumentation.md fixes the gate
// for exactly this — a gated miner keeps the velocity it was posed with while
// everything else about it carries on, the camera included — so the two runs
// differ in the one quantity the requirement is about and in nothing else.
//
// The two speeds are the extremes the game itself reaches downward: a drift just
// past `CAM_STILL_SPEED` (40), the slowest descent the rule counts at all, and
// `FALL_TERMINAL_EMPTY` (950), the fastest an unladen miner ever falls.

import { afterEach, beforeEach, it } from "vitest";
import {
  CAM_LEAD_MAX,
  CAM_STILL_SPEED,
  FALL_TERMINAL_EMPTY,
} from "../constants";
import { assertBetween, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { CAM_LEAD_RATE } from "./lead";

const COL = 16;
const ROW = 40;

/** The slow drift and the terminal plunge. */
const SLOW_VY = CAM_STILL_SPEED + 10;
const FAST_VY = FALL_TERMINAL_EMPTY;

/** The sample points, in seconds of sustained descent. */
const SAMPLE_SECONDS = [0.5, 1, 1.5, 2, 2.5];

/** Frames each half-second sample is driven in: a 60 Hz division. */
const FRAMES_PER_SAMPLE = 30;

/** Two frames of ramp at that division, either side. */
const TOLERANCE = 2 * CAM_LEAD_RATE * (0.5 / FRAMES_PER_SAMPLE) * 2;

/** How far past `CAM_LEAD_MAX` a sample may sit: the same arithmetic slack. */
const OVERSHOOT_ALLOWANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Drive one gated descent at `vy` and report the lead at each sample point. */
async function rampAt(vy: number): Promise<{ at: number; lead: number }[]> {
  openScene(h);
  pinMiner(h);
  pinDrill(h);
  h.debug.setMinerPosition(minerXOn(COL), minerYOn(ROW));
  h.debug.setMinerVelocity(0, vy);

  const samples: { at: number; lead: number }[] = [];
  let driven = 0;
  for (const at of SAMPLE_SECONDS) {
    await h.advanceSeconds(at - driven, FRAMES_PER_SAMPLE);
    driven = at;
    samples.push({ at, lead: h.snapshot().camera.lead });
  }
  return samples;
}

it("reaches full lead over the same CAM_LEAD_RAMP seconds at both speeds", async () => {
  let slow: { at: number; lead: number }[] = [];
  let fast: { at: number; lead: number }[] = [];
  await captureReplay(h, "ramp", async () => {
    slow = await rampAt(SLOW_VY);
    fast = await rampAt(FAST_VY);
  });

  for (const [label, samples] of [
    [`a drift at ${SLOW_VY}`, slow],
    [`a plunge at ${FAST_VY}`, fast],
  ] as const) {
    for (const sample of samples) {
      const expected = Math.min(CAM_LEAD_MAX, CAM_LEAD_RATE * sample.at);
      assertBetween(
        sample.lead,
        expected - TOLERANCE,
        expected + TOLERANCE,
        `specs/world.md: the lead after ${sample.at}s of ${label}`,
      );
      assertLessThanOrEqual(
        sample.lead,
        CAM_LEAD_MAX + OVERSHOOT_ALLOWANCE,
        `specs/world.md: the lead never overshoots CAM_LEAD_MAX, at ${sample.at}s of ${label}`,
      );
    }
  }
});
