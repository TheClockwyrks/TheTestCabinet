// firing/head-holds-heading — the head keeps its last bearing when the shooting stops.
//
// specs/components.md fixes both halves of the sentence, and this is the second:
// a head "rotates to face the unit it is firing at and holds its last heading
// while it holds fire". A build that snaps a head back to a resting angle the
// moment its target dies makes a yard of turrets twitch on every kill, which is
// why this is a point of its own rather than part of the rotation point.
//
// The head is settled on a bearing well off both axes — so a resting angle of `0`,
// or of any other round number, is not the bearing it is holding — and the Load is
// then cleared. Two seconds later the structure must report that it is no longer
// firing and must report the same heading it last fired on.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** Off both axes, and inside the Scrap Capacitor's `100`. */
const OFFSET = { x: 60, y: 40 };

/** How long the head is given to settle, and how long it is then watched. */
const SETTLE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the heading it last fired on once its target is gone", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  parkUnit(h, "dynamo", {
    x: structure.cx + OFFSET.x,
    y: structure.cy + OFFSET.y,
  });

  await h.advanceSeconds(SETTLE);
  const firing = structureById(h.snapshot(), id);
  assertEqual(firing.firing, true, "the structure firing before the clear");

  h.debug.clearUnits();
  h.debug.clearProjectiles();
  await h.advanceSeconds(SETTLE);
  captureStill(h, "held");

  const held = structureById(h.snapshot(), id);
  assertEqual(held.firing, false, "the structure's firing flag with no target");
  assertCloseTo(
    held.heading,
    firing.heading,
    6,
    `the heading held ${SETTLE}s after the target went, against the one it ` +
      `last fired on (specs/components.md)`,
  );
});
