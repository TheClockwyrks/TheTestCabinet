// combos/crit — a critical hit removes critMult times the shot's damage.
//
// specs/components.md: "Each shot has the stated chance to deal `critMult` times
// its damage instead of its damage. The roll comes off the game's seeded
// generator." specs/combinations.md gives the Slag Driver `crit(0.25, 2.0)`, a
// reference damage of `120` and a cadence of `0.6` /s, and neither file states
// any rounding of the product. The Slag Driver is the one tower in the table
// whose only ability is the crit, so every point it tallies is a shot's and none
// of it is a burn's.
//
// THE TARGET IS THE ONE UNIT THAT CANNOT DIE. Reading a long series of shots
// needs a target that outlives them and never changes what a tower is aiming at,
// and specs/enemies.md gives exactly one: the Overload Dynamo, which "cannot be
// killed", carries no depleting health, and takes every point dealt to it as a
// tally rather than as damage. It is released frozen inside every tower's reach,
// so it neither walks out of range nor grounds out.
//
// SIXTEEN TOWERS, ONE TARGET. specs/components.md keeps a running total of the
// damage each firing structure dealt, so the increase in ONE tower's tally
// between two samples is one of that tower's shots. Sixteen towers ring the unit,
// each read as its own series, which is what makes ninety-six shots affordable at
// a cadence of one every `1.667` s: the SAMPLE is bought with subjects rather than
// with seconds, so the same ninety-six shots fall inside ten seconds of simulation
// rather than forty. Samples are `0.5` s apart, so no sample of any one tower can
// hold two of its shots.
//
// Every increase must be the shot's damage or `critMult` times it and nothing
// else, and across `96` shots at the seeded generator both must appear: a build
// whose chance is the stated `0.25` misses a crit that many times about once in
// ten billion runs, and misses an ordinary hit far less often than that.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  standCombo,
  structureById,
  TICK_HZ,
} from "../harness";
import {
  comboDamage,
  comboDef,
  PROJECTILE_HIT_R,
  PROJECTILE_SPEED,
  structureCenter,
} from "../constants";

const TOWER = comboDef("slagdriver");
/** The multiplier of the `crit(chance, multiplier)` its row names. */
const CRIT_MULT = TOWER.abilities.crit!.multiplier;
const LEVEL = 3;

/**
 * Sixteen anchors around one point: a four-by-four block, two tiles apart so no
 * two footprints overlap, every one inside the `175 + 12` they reach.
 */
const ANCHOR_COLS = [10, 12, 14, 16];
const ANCHOR_ROWS = [10, 12, 14, 16];
const ANCHORS = ANCHOR_ROWS.flatMap((row) =>
  ANCHOR_COLS.map((col) => ({ col, row })),
);
/** The middle of the block, about `85` units from the furthest tower's center. */
const TARGET = {
  x:
    (structureCenter(ANCHORS[0]!.col, ANCHORS[0]!.row).x +
      structureCenter(
        ANCHORS[ANCHORS.length - 1]!.col,
        ANCHORS[ANCHORS.length - 1]!.row,
      ).x) /
    2,
  y:
    (structureCenter(ANCHORS[0]!.col, ANCHORS[0]!.row).y +
      structureCenter(
        ANCHORS[ANCHORS.length - 1]!.col,
        ANCHORS[ANCHORS.length - 1]!.row,
      ).y) /
    2,
};

/**
 * The frame the counted interval is stepped in, in Hz.
 *
 * THE BOUND IS COMPUTED FROM FIGURES THE SPECS STATE. A shot flies straight at the
 * point it was aimed at, at `PROJECTILE_SPEED`, and lands "when the projectile
 * comes within `PROJECTILE_HIT_R` of that position" (`specs/components.md`); the
 * target is held still, so the aim point does not move and the flight closes on it
 * monotonically. A step shorter than the full width of that window —
 * `2 * PROJECTILE_HIT_R` — cannot carry a shot from outside the window to outside
 * it in one frame, which makes `PROJECTILE_SPEED / (2 * PROJECTILE_HIT_R)` the
 * floor on the rate. `specs/instrumentation.md` fixes no frame size otherwise, and
 * `instrumentation/frame-division-movement` and
 * `instrumentation/frame-division-projectile` are the two items that decide that
 * guarantee, so the interval takes half the project's own frame, which clears the
 * floor with room to spare.
 *
 * WHAT THE SAMPLING DOES NOT DEPEND ON IS THE FRAME. Two readings of a tally fall
 * {@link SAMPLE_SECONDS} apart in SIMULATION time, so the argument that no sample
 * of one tower can hold two of its shots is the cadence's, not the clock's.
 */
const CRIT_HZ = Math.max(
  TICK_HZ / 2,
  Math.ceil(PROJECTILE_SPEED / (2 * PROJECTILE_HIT_R)),
);

/** How far apart two readings of a tally fall, in seconds of simulation. */
const SAMPLE_SECONDS = 0.5;

/** That interval, in frames of the counting clock. */
const SAMPLE = Math.round(SAMPLE_SECONDS * CRIT_HZ);

/** The counted interval: `10` s at `0.6` /s across sixteen towers is `96` shots. */
const SECONDS = 10;
const SAMPLES = Math.round(SECONDS / SAMPLE_SECONDS);

/** A tally moved by less than this is floating-point noise, not a shot. */
const NOISE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / CRIT_HZ) });
});

afterEach(() => {
  h.dispose();
});

it("deals either the shot's damage or critMult times it, and both appear", async () => {
  openYard(h);
  const towers: number[] = [];
  for (const anchor of ANCHORS) {
    towers.push(standCombo(h, TOWER.id, anchor.col, anchor.row, LEVEL));
  }
  parkUnit(h, "overload", TARGET);

  const damage = comboDamage(TOWER.id, LEVEL);
  const shots: number[] = [];

  await captureReplay(h, "crit", async () => {
    const tallied = new Map<number, number>();
    const opening = h.snapshot();
    for (const id of towers) {
      tallied.set(id, structureById(opening, id).damageDealt);
    }
    for (let n = 0; n < SAMPLES; n += 1) {
      await h.advance(SAMPLE);
      const s = h.snapshot();
      for (const id of towers) {
        const now = structureById(s, id).damageDealt;
        if (now - tallied.get(id)! > NOISE) shots.push(now - tallied.get(id)!);
        tallied.set(id, now);
      }
    }
  });

  assertGreaterThan(shots.length, 0, `the ${TOWER.name}s fired at all`);

  const ordinary = shots.filter((shot) => Math.abs(shot - damage) < NOISE);
  const critical = shots.filter(
    (shot) => Math.abs(shot - damage * CRIT_MULT) < NOISE,
  );
  assertEqual(
    shots.length - ordinary.length - critical.length,
    0,
    `every shot to remove ${damage} or ${damage * CRIT_MULT}; the shots were ` +
      shots.map((shot) => String(shot)).join(", "),
  );
  assertGreaterThan(
    ordinary.length,
    0,
    `an ordinary hit of ${damage} among ${shots.length} shots`,
  );
  assertGreaterThan(
    critical.length,
    0,
    `a critical hit of ${damage * CRIT_MULT} among ${shots.length} shots`,
  );
});
