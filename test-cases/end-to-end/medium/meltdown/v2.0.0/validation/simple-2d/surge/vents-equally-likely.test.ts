// surge/vents-equally-likely — the vent draw lands on either vent half the time.
//
// THE RULE. specs/waves.md: "Each unit's vent is drawn at random as it is
// released, the two vents equally likely." The odds are the requirement, so the
// item samples: `drawVent` on the surface of specs/instrumentation.md "performs
// one vent draw exactly as the release performs it" and nothing else, and a
// bounded run of them is read against the binomial band `surge/sample.ts` puts
// around one half.
//
// NOTHING IS RELEASED. The draws touch no unit and no wave: the floor is the
// quiet one `startRun` leaves, and the reading is the count of one vent over the
// run. A build drawing at the wrong odds lands outside the band; a build whose
// draw returns anything but a vent name fails on the shape of its answer, which
// `instrumentation/draw-vent-returns-a-vent` also names.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertContains } from "../assert";
import { VENT_PROBABILITY } from "../constants";
import {
  captureStill,
  createHarness,
  drawVents,
  startRun,
  type Harness,
} from "../harness";
import { binomialBand, VENT_DRAWS } from "./sample";

/** The two answers the specification allows. */
const VENTS = ["left", "top"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the left vent about half the time", async () => {
  startRun(h);
  const drawn = drawVents(h, VENT_DRAWS);
  await h.advance(1);
  captureStill(h, "sampled");

  for (const [index, vent] of drawn.entries()) {
    assertContains(
      VENTS,
      vent,
      `draw ${index + 1}: the vent drawVent returned`,
    );
  }
  const left = drawn.filter((vent) => vent === "left").length;
  const band = binomialBand(VENT_DRAWS, VENT_PROBABILITY);
  assertBetween(
    left,
    band.low,
    band.high,
    `left vents over ${VENT_DRAWS} draws at probability ${VENT_PROBABILITY}`,
  );
});
