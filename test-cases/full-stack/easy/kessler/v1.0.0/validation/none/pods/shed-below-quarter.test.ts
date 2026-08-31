// pods/shed-below-quarter — a destruction sheds exactly when the stream's next
// value is below 0.25.
//
// specs/pods.md: "The destruction takes the stream's next value u1. At
// u1 < 0.25 it sheds a pod and takes a second value u2 for the kind; at
// u1 >= 0.25 it sheds nothing and the draw ends there." Each direction is read
// off a session's FIRST destruction, so the verdict rests on the threshold
// alone and never on how a previous draw consumed the stream. The seeds are
// chosen from the specification's own generator to land u1 close to the
// boundary on each side (0.2378 and 0.2587), which is as sharp as seeded
// scenarios can pose the edge.
//
// THE WORLD IS ONE TARGET AND ONE BALL PER DRAW, staged by the shared draw
// helper on a frozen ring 1 with the deflector parked away.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import { POD_DROP_CHANCE, mulberry32 } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { AWAY_ANGLE, destroyPosedTarget } from "./draw";

/** mulberry32(15) opens at 0.2378 — just below the threshold. */
const SHED_SEED = 15;
/** mulberry32(54) opens at 0.2587 — just above the threshold. */
const NO_SHED_SEED = 54;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sheds a pod at u1 below 0.25, and nothing at u1 above it", async () => {
  // The scenario's own premises, from the specification's generator.
  assertTrue(
    mulberry32(SHED_SEED)() < POD_DROP_CHANCE,
    "the shed seed's first value is below 0.25",
  );
  assertTrue(
    mulberry32(NO_SHED_SEED)() >= POD_DROP_CHANCE,
    "the no-shed seed's first value is at or above 0.25",
  );

  await isolate(h, SHED_SEED);
  await h.debug.setPodSpawn(true);
  await h.debug.setPaddleAngle(AWAY_ANGLE);
  const shed = await captureReplay(h, "shed", () =>
    destroyPosedTarget(h, 1, 0),
  );
  assertLength(shed.pods, 1, "a first draw of u1 = 0.2378 sheds one pod");

  await isolate(h, NO_SHED_SEED);
  await h.debug.setPodSpawn(true);
  await h.debug.setPaddleAngle(AWAY_ANGLE);
  const kept = await captureReplay(h, "no-shed", () =>
    destroyPosedTarget(h, 1, 0),
  );
  assertLength(kept.pods, 0, "a first draw of u1 = 0.2587 sheds nothing");
});
