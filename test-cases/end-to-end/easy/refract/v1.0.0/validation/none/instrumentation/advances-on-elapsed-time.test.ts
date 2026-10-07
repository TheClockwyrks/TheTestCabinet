// Refract — instrumentation/advances-on-elapsed-time: the simulation advances
// on the elapsed time it is handed.
//
// `specs/instrumentation.md` fixes that every rate is integrated against the
// frame's delta time — `advance(1, 1)` and `advance(1, 60)` cover the same
// second and must reach the same outcome. So this check covers one second of
// game time as a single frame and as sixty and requires `simTime` to gain 1.0
// either way.
//
// `advance` is called directly here, with this check's own divisions, because
// the step size is the SUBJECT; everything else in this directory steps the
// suite's plain 60 Hz.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("one second as one frame and as sixty adds 1.0 to simTime either way", async () => {
  const start = (await h.snapshot()).simTime;

  await h.debug.advance(1, 1);
  const afterOne = (await h.snapshot()).simTime;
  assertCloseTo(afterOne - start, 1, 6, "one second covered as a single frame");

  await h.debug.advance(1, 60);
  const afterSixty = (await h.snapshot()).simTime;
  assertCloseTo(
    afterSixty - afterOne,
    1,
    6,
    "the same second covered as sixty frames",
  );

  await h.advance(1);
  await captureStill(h, "advanced");
});
