// assets/particles-played-through-runtime — the particle systems play through
// the runtime.
//
// specs/assets.md: "Play them through `@clockwyrks/particle-runtime`, an
// installed dependency imported by its bare name, using its `./canvas`
// binding: a player is constructed over a parsed system and a 2D rendering
// context ... and it simulates the system and composites the particles
// itself." Which module plays a system is a fact about the build's SOURCE, so
// that is where it is read: some source module of the game — not one of the
// build's own tests — imports `@clockwyrks/particle-runtime/canvas` by its
// bare name. A build that wrote a simulator of its own has no reason to
// import the binding, and a build that imports it has the runtime's player as
// its one way of playing a system.
//
// The evidence replay stages the smallest event that fires a system — one
// posed target destroyed by one posed ball — so a reviewer sees the burst the
// runtime composites. The replay is evidence only: a fault in the destruction
// itself belongs to the rings suites, so nothing about the drive decides this
// item.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import { RINGS, ballSpeed, slotArcCenterDeg } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import {
  CANVAS_BINDING,
  sourcesImportingCanvasBinding,
} from "./runtime-import";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays its systems through the runtime's ./canvas binding", async () => {
  try {
    await isolate(h);
    await h.debug.setRingAngle(1, 0);
    await h.debug.setRingSpeed(1, 0);
    await h.debug.spawnTarget(1, 0, 1);
    await spawnBallPolar(
      h,
      RINGS[0].contactOuterRadius + 30,
      slotArcCenterDeg(1, 0, 0),
      ballSpeed(1),
      180,
    );
    await captureReplay(h, "burst", async () => {
      await h.until((snap) => snap.rings[0].targets.length === 0, {
        maxTicks: 60,
      });
      await h.tick(30);
    });
  } catch {
    // Evidence only: the burst replay is given up, the verdict is not.
  }

  const importers = sourcesImportingCanvasBinding();
  if (importers.length === 0) {
    fail(
      `a source module of the game importing "${CANVAS_BINDING}" by its bare ` +
        `name (specs/assets.md, the particle effects)`,
      "no module outside the build's own tests imports the runtime's ./canvas binding",
    );
  }
});
