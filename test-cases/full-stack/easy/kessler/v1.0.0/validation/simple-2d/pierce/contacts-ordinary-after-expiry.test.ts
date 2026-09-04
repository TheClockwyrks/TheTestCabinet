// pierce/contacts-ordinary-after-expiry — once the timer has run out, a target
// contact is ordinary again.
//
// specs/pods.md, "Timed effects": "When a timer reaches `0` the effect ends ...
// an ended `pierce` returns every ball to ordinary contacts." An ordinary
// contact on a full-hit-point ring 2 target removes one hit point and leaves the
// target live, where a still-piercing one would have destroyed it outright. That
// a CATCH arms the timer at 360 is `arms-360-ticks`.
//
// THE TIMER IS POSED SHORT AND DIES WELL BEFORE THE CONTACT, so the reading is
// about the expiry rather than about the arithmetic of a long countdown: three
// ticks in force, and the crossing four ticks after that.
//
// THE WORLD IS ONE FROZEN TARGET AND ONE BALL, per isolate().

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  outboundBall,
  poseIsolated,
  poseRingTwoTarget,
  ringTwoTarget,
} from "./stage";

/** The ring 2 slot the target is posed in. */
const SLOT = 3;
/** Ticks pierce is left in force: spent long before the contact. */
const SHORT_PIERCE = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes one hit point from a target the expired pierce would have felled", async () => {
  await poseIsolated(h);
  await armPierce(h, SHORT_PIERCE);
  const arcDeg = await poseRingTwoTarget(h, SLOT, { hp: 2, freeze: true });
  // From radius 325 at 4 units per tick, the crossing of contact radius 352
  // resolves on tick 7 (349 to 353) — four ticks after the timer died.
  await outboundBall(h, arcDeg, 325);

  const after = await captureReplay(h, "expired", async () => {
    const contacted = await h.tick(8);
    await h.tick(4);
    return contacted;
  });

  assertEqual(
    after.effects.pierceTicks,
    0,
    "the timer ran out before the contact",
  );
  assertEqual(
    ringTwoTarget(after, SLOT)?.hp,
    1,
    "an ordinary hit: one hit point removed, the target still live",
  );
});
