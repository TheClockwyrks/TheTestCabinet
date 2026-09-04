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
// FOUR TOWERS, ONE TARGET. specs/components.md keeps a running total of the
// damage each firing structure dealt, so the increase in ONE tower's tally
// between two samples is one of that tower's shots. Four towers ring the unit,
// each read as its own series, which is what makes a hundred shots affordable at
// a cadence of one every `1.667` s. Samples are `0.5` s apart, so no sample of
// any one tower can hold two of its shots.
//
// Every increase must be the shot's damage or `critMult` times it and nothing
// else, and across `96` shots at the seeded generator both must appear: a build
// whose chance is the stated `0.25` misses a crit that many times about once in
// ten billion runs, and misses an ordinary hit far less often than that.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { comboDamage, comboDef, structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standCombo,
  structureById,
  type Harness,
} from "../harness";

const TOWER = comboDef("slagdriver");
/** The `crit(chance, multiplier)` its row names. */
const CRIT_MULT = 2.0;
const LEVEL = 3;

/** Four anchors around one point, every one inside the `175 + 12` they reach. */
const ANCHORS = [
  { col: 10, row: 10 },
  { col: 16, row: 10 },
  { col: 10, row: 16 },
  { col: 16, row: 16 },
];
/** The middle of the four, `85` units from each tower's center. */
const TARGET = {
  x:
    (structureCenter(ANCHORS[0]!.col, ANCHORS[0]!.row).x +
      structureCenter(ANCHORS[3]!.col, ANCHORS[3]!.row).x) /
    2,
  y:
    (structureCenter(ANCHORS[0]!.col, ANCHORS[0]!.row).y +
      structureCenter(ANCHORS[3]!.col, ANCHORS[3]!.row).y) /
    2,
};

/** Frames between two readings of a tally: well inside the `1.667` s cadence. */
const SAMPLE = 60;
/** `40` s at `0.6` /s across four towers is `96` shots. */
const SAMPLES = (40 * 120) / SAMPLE;

/** A tally moved by less than this is floating-point noise, not a shot. */
const NOISE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals either the shot's damage or critMult times it, and both appear", async () => {
  await openYard(h);
  const towers: number[] = [];
  for (const anchor of ANCHORS) {
    towers.push(await standCombo(h, TOWER.id, anchor.col, anchor.row, LEVEL));
  }
  await parkUnit(h, "overload", TARGET);

  const damage = comboDamage(TOWER.id, LEVEL);
  const shots: number[] = [];

  await captureReplay(h, "crit", async () => {
    const tallied = new Map<number, number>();
    const opening = await h.snapshot();
    for (const id of towers) {
      tallied.set(id, structureById(opening, id).damageDealt);
    }
    for (let n = 0; n < SAMPLES; n += 1) {
      await h.advance(SAMPLE);
      const s = await h.snapshot();
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
