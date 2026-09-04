// firing/holds-fire-out-of-range — a structure with nothing in range holds fire.
//
// specs/components.md fixes the radius as a real bound: "A unit whose position lies
// within that radius is a valid target", and a structure "fires at its fire rate
// ... whenever it has a valid target in range, and holds fire otherwise". This is
// the other direction of `fires-in-range`, and its own point: a build that fires at
// everything on the yard and a build that never fires are two different failures.
//
// The unit is parked one logical unit beyond the radius specs/components.md gives
// the structure — `100` at Scrap — and held there, so it cannot drift into range
// while the check is watching. Five seconds is more than three of this
// structure's cadences, so a build that fires at it has ample room to be caught.
// Three readings say it held: no projectile ever appeared, the structure's
// `firing` flag stayed down, and its damage tally never moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  componentRange,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
  unitById,
  type Harness,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** One unit beyond the Scrap Capacitor's radius. */
const BEYOND = componentRange("capacitor", 1) + 1;

/** How long the structure is watched, in seconds. */
const WATCHED = 5;

/** Frames between samples: a shot at this range would be in flight far longer. */
const SAMPLE_FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("launches nothing at a unit one unit beyond the radius", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  const target = parkUnit(h, "dynamo", {
    x: structure.cx + BEYOND,
    y: structure.cy,
  });

  const watched = await captureReplay(h, "hold", () =>
    h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(WATCHED),
      poll: SAMPLE_FRAMES,
    }),
  );

  assertEqual(
    watched.hit,
    false,
    `no projectile over ${WATCHED}s with the only unit standing ${BEYOND} from ` +
      `a centre whose radius is ${componentRange("capacitor", 1)}`,
  );
  const after = watched.snapshot;
  assertEqual(
    structureById(after, id).firing,
    false,
    "the structure's firing flag with nothing in range",
  );
  assertEqual(
    structureById(after, id).damageDealt,
    0,
    "the structure's damage tally after holding fire",
  );
  const unit = unitById(after, target);
  assertEqual(unit.hp, unit.maxHp, "the out-of-range unit's health");
});
