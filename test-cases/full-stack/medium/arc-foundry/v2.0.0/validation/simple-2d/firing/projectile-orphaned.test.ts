// firing/projectile-orphaned — a shot whose target is gone deals nothing.
//
// specs/components.md fixes the edge case the travelling-projectile rule implies:
// "A projectile whose target is removed before it arrives is removed with it and
// deals nothing." It is its own point because a build can carry the hit correctly
// and still let an orphaned shot sail on into whatever is standing behind its
// target.
//
// One shot is fired down the long axis of a Discharge Rig's radius at a held unit,
// and the Load is cleared while the shot is still less than a third of the way
// there. Three readings decide it: the projectile is gone on the very next update,
// the structure's damage tally never moved, and a fresh unit stood exactly where
// the old one had been loses no health over the window that follows. The window is
// a fraction of this structure's two-second cadence, so nothing it reads can be a
// second shot: the Discharge Rig is chosen for this precisely because it is the
// slowest thing on the yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  distance,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
  unitById,
  type Harness,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** Well inside the Scrap Discharge Rig's `160`, so the flight is long. */
const TARGET_RANGE = 150;

/** Frames the shot is left in flight before its target is taken away. */
const FLOWN = 10;

/** How long "the next update" is given, in seconds. */
const NEXT_UPDATE = 0.05;

/** Frames the replacement unit is watched for, far inside one cadence. */
const WATCHED = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes the shot with its target and leaves what stood on its path untouched", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "discharge", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  const where = { x: structure.cx + TARGET_RANGE, y: structure.cy };
  parkUnit(h, "dynamo", where);

  const orphan = await captureReplay(h, "orphan", async () => {
    const launched = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(4),
      poll: 1,
    });
    await h.advance(FLOWN);
    const flying = h.snapshot();

    // The target goes while the shot is still a long way short of it.
    h.debug.clearUnits();
    await h.advanceSeconds(NEXT_UPDATE);
    const cleared = h.snapshot();

    // A fresh unit takes the old one's place, on the path the shot was on.
    const replacement = parkUnit(h, "dynamo", where);
    await h.advance(WATCHED);
    return {
      launched,
      flying,
      cleared,
      replacement,
      after: h.snapshot(),
    };
  });

  assertEqual(orphan.launched.hit, true, "a shot to orphan");
  // The shot really was mid-flight rather than already landed.
  assertEqual(
    orphan.flying.projectiles.length,
    1,
    "the shot still in flight when its target was taken away",
  );
  assertGreaterThan(
    distance(orphan.flying.projectiles[0]!, where),
    50,
    "how far the shot still had to travel when its target was taken away",
  );

  // It was removed with its target.
  assertEqual(
    orphan.cleared.projectiles.length,
    0,
    `projectiles left ${NEXT_UPDATE}s after the target was removed ` +
      `(specs/components.md)`,
  );

  // And it dealt nothing on the way.
  const unit = unitById(orphan.after, orphan.replacement);
  assertEqual(
    unit.hp,
    unit.maxHp,
    "the health of a unit standing where the orphaned shot was headed",
  );
  assertEqual(
    structureById(orphan.after, id).damageDealt,
    0,
    "the firing structure's damage tally after its shot was orphaned",
  );
});
