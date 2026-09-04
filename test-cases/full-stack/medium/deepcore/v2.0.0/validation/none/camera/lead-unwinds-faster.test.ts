// camera/lead-unwinds-faster — the lead runs back toward 0 four times as fast as
// it built.
//
// specs/world.md: `lead` moves toward `leadTarget` at
// `CAM_LEAD_MAX / CAM_LEAD_RAMP` (106) units per second while the move takes it
// AWAY from `0`, and at `CAM_UNWIND_MULT` (4) times that rate while the move
// takes it TOWARD `0`. So a miner that stops after a long descent sheds its
// whole lead in `CAM_LEAD_RAMP / CAM_UNWIND_MULT` (0.5) seconds, and the view
// recentres rather than dragging the old lead along behind it.
//
// A REAL FALL AND A REAL STOP. The lead is built by dropping the miner down a
// cleared shaft onto a floor, and the stop is the landing: the collision the
// game's own physics resolves puts the vertical speed back inside the still band,
// which is what turns the target around. Nothing about the lead is posed.
//
// WHAT IS MEASURED. The lead the landing frame left, and the decay from there.
// The build rate is what the descending check decides, so this one takes the lead
// it finds and holds the DECAY against four times the build rate, which separates
// the stated unwind from an unwind at the build rate by more than the whole
// remaining lead within a fifth of a second.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan, assertTrue } from "../assert";
import { CAM_LEAD_RATE, CAM_UNWIND_MULT } from "../constants";
import {
  captureReplay,
  createHarness,
  layFloor,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";

/** The shaft the drop runs down, and the floor that stops it. */
const COL = 16;
const START_ROW = 10;
const FLOOR_ROW = 45;

/** How far a landing is swept for, in frames of the harness clock. */
const LAND_FRAMES = 600;

/** The lead the drop must have built before the unwind is worth measuring. */
const MIN_BUILT_LEAD = 150;

/** The sample points after the landing, in seconds. */
const SAMPLE_SECONDS = [0.1, 0.2, 0.3, 0.4, 0.5];

/** Frames each 0.1s sample is driven in: a 120 Hz division. */
const FRAMES_PER_SAMPLE = 12;

/** The rate the lead sheds at, as specs/world.md states it: 4 x 106 = 424 u/s. */
const UNWIND_RATE = CAM_LEAD_RATE * CAM_UNWIND_MULT;

/** Four frames of unwind at that division, either side. */
const TOLERANCE = 4 * UNWIND_RATE * (0.1 / FRAMES_PER_SAMPLE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sheds the lead at CAM_UNWIND_MULT times the rate it built at", async () => {
  await openScene(h);
  await pinDrill(h);
  await layFloor(h, FLOOR_ROW);

  const samples: { at: number; lead: number }[] = [];
  let landed = 0;
  await captureReplay(h, "unwind", async () => {
    await h.debug.setMinerPosition(minerXOn(COL), minerYOn(START_ROW));
    await h.debug.setMinerVelocity(0, 0);
    const fall = await h.until((s) => s.miner.grounded, {
      maxFrames: LAND_FRAMES,
    });
    // One frame past the first that reads as grounded, so the reading is the
    // landing rather than the approach to it.
    assertTrue(fall.hit, "the drop reached the floor inside the sweep");
    await h.advance(1);
    landed = (await h.snapshot()).camera.lead;

    let driven = 0;
    for (const at of SAMPLE_SECONDS) {
      await h.advanceSeconds(at - driven, FRAMES_PER_SAMPLE);
      driven = at;
      samples.push({ at, lead: (await h.snapshot()).camera.lead });
    }
  });

  // The arrangement's own reading: the descent built a lead worth unwinding.
  assertGreaterThan(
    landed,
    MIN_BUILT_LEAD,
    "the drop built a lead before the landing",
  );

  for (const sample of samples) {
    const expected = Math.max(0, landed - UNWIND_RATE * sample.at);
    assertBetween(
      sample.lead,
      expected - TOLERANCE,
      expected + TOLERANCE,
      `specs/world.md: the lead ${sample.at}s after the miner stopped`,
    );
  }
});
