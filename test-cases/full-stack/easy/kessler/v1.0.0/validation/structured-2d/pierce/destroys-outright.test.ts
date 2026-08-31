// pierce/destroys-outright — while pierce is in force, one target contact
// destroys the target whatever its hit points.
//
// specs/pods.md, "pierce": "While pierce is in force every ball pierces...
// A piercing ball's target contact, face or edge, destroys the target
// outright whatever its hit points". Ring 2's targets carry 2 hit points
// (specs/rings.md), so a single face contact removing a FULL-hit-point ring 2
// target is the observable that separates piercing from an ordinary hit,
// which would leave the target live at 1.
//
// THE WORLD IS ONE TARGET AND ONE BALL. isolate() empties the field and holds
// both driver switches off, pierce is armed through the timer pose, the ring
// is frozen so the posed arc stands still, and the ball flies straight out
// the arc's center: radii 345, 349, 353 — the crossing of contact radius 352
// resolves on tick 3, strictly, never landing ON the radius.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  outboundBall,
  PIERCE_DURATION,
  poseIsolated,
  poseRingTwoTarget,
  readState,
  ringTwoTarget,
} from "./stage";

/** The ring 2 slot the target is posed in. */
const SLOT = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes a full-hit-point ring 2 target on a single contact", async () => {
  await poseIsolated(h);
  await armPierce(h, PIERCE_DURATION);
  const arcDeg = await poseRingTwoTarget(h, SLOT, { hp: 2, freeze: true });
  await outboundBall(h, arcDeg, 341);

  const posed = await readState(h);
  assertEqual(
    ringTwoTarget(posed, SLOT)?.hp,
    2,
    "the posed target at its full 2 hit points",
  );

  const after = await captureReplay(h, "destroy", async () => {
    const contacted = await h.tick(4); // the crossing of 352 resolves on tick 3
    await h.tick(4); // let the replay show the ball carrying on
    return contacted;
  });

  assertUndefined(
    ringTwoTarget(after, SLOT),
    "the target after one piercing contact: destroyed outright",
  );
});
