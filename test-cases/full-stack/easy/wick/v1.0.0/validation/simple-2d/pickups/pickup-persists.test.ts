// pickups/pickup-persists — a pickup never despawns, however far from the
// lamplighter it lies and however long it lies there.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Pickups"): "A pickup is
// `{ id, kind, x, y }`; it sits where it was dropped and stays on the field
// until it is collected." The only removal by distance the specification states
// belongs to enemies: specs/enemies.md ("Despawning") has "every common enemy
// whose center is farther than" its distance removed, and nothing in that rule
// reaches a pickup. So a bread `FAR` (3000) units out, more than twice the
// 1280-unit width of the view, is still on the field after `SPAN` (600) ticks,
// ten seconds of game time, with the faculty that removes things by distance
// running the whole way.
//
// THE WORLD. An isolated `playing` run with `despawning` alone turned back on,
// so the one faculty that removes anything by distance is the faculty running
// while the bread lies there, and nothing else in the night can drop another
// pickup or bring the lamplighter to this one. Nothing is alive for the
// director to despawn, which is the point: what is being read is that the rule
// does not reach the pickup. 3000 units is far outside `PICKUP_ITEM_RADIUS`
// (16) plus `PLAYER_RADIUS` (12), so the bread is never collected, and bread is
// the kind whose collection changes health rather than the screen, so a
// mistaken collection would show as a survivor missing rather than as an
// overlay.
//
// WHAT IS READ. After 600 ticks: the bread still on the field, at the point it
// was placed, and still of kind `bread`.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on each coordinate of a pickup that
// never moved; none on the count or the kind.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { MOTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";
import { pickupOf } from "./night";

/** Where the bread lies: far outside the view and far outside contact. */
const FAR = 3000;

/** How long it lies there, in ticks: ten seconds of game time. */
const SPAN = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a bread 3000 units out on the field across 600 ticks with despawning on", async () => {
  const posed = isolate(h);
  enable(h, "despawning");
  const { player } = posed.run;
  const at = { x: player.x + FAR, y: player.y };
  const pickup = spawnPickupAt(h, "bread", at.x, at.y);

  const after = await h.tick(SPAN);
  captureStill(h, "kept");

  assertEqual(after.despawning, true, "the despawning switch across the span");
  assertLength(after.run.pickups, 1, `pickups left after ${SPAN} ticks`);
  const seen = pickupOf(after, pickup);
  assertEqual(seen.kind, "bread", "the distant pickup's kind");
  assertWithin(seen.x, at.x, MOTION_TOLERANCE, `its x after ${SPAN} ticks`);
  assertWithin(seen.y, at.y, MOTION_TOLERANCE, `its y after ${SPAN} ticks`);
});
