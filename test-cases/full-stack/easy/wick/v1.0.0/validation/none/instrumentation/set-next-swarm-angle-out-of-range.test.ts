// Wick — instrumentation/set-next-swarm-angle-out-of-range: setNextSwarmAngle
// refuses an angle outside `[0, 360)`, throws, and leaves the state exactly as
// it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "An argument outside the domain its operation states is
// invalid, and the call throws rather than guessing what was meant".
// `setNextSwarmAngle(degrees)`: "in the same domain" as `setNextSpawnAngle`,
// "a real number of at least `0` and below `360`".

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import { POSED_ANGLE_LIMIT, POSED_ANGLE_MIN } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  posedState,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses 360 and -1 and changes nothing", async () => {
  const before = await isolate(h, { taper: true });

  for (const bad of [POSED_ANGLE_LIMIT, POSED_ANGLE_MIN - 1]) {
    await assertRejects(
      () => h.debug.setNextSwarmAngle(bad),
      `setNextSwarmAngle(${bad})`,
    );
    assertDeepEqual(
      posedState(await h.snapshot()),
      posedState(before),
      `the state across the refused setNextSwarmAngle(${bad})`,
    );
  }

  await captureStill(h, "refused");
});
