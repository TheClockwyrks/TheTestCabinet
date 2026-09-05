// Refract — instrumentation/advances-on-elapsed-time: the simulation advances
// on the elapsed time it is handed.
//
// specs/instrumentation.md "A deterministic core": every rate is integrated
// against the delta time the game is given, so one second of game time reaches
// the same simTime however it is divided into frames. Under this engine the
// step size is the CLOCK's, so the suite builds two harnesses of its own — one
// whose every frame is worth a whole second, one whose frames are worth a
// sixtieth — and covers the same second on each: one frame against sixty.
//
// This is one of the two suites that build harnesses with clocks of their own;
// the shared 120 Hz default is deliberately not used, because the step size is
// what is under test.

import { ConstantClock } from "@clockwyrks/structured-2d";
import { afterEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";

/** The harnesses an `it` built, disposed whatever its verdict. */
let built: Harness[] = [];

async function harnessWithStep(stepMs: number): Promise<Harness> {
  const h = await createHarness({ clock: new ConstantClock(stepMs) });
  built.push(h);
  return h;
}

afterEach(() => {
  for (const h of built) h.dispose();
  built = [];
});

it("one second as a single frame and as sixty frames adds 1.0 to simTime either way", async () => {
  const coarse = await harnessWithStep(1000);
  const fine = await harnessWithStep(1000 / 60);
  await resetTo(coarse, 1);
  await resetTo(fine, 1);

  const coarseStart = coarse.snapshot().simTime;
  await coarse.advance(1);
  const coarseDelta = coarse.snapshot().simTime - coarseStart;
  assertCloseTo(coarseDelta, 1, 6, "one frame worth a whole second");

  const fineStart = fine.snapshot().simTime;
  await fine.advance(60);
  const fineDelta = fine.snapshot().simTime - fineStart;
  assertCloseTo(fineDelta, 1, 6, "sixty frames worth a sixtieth each");

  assertCloseTo(
    coarseDelta,
    fineDelta,
    6,
    "the same second, however it was divided into frames",
  );

  // The game after the second was covered.
  captureStill(fine, "advanced");
});
