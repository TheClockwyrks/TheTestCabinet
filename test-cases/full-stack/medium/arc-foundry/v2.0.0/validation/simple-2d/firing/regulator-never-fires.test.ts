// firing/regulator-never-fires — the one base type that never shoots.
//
// specs/components.md names it and states the whole of it: "The Regulator never
// fires: it has no range, no damage, no firing head, no projectile, and no
// targeting priority, and its aura is its whole reach." specs/instrumentation.md
// reports the same shape: "A Regulator reports its `auraRadius` and `auraBonus`
// with zero `damage`", and `targeting` is a field a non-firing structure reports
// as `null`.
//
// The scenario is the hardest case there is for a build that fires by accident: a
// unit standing directly on top of the Regulator, so no radius however small can
// exclude it, held there for ten seconds. Nothing else is on the yard, so any
// projectile that appears is the Regulator's. The `range` reading admits either
// spelling of "no range", `0` or `null`, because specs/instrumentation.md types
// the field as a number and gives `0` as the resting value a structure that does
// not use it reports.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  TICK_HZ,
  unitById,
  type Harness,
} from "../harness";
import { PROJECTILE_HIT_R, PROJECTILE_SPEED } from "../constants";

const ANCHOR = { col: 10, row: 10 };

/**
 * The frame the watch is stepped in, in Hz.
 *
 * THE BOUND IS COMPUTED FROM FIGURES THE SPECS STATE. A projectile the Regulator
 * must never launch would fly straight at the point it was aimed at, at
 * `PROJECTILE_SPEED`, and land "when the projectile comes within
 * `PROJECTILE_HIT_R` of that position" (`specs/components.md`). A step shorter
 * than the full width of that window — `2 * PROJECTILE_HIT_R` — cannot carry such
 * a shot from outside the window to outside it in one frame, so
 * `PROJECTILE_SPEED / (2 * PROJECTILE_HIT_R)` is the floor on the rate a shot
 * stays readable at. `specs/instrumentation.md` fixes no frame size otherwise, and
 * `instrumentation/frame-division-movement` and
 * `instrumentation/frame-division-projectile` are the two items that decide that
 * guarantee, so the watch takes half the project's own frame, which clears the
 * floor with room to spare.
 *
 * The ten seconds the item is stated over are unchanged, and so is how often the
 * yard is read: {@link SAMPLE_SECONDS} is a span of simulation time, not a frame
 * count, so the same number of readings falls across the same interval.
 */
const WATCH_HZ = Math.max(
  TICK_HZ / 2,
  Math.ceil(PROJECTILE_SPEED / (2 * PROJECTILE_HIT_R)),
);

/** How long the Regulator is watched, in seconds. */
const WATCHED = 10;

/** How far apart two readings of the yard fall, in seconds of simulation. */
const SAMPLE_SECONDS = 1 / 30;

/** That interval, in frames of the watching clock. */
const SAMPLE_FRAMES = Math.max(1, Math.round(SAMPLE_SECONDS * WATCH_HZ));

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / WATCH_HZ) });
});

afterEach(() => {
  h.dispose();
});

it("launches nothing over ten seconds with a unit standing on it", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "regulator", 3, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  const target = parkUnit(h, "dynamo", {
    x: structure.cx,
    y: structure.cy,
  });

  const watched = await captureReplay(h, "quiet", () =>
    h.until((s) => s.projectiles.length > 0, {
      maxFrames: Math.ceil(WATCHED * WATCH_HZ),
      poll: SAMPLE_FRAMES,
    }),
  );

  assertEqual(
    watched.hit,
    false,
    `no projectile over ${WATCHED}s with a unit standing on the Regulator ` +
      `itself (specs/components.md)`,
  );

  const after = structureById(watched.snapshot, id);
  assertEqual(after.firing, false, "the Regulator's firing flag");
  assertEqual(after.damage, 0, "the Regulator's damage (specs/components.md)");
  assertEqual(
    after.targeting,
    null,
    "the Regulator's targeting priority: it has none (specs/components.md)",
  );
  assertEqual(
    after.range ?? 0,
    0,
    "the Regulator's range: it has none (specs/components.md)",
  );
  assertEqual(
    after.damageDealt,
    0,
    "the Regulator's damage tally after ten seconds under a unit",
  );
  const unit = unitById(watched.snapshot, target);
  assertEqual(unit.hp, unit.maxHp, "the health of the unit standing on it");
});
