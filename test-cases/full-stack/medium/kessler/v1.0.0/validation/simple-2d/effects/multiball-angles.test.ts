// effects/multiball-angles — one multiball ball heads 20 degrees to the
// +theta side of the outward radial and the other 20 degrees to the -theta
// side, and the +theta ball launches first, so it stands earlier in spawn
// order.
//
// specs/pods.md: "One heads `20` degrees to the `+theta` side of the outward
// radial and the other `20` degrees to the `-theta` side, and the `+theta`
// ball launches first." Each heading is measured against the outward radial
// at the deflector's center angle — where the launch minted the velocity, and
// nothing in the emptied world has changed it since — so the reading is the
// stated 20 to float precision, and the snapshot's spawn order ("oldest
// first", specs/instrumentation.md) decides which launched first.
//
// THE WORLD IS ONE POD AND THE DEFLECTOR. No other ball exists, so
// balls[0] and balls[1] are the pair in launch order.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength } from "../assert";
import {
  close,
  dropPod,
  MULTI_OFFSET,
  open,
  record,
  START_ANGLE,
  velocityAt,
  world,
  type Harness,
} from "./pose";

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("heads the pair 20 degrees off radial, the +theta ball first", async () => {
  await world(h);

  const after = await record(h, "multiball-headings", () =>
    dropPod(h, "multiball"),
  );

  assertLength(after.balls, 2, "the launched pair");
  assertCloseTo(
    velocityAt(after.balls[0], START_ANGLE).offDeg,
    MULTI_OFFSET,
    3,
    "the first ball in spawn order heads 20 degrees to the +theta side",
  );
  assertCloseTo(
    velocityAt(after.balls[1], START_ANGLE).offDeg,
    -MULTI_OFFSET,
    3,
    "the second ball in spawn order heads 20 degrees to the -theta side",
  );
});
