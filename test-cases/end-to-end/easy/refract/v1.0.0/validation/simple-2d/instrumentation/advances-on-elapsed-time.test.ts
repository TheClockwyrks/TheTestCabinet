// Refract — instrumentation/advances-on-elapsed-time: the simulation advances
// on the elapsed time it is handed.
//
// specs/instrumentation.md "A deterministic core": every rate is integrated
// against the delta time the game is given, so an interval of game time reaches
// the same state however it was divided into frames.
//
// This check covers one second of game time under two scripted clocks — as a
// single 1000 ms frame and as sixty 1000/60 ms frames — and simTime, which
// accumulates the delta time of every update (specs/instrumentation.md
// "Snapshot shape"), must gain 1.0 either way. The harnesses are built here
// with clocks of this check's own, because the step size is the SUBJECT;
// everything else in this directory steps the shared default.

import { ConstantClock } from "@test-cabinet/simple-2d";
import { it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureStill, createHarness, resetTo } from "../harness";

it("adds 1.0 to simTime whether one second is one frame or sixty", async () => {
  // One second as a single frame…
  const one = await createHarness({ clock: new ConstantClock(1000) });
  try {
    await resetTo(one, 1);
    const opened = one.snapshot().simTime;
    await one.advance(1);
    assertCloseTo(
      one.snapshot().simTime - opened,
      1,
      6,
      "one second covered as a single frame adds 1.0 to simTime",
    );
  } finally {
    one.dispose();
  }

  // …and the same second as sixty frames.
  const sixty = await createHarness({ clock: new ConstantClock(1000 / 60) });
  try {
    await resetTo(sixty, 1);
    const opened = sixty.snapshot().simTime;
    await sixty.advance(60);
    assertCloseTo(
      sixty.snapshot().simTime - opened,
      1,
      6,
      "one second covered as sixty frames adds 1.0 to simTime",
    );

    // The game after the second was covered.
    captureStill(sixty, "advanced");
  } finally {
    sixty.dispose();
  }
});
