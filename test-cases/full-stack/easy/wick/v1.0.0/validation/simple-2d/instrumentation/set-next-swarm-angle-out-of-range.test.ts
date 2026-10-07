// instrumentation/set-next-swarm-angle-out-of-range — setNextSwarmAngle
// refuses an angle outside `[0, 360)`, throws, and leaves the state exactly as
// it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("The operations"):
// "An argument outside the domain its operation states is invalid, and the
// call throws rather than guessing what was meant". `setNextSwarmAngle
// (degrees)`: "in the same domain" as `setNextSpawnAngle`, "a real number of
// at least `0` and below `360`".

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { POSED_ANGLE_LIMIT, POSED_ANGLE_MIN } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses 360 and -1 and changes nothing", async () => {
  const before = isolate(h, { keepTaper: true });

  for (const bad of [POSED_ANGLE_LIMIT, POSED_ANGLE_MIN - 1]) {
    assertThrows(
      () => h.debug.setNextSwarmAngle(bad),
      `setNextSwarmAngle(${bad})`,
    );
    assertDeepEqual(
      h.snapshot(),
      before,
      `the snapshot after setNextSwarmAngle(${bad}) was refused`,
    );
  }

  await h.tick(1);
  captureStill(h, "refused");
});
