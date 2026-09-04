// firing/fires-in-range — a structure with a target inside its radius shoots.
//
// specs/components.md fixes it for every firing structure: "Range is a radius
// measured from the center of the structure's footprint. A unit whose position
// lies within that radius is a valid target, ground or flying", and "A structure
// fires at its fire rate, in shots per second, whenever it has a valid target in
// range". Every shot is "a traveling projectile", launched from the structure's
// centre, so the shot is visible in the snapshot's `projectiles` as well as in the
// structure's own `firing` flag.
//
// The yard holds one Capacitor and one unit and nothing else. The unit is held
// where it stands — a held unit "keeps every faculty but travel"
// (specs/instrumentation.md) — so it is a valid target for the whole drive and
// cannot walk out of the radius while the check is watching. It is a Dynamo,
// whose health at this wave is far more than the drive can remove, so the shooting
// cannot stop because the target ran out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  componentRange,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
  type Harness,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** Comfortably inside the Scrap Capacitor's `100`. */
const TARGET_RANGE = 60;

/** How long the shot is waited for, and the tail recorded after it. */
const PATIENCE = 5;
const AFTERMATH = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("launches a projectile at a unit inside the radius and reports firing", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  parkUnit(h, "dynamo", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  const shot = await captureReplay(h, "fire", async () => {
    const found = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(PATIENCE),
      poll: 1,
    });
    await h.advanceSeconds(AFTERMATH);
    return found;
  });

  assertEqual(
    shot.hit,
    true,
    `a projectile within ${PATIENCE}s of a unit standing ${TARGET_RANGE} from ` +
      `the centre of a structure whose radius is ` +
      `${componentRange("capacitor", 1)} (specs/components.md)`,
  );
  assertGreaterThan(
    shot.snapshot.projectiles.length,
    0,
    "projectiles in flight on the frame the shot appeared",
  );
  assertEqual(
    structureById(shot.snapshot, id).firing,
    true,
    "the structure's firing flag with a valid target in range",
  );
  // And the shot really was aimed at the unit that was standing there.
  assertEqual(
    shot.snapshot.projectiles[0]!.targetId,
    shot.snapshot.units[0]!.id,
    "the projectile's target",
  );
});
