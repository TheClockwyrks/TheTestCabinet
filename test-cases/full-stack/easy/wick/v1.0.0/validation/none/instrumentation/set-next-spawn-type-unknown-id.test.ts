// Wick — instrumentation/set-next-spawn-type-unknown-id: setNextSpawnType
// refuses an id that is no enemy, throws, and leaves the state exactly as it
// was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextSpawnType(id)`): "an enemy id of `specs/enemies.md`; any
// other value is invalid", and ("The operations") "An argument outside the
// domain its operation states is invalid, and the call throws rather than
// guessing what was meant". A weapon's id, a passive's id, and a name no
// table holds are the nearest strings outside that domain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
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

it("throws on a weapon's id, a passive's id, and an unknown name", async () => {
  const before = await isolate(h, { taper: true });

  for (const bad of ["taper", "brass", "shadow"]) {
    await assertRejects(
      () => h.debug.setNextSpawnType(bad as never),
      `setNextSpawnType("${bad}")`,
    );
    assertDeepEqual(
      posedState(await h.snapshot()),
      posedState(before),
      `the state across the refused setNextSpawnType("${bad}")`,
    );
  }

  await captureStill(h, "refused");
});
