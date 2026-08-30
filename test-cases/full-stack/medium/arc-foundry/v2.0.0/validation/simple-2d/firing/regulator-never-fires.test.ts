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

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
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

/** How long the Regulator is watched, in seconds. */
const WATCHED = 10;

/** Frames between samples: any shot at this range would be in flight far longer. */
const SAMPLE_FRAMES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
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
      maxFrames: ticks(WATCHED),
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
