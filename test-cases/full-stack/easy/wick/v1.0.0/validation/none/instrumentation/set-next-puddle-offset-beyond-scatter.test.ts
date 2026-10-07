// Wick — instrumentation/set-next-puddle-offset-beyond-scatter:
// setNextPuddleOffset refuses an offset longer than `OIL_SCATTER`, throws, and
// leaves the state exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "An argument outside the domain its operation states is
// invalid, and the call throws rather than guessing what was meant".
// `setNextPuddleOffset(dx, dy)`: "real numbers whose length is at most
// `OIL_SCATTER` (`400`); a longer offset is invalid". `(400, 1)` is the
// nearest whole-unit offset past it; `(400, 0)` sits exactly on the bound and
// is accepted.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import { OIL_SCATTER } from "../constants";
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

it("refuses an offset longer than OIL_SCATTER and changes nothing", async () => {
  const before = await isolate(h, { taper: true });

  await assertRejects(
    () => h.debug.setNextPuddleOffset(OIL_SCATTER, 1),
    `setNextPuddleOffset(${OIL_SCATTER}, 1)`,
  );
  assertDeepEqual(
    posedState(await h.snapshot()),
    posedState(before),
    "the state across the refused setNextPuddleOffset",
  );

  await h.debug.setNextPuddleOffset(OIL_SCATTER, 0);
  assertDeepEqual(
    (await h.snapshot()).run.nextPuddleOffset,
    { x: OIL_SCATTER, y: 0 },
    "an offset exactly OIL_SCATTER long, on the bound",
  );

  await captureStill(h, "refused");
});
