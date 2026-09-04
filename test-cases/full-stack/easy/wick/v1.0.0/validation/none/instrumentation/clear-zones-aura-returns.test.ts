// Wick — instrumentation/clear-zones-aura-returns: with Halo held,
// `clearZones()` removes its aura and the next `playing` tick creates it again
// with a fresh id, under the placement rule.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `clearZones()`):
// "An aura or a Chandelier lantern set whose weapon is still held is created
// again on the next `playing` tick under the placement rule." specs/world.md
// phase 5: "an aura ... is created on a tick its weapon is held and none
// exists"; "A pose that creates an entity gives it the next id from `nextId`"
// and ids are "never reused within a run" (specs/state.md), so the returned
// aura's id is above the cleared one's.
//
// WHY THE WORLD IS POSED AS IT IS. Every faculty is held, so the aura's
// creation is placement's alone; the zones are read at the call, empty, so
// what the next tick creates is a return and not a survival.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
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

afterEach(async () => {
  await h.dispose();
});

it("removes the aura, and the next tick creates it again with a fresh id", async () => {
  await isolate(h);
  await holdWeapon(h, "halo", 1);
  const placed = await h.step(1);
  const auras = zonesOfKind(placed, "aura");
  assertLength(auras, 1, "the aura before the clear");
  const cleared = auras[0]!;

  await h.debug.clearZones();
  const emptied = await h.snapshot();
  assertLength(emptied.run.zones, 0, "the zones at the call");

  const returned = await h.step(1);
  await captureStill(h, "returned");
  const back = zonesOfKind(returned, "aura");
  assertLength(back, 1, "the aura after the next playing tick");
  assertEqual(back[0]?.weapon, "halo", "the returned aura's weapon");
  assertGreaterThan(
    back[0]?.id ?? NaN,
    cleared.id,
    "the returned aura's id, fresh",
  );
});
