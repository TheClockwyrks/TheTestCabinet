// Wick — instrumentation/clear-zones-aura-returns: with Halo held,
// `clearZones()` removes its aura and the next `playing` tick creates it
// again with a fresh id.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `clearZones()`: "An aura ... whose weapon is still held is created again on
// the next `playing` tick under the placement rule." `specs/world.md`, phase
// 5, placement: "an aura ... is created on a tick its weapon is held and none
// exists"; "A pose that creates an entity gives it the next id from
// `nextId`", and an id "is never reused within a run" (`specs/state.md`).
//
// THE DRIVE. An isolated run with Halo held, one tick (the aura exists), the
// call read at the call (no aura), one tick (one aura, its id not the old
// one).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNotEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes the aura and the next tick places it again, fresh", async () => {
  isolate(h);
  holdWeapon(h, "halo");
  const lit = await advanceTicks(h, 1);
  const [old] = zonesOfKind(lit, "aura");
  assertLength(zonesOfKind(lit, "aura"), 1, "the aura before the call");

  h.debug.clearZones();
  assertDeepEqual(h.snapshot().run.zones, [], "zones at the call");
  const back = await advanceTicks(h, 1);
  captureStill(h, "returned");
  const auras = zonesOfKind(back, "aura");
  assertLength(auras, 1, "auras on the next playing tick");
  assertNotEqual(
    auras[0].id,
    old.id,
    "the returned aura's id against the removed one's",
  );
});
