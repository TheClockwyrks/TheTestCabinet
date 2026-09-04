// orbits/rings-start-at-zero — a fresh session starts every ring at angle 0.
//
// specs/rings.md: "Every ring starts a session, and starts each wave, at ring
// angle `0`." The session is started through the surface —
// specs/instrumentation.md's setScreen('playing') "starts a fresh session
// exactly as confirming START does: ... every slot filled, ring angles at
// `0`" — from a session whose three ring angles were first posed elsewhere,
// so a build that merely never moved its rings is told apart from one that
// starts them at 0. The reading is wrap-aware distance from 0, so 360-epsilon
// and epsilon both read as the float dust they are.
//
// The menus stay untouched: the real key route into a session belongs to the
// screens checks, and a build with a broken menu and a correct session start
// must fail there alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { advanceDeg, ringAngle } from "./rings";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts all three rings at angle 0", async () => {
  h.reset();
  h.debug.setScreen("playing");
  // Disturb every ring, so the next session's zeros are the session start's.
  h.debug.setRingAngle(1, 45);
  h.debug.setRingAngle(2, 190);
  h.debug.setRingAngle(3, 305);

  h.debug.setScreen("playing");
  const fresh = h.snapshot();

  await h.tick(1);
  captureStill(h, "fresh");

  for (const ring of [1, 2, 3]) {
    assertCloseTo(
      Math.abs(advanceDeg(0, ringAngle(fresh, ring))),
      0,
      6,
      `ring ${ring}'s angle at the fresh session's start`,
    );
  }
});
