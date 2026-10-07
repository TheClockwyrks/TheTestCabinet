// instrumentation/clear-zones-aura-returns — with Halo held, `clearZones()`
// removes its aura and the next playing tick creates it again with a fresh
// id, under the placement rule.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `clearZones`: "An
// aura or a Chandelier lantern set whose weapon is still held is created
// again on the next `playing` tick under the placement rule". specs/world.md,
// phase 5: an aura "is created on a tick its weapon is held and none exists";
// "A pose that creates an entity gives it the next id", and an id "is never
// reused within a run" (specs/state.md).
//
// THE POSE. An isolated run holding Halo, one tick to place the aura, the
// clear read back without a frame, then one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNotEqual } from "../assert";
import {
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
  h?.dispose();
});

it("removes the aura and the next tick places a fresh one", async () => {
  isolate(h);
  holdWeapon(h, "halo", 1);
  const placed = await h.tick(1);
  const auras = zonesOfKind(placed, "aura");
  assertLength(auras, 1, "the aura before the clear");

  h.debug.clearZones();
  assertLength(h.snapshot().run.zones, 0, "the zones after the clear");

  const returned = await h.tick(1);
  captureStill(h, "returned");
  const back = zonesOfKind(returned, "aura");
  assertLength(back, 1, "the aura after the next tick");
  assertNotEqual(back[0].id, auras[0].id, "the returned aura's id, fresh");
});
