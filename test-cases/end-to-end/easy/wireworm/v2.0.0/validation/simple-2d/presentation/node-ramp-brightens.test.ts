// presentation/node-ramp-brightens — the ramp brightens toward critical.
//
// specs/overview.md's legibility table: the four charge states "read as a ramp:
// each state is visibly brighter or more energetic than the one below it, with
// critical the most so". This point owns that second half — the DIRECTION of the
// ramp — and presentation/node-ramp-distinct owns the first, that the four are
// told apart at all. A build whose four states are four unmistakable colours in a
// jumbled order passes that point and fails this one, which is exactly the
// separation the two points exist to make.
//
// THE READING IS BRIGHTNESS, on the 0–255 scale, and the assertion is that it
// STRICTLY CLIMBS across the four states. No figure is asserted for any state,
// because specs/overview.md fixes no palette: what it fixes is the order.
//
// A CRITICAL NODE PULSES between two frames of `assets/node/`
// (specs/assets.md), and both of those frames are the critical state. The
// reading is taken on one frame, so it lands on whichever of the pair the build's
// own cadence has up at that moment, and the requirement is the same either way:
// the state above charge `2`. Which frame is up when, and that it alternates at
// all, is presentation/critical-pulses.
//
// The board is posed exactly as presentation/node-ramp-distinct poses it — four
// tiles, spread, on one row well clear of the band — for the same reasons.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX } from "../../src/constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { litTile, luminance } from "./reading";

/**
 * How much brighter each state must read than the one below it, on the 0–255
 * brightness scale.
 *
 * specs/overview.md asks for "visibly brighter", not for a stated step, and it
 * fixes no palette — so the bar is what a measurement can honestly call an
 * increase rather than a rounding. Each reading is the mean of 29 pixels, so the
 * noise floor is the canvas's own rounding, under a level; 4 is several times
 * that and is a step a player reads as a change of state.
 */
const STEP_MIN = 4;

/** The row the ramp is posed on: mid-board, far from the band and the entry row. */
const RAMP_ROW = 8;

/** The four charge states, in order, each on its own tile four tiles along. */
const CHARGES = [0, 1, 2, CHARGE_MAX];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brightens from inert through to critical", async () => {
  startPlaying(h);
  CHARGES.forEach((charge, i) => {
    h.debug.setNode(12 + 4 * i, RAMP_ROW, charge);
  });
  await h.advance(1);
  captureStill(h, "ramp");

  const brightness = CHARGES.map((_, i) =>
    luminance(litTile(h, 12 + 4 * i, RAMP_ROW)),
  );

  for (let i = 1; i < CHARGES.length; i += 1) {
    assertGreaterThan(
      brightness[i] - brightness[i - 1],
      STEP_MIN,
      `how much brighter the charge ${CHARGES[i]} node reads than the charge ` +
        `${CHARGES[i - 1]} one (${brightness[i - 1].toFixed(1)} against ` +
        `${brightness[i].toFixed(1)} out of 255) — specs/overview.md: each ` +
        "state is visibly brighter or more energetic than the one below it",
    );
  }
});
