// instrumentation/flyer-velocity-reads-back — the velocity `setFlyerVelocity`
// poses is the velocity that flyer reports in `snapshot().flyers`.
//
// THE RULE. `specs/instrumentation.md`, The cascade: `setFlyerVelocity(id, vx,
// vy)` "Sets that flyer's velocity", and the snapshot reports each flyer's `vx`
// and `vy` in logical units per second.
//
// WHY IT IS A `broken` POINT, AND WHY IT IS NOT THE POSITION'S POINT. The
// `cascade` group states a card's speed and then reads how far it travelled, so a
// build that accepts a position and drops the velocity would leave every one of
// those checks integrating a speed nobody asked for — a different defect from one
// that drops the position (`instrumentation/flyer-position-reads-back`), and a
// grade that names which is worth more than one that names the flyer.
//
// THE POSED VALUES ARE SIGNED AND NEITHER ROUND, and neither is the zero
// `addFlyer` left, so a build that ignores the pose, or that keeps the magnitude
// and drops the sign, reads back a different number.
//
// READ WITH NO FRAME BETWEEN THE POSE AND THE READING, because a frame applies
// gravity to `vy` (`specs/victory.md`) and the check would be reading the update.
//
// WHAT THIS DOES NOT DECIDE. What a velocity then DOES to a card, which is
// `cascade/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  flyerById,
  openTable,
  poseFlyer,
  type Harness,
} from "../harness";

/** Where the flyer starts, at rest, before it is steered. */
const START = { x: 200, y: 200, vx: 0, vy: 0 };

/** The velocity posed onto it: signed, neither round, and neither the zero above. */
const FLYER_VX = -244;
const FLYER_VY = 189;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the posed velocity back through snapshot", async () => {
  await openTable(h);
  const id = await poseFlyer(h, START);

  await h.debug.setFlyerVelocity(id, FLYER_VX, FLYER_VY);
  // Read before a frame runs: a frame applies gravity to `vy`
  // (`specs/victory.md`), so the reading would be of the update.
  const steered = flyerById(await h.snapshot(), id);

  await h.advance(1);
  await captureStill(h, "posed");

  assertEqual(
    `${steered?.vx},${steered?.vy}`,
    `${FLYER_VX},${FLYER_VY}`,
    `snapshot()'s velocity for flyer ${id}, in logical units per second, ` +
      `after setFlyerVelocity(${id}, ${FLYER_VX}, ${FLYER_VY}) ` +
      `(specs/instrumentation.md)`,
  );
});
