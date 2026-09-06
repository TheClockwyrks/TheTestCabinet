// instrumentation/set-next-spawn-type-unknown-id — setNextSpawnType refuses
// an id that is no enemy, throws, and leaves the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md` ("Drawn
// outcomes", `setNextSpawnType(id)`): "an enemy id of `specs/enemies.md`; any
// other value is invalid", and ("The operations") "An argument outside the
// domain its operation states is invalid, and the call throws rather than
// guessing what was meant". A weapon's id, a passive's id, and a name no
// table holds are the nearest strings outside that domain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws on a weapon's id, a passive's id, and an unknown name", async () => {
  const before = isolate(h, { taper: true });

  for (const bad of ["taper", "brass", "shadow"]) {
    assertThrows(
      () => h.debug.setNextSpawnType(bad as never),
      `setNextSpawnType("${bad}")`,
    );
    assertDeepEqual(
      h.snapshot(),
      before,
      `the snapshot after setNextSpawnType("${bad}") was refused`,
    );
  }

  await h.frameDraw();
  captureStill(h, "refused");
});
