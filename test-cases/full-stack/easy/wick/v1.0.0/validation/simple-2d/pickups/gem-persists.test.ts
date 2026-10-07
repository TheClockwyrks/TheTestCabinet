// pickups/gem-persists — a gem never despawns, however far from the
// lamplighter it lies and however long it lies there.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Gems"): "A gem sits where it
// was dropped until it is attracted, and it stays on the field until it is
// collected." The only removal by distance the specification states belongs to
// enemies: specs/enemies.md ("Despawning") has "every common enemy whose center
// is farther than" its distance removed, and nothing in that rule reaches a
// gem. So a gem `FAR` (3000) units out, more than twice the 1280-unit width of
// the view and sixty times `PICKUP_RADIUS` (48), is still on the field after
// `SPAN` (600) ticks, ten seconds of game time, with the faculty that removes
// things by distance running the whole way.
//
// THE WORLD. An isolated `playing` run with `despawning` alone turned back on,
// so the one faculty that removes anything by distance is the faculty running
// while the gem lies there, and nothing else in the night can move the gem,
// collect it, or drop another. Nothing is alive for the director to despawn,
// which is the point: what is being read is that the rule does not reach the
// gem. 3000 units is far outside `pickupRadius`, so the gem is never attracted
// and never flies in to be collected.
//
// WHAT IS READ. After 600 ticks: the gem still on the field, unattracted, at
// the point it was placed.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on each coordinate of a gem that never
// moved; none on the count or on `attracted`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { MOTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { gemOf } from "./night";

/** Where the gem lies: far outside the view and far outside pickupRadius. */
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

it("keeps a gem 3000 units out on the field across 600 ticks with despawning on", async () => {
  const posed = isolate(h);
  enable(h, "despawning");
  const { player } = posed.run;
  const at = { x: player.x + FAR, y: player.y };
  const gem = spawnGemAt(h, "small", at.x, at.y);

  const after = await h.tick(SPAN);
  captureStill(h, "kept");

  assertEqual(after.despawning, true, "the despawning switch across the span");
  assertLength(after.run.gems, 1, `gems left after ${SPAN} ticks`);
  const seen = gemOf(after, gem);
  assertEqual(seen.attracted, false, "the distant gem's attracted flag");
  assertWithin(
    seen.x,
    at.x,
    MOTION_TOLERANCE,
    `the gem's x after ${SPAN} ticks`,
  );
  assertWithin(
    seen.y,
    at.y,
    MOTION_TOLERANCE,
    `the gem's y after ${SPAN} ticks`,
  );
});
