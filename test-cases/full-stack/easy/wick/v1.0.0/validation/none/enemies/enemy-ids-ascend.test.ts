// Wick — enemies/enemy-ids-ascend: enemy ids rise in spawn order and are never
// handed out twice.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("The life of an enemy"):
// "An enemy spawns with the next id from `nextId`, so ids ascend in spawn order
// and each is used once per run." `specs/instrumentation.md` says the same of
// every pose — "A pose that creates an entity gives it the next id from
// `nextId`" — and of the removal that frees nothing: `removeEnemy` "Removes
// enemy `id`. Nothing drops, nothing counts as a kill, and no cue plays." So a
// spawn after a removal takes the next id rather than the freed one, which is
// the "used once per run" half.
//
// THE POSE. An isolated night holding nothing but the lamplighter, every
// faculty held so no director spawn takes an id underneath the reading. Three
// enemies of three types are spawned in turn, well apart and well clear of the
// lamplighter; the first is then removed and a fourth spawned. The types differ
// so a build that pooled ids per type is separated too.
//
// TOLERANCE. None: an id is a whole number and the check is on its order.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

/** How far out each enemy stands: clear of the lamplighter and of each other. */
const GAP = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hands three spawns ascending ids and gives a fourth an id above all three", async () => {
  await isolate(h);
  const first = await placeEnemy(h, "moth", GAP, 0);
  const second = await placeEnemy(h, "bat", -GAP, 0);
  const third = await placeEnemy(h, "rat", 0, GAP);

  await h.debug.removeEnemy(first.id);
  const fourth = await placeEnemy(h, "moth", 0, -GAP);
  await captureStill(h, "ids");

  assertGreaterThan(second.id, first.id, "the bat's id against the moth's");
  assertGreaterThan(third.id, second.id, "the rat's id against the bat's");
  assertGreaterThan(
    fourth.id,
    third.id,
    "the id of a moth spawned after the first was removed, against the rat's",
  );
});
