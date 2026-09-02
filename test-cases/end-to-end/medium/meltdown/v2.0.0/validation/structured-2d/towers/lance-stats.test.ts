// towers/lance-stats — the Lance carries the row specs/towers.md gives it.
//
// THE ROW. "| Lance | 4 | 150 | 12.0 | 0.8 | 43 | 48.9 | 92 | 2.8 | N, E |" — a 4x4 footprint, a
// build cost of `150`, `12.0` tiles of range, `0.8` shots a second, `43` base
// damage, `48.9` `heatPerShot`, a redline of `92`, a thermal mass of `2.8`, and
// radiator faces local N, E. Every figure below is that row and nothing else; what
// the figures MEAN is specs/combat.md's and specs/heat.md's business, and the items
// in `combat/` and `heat/` are where the rules that use them are decided.
//
// FOUR OF THE NINE ARE REPORTED AND FIVE ARE NOT. `size`, `redline` and
// `radiatorFaces` are snapshot fields, and the build cost is the `spent` an
// `addTower` opens a tower with (specs/instrumentation.md). Range, fire rate, base
// damage, `heatPerShot` and mass exist only in what the tower DOES, so each is
// measured out of the running game; `roster.ts` holds those drives and states why
// each one isolates the figure it isolates.
//
// WHY MASS IS READ TWICE OVER. One per-shot gain is `heatPerShot / mass`, and a
// single reading of it cannot tell `48.9` over `2.8` from `97.8` over `5.6`. So the
// mass appears in a SECOND, independent reading — the air a lone Lance sheds over one
// frame, which specs/heat.md also divides by the mass — and the pair pins both
// figures. At heat `80` the Lance must shed `10.74` a second; halving its mass reads
// `21.49` and doubling it reads `5.37`.
//
// WHY THE RANGE PROBE IS A PAIR AND NOT A NUMBER. specs/combat.md, Range: a unit is
// in range when it is "at most `range * TILE` logical units" from the footprint's
// centre, and "a unit one logical unit further out is not in range". So the boundary
// is read at exactly the resolution the specification states it at — one mark a unit
// inside `228.0` must be acquired, one a unit outside it must not. Each is posed on
// its own floor, so `targeting` answers the range question and specs/combat.md's
// target rule has nothing to choose between.
//
// WHY THE SHOT COUNT IS TAKEN IN UNITS OF THE FIRST SHOT. The hp a shot removes is
// the base damage figure, which this same row reads separately, so a count taken in
// hit points would fail the RATE reading for a build whose rate is perfect and whose
// damage is not. The count is a ratio of cumulative removals instead: a build that
// fires twice as hard passes it, and one that fires twice as often does not.
//
// THE LANCE IS THE ROSTER'S LONGEST REACH, HEAVIEST MASS AND HIGHEST REDLINE, and it
// shares its `150` cost with the Bloom — so `cost` alone cannot tell the two apart
// and every other figure in this row can. Its 12 tiles of range is `228` logical
// units, twice the Arc's, and it is measured from the centre of a 4x4 footprint
// whose anchor tile sits a tile and a half away, so a build measuring from the
// anchor reads the boundary in the wrong place by that much.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import {
  FREE_SITE,
  airLossPerSecond,
  coolingRate,
  costOf,
  figuresOf,
  firstShotHeat,
  heatMultiplierOf,
  localRadiators,
  markTypeFor,
  massOf,
  redlineOf,
  removalsAtShots,
  sortedFaces,
  targetsMarkAt,
  towerOf,
} from "./roster";

/** The tower this row belongs to, and the unit its shots are read against. */
const TOWER = "lance";
const MARK = markTypeFor(TOWER);

/** The row itself, off the case's own seeded table rather than off the build. */
const COST = costOf(TOWER); // 150
const SIZE = 4;
const RANGE_UNITS = figuresOf(TOWER).range * TILE; // 12.0 tiles, so 228.0
const FIRE_RATE = figuresOf(TOWER).fireRate; // 0.8 shots a second
const BASE_DAMAGE = figuresOf(TOWER).baseDamage; // 43
const HEAT_PER_SHOT = figuresOf(TOWER).heatPerShot; // 48.9
const REDLINE = redlineOf(TOWER); // 92
const MASS = massOf(TOWER); // 2.8
const RADIATORS = sortedFaces(localRadiators(TOWER)); // N, E

/**
 * How far either side of the range boundary a mark stands, in logical units.
 *
 * ONE UNIT, the resolution specs/combat.md states the boundary at: "at most
 * `range * TILE`" is in range and "one logical unit further out is not". A mark a
 * unit inside is inside on either reading of that bound — strict or inclusive — and
 * one a unit outside is outside on both, so a conformant build needs no room here
 * and the probe demands no particular reading of the "at most". It is geometry
 * rather than a tolerance: it says where the two marks stand.
 */
const BOUNDARY_MARGIN = 1;

/** The fire-interval checkpoints the drive stops at: none, one shot, then three. */
const CHECKPOINTS = [0, 1, 3];

/** Where the cooling reading is taken: a large air term, and clear of the trip. */
const COOL_HEAT = 80;

/**
 * How close each measured figure must come, as decimal places.
 *
 * `DAMAGE_DIGITS` two places is `0.005` hp against the `15.05` one shot must
 * remove at heat `0` (`43 * 0.35`). A build's own evaluation of one multiplication
 * over figures the specification states exactly needs none of that room; the bound
 * is orders below the distance to every other base damage on the roster.
 *
 * `COUNT_DIGITS` two places is `0.005` of a shot. Every shot of the drive removes
 * the same amount — the heat is pinned, so the multiplier cannot move — so the ratio
 * is an exact integer up to the float slack of a few subtractions. What the bound
 * excludes is every neighbouring rate: a build one shot behind or ahead at the
 * checkpoint reads a whole integer away.
 *
 * `GAIN_DIGITS` two places is `0.005` of a heat point against the `17.4643` one shot
 * must add. The reading is taken on a frame that opened at heat `0`, where the
 * specification's arithmetic for it is one division and nothing else.
 *
 * `RATE_DIGITS` one place is `0.05` of a heat point per second against the `10.74` a
 * lone Lance sheds at heat `80` — well under a percent of it, and two orders below
 * the distance to a wrong mass.
 */
const DAMAGE_DIGITS = 2;
const COUNT_DIGITS = 2;
const GAIN_DIGITS = 2;
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries every figure the Lance's row states", async () => {
  // ---- The five the snapshot reports outright -----------------------------
  startRun(h);
  const id = poseTower(h, TOWER, FREE_SITE.col, FREE_SITE.row);
  h.debug.setSelected(id);
  await h.advance(1);
  captureStill(h, "lance");
  const reported = towerOf(h.snapshot(), id);

  assertEqual(reported.size, SIZE, `the ${TOWER}'s footprint side, in tiles`);
  assertEqual(reported.redline, REDLINE, `the ${TOWER}'s redline`);
  assertDeepEqual(
    sortedFaces(reported.radiatorFaces),
    RADIATORS,
    `the ${TOWER}'s radiator faces at rotation 0, where world is local`,
  );
  assertEqual(
    reported.spent,
    COST,
    `the ${TOWER}'s build cost, as the spent a fresh tower opens with`,
  );
  assertCloseTo(
    reported.heatMult,
    heatMultiplierOf(0, REDLINE),
    DAMAGE_DIGITS,
    `the multiplier a ${TOWER} at heat 0 reports against its redline of ` +
      `${REDLINE}`,
  );
  assertCloseTo(
    reported.damage,
    BASE_DAMAGE * heatMultiplierOf(0, REDLINE),
    DAMAGE_DIGITS,
    `the damage a ${TOWER} at heat 0 reports: base damage ${BASE_DAMAGE} ` +
      `times the multiplier at heat 0 against a redline of ${REDLINE}`,
  );

  // ---- Range: a radius in tiles from the footprint centre ------------------
  assertEqual(
    await targetsMarkAt(h, TOWER, RANGE_UNITS - BOUNDARY_MARGIN),
    true,
    `a ${MARK} ${RANGE_UNITS - BOUNDARY_MARGIN} units from the ${TOWER}'s ` +
      `footprint centre acquired, inside its ${RANGE_UNITS}`,
  );
  assertEqual(
    await targetsMarkAt(h, TOWER, RANGE_UNITS + BOUNDARY_MARGIN),
    false,
    `a ${MARK} ${RANGE_UNITS + BOUNDARY_MARGIN} units from the ${TOWER}'s ` +
      `footprint centre refused, beyond its ${RANGE_UNITS}`,
  );

  // ---- Base damage, then the fire rate in units of one shot ----------------
  const removed = await removalsAtShots(h, TOWER, CHECKPOINTS);

  assertEqual(
    removed[0],
    0,
    `hp removed ${(0.5 / FIRE_RATE).toFixed(3)}s in, half an interval before ` +
      `the ${TOWER}'s first shot at ${FIRE_RATE} shots a second`,
  );
  assertGreaterThan(
    removed[1],
    0,
    `hp removed by the first shot, one ${(1 / FIRE_RATE).toFixed(3)}s interval in`,
  );
  assertCloseTo(
    removed[1],
    BASE_DAMAGE * heatMultiplierOf(0, REDLINE),
    DAMAGE_DIGITS,
    `hp one ${TOWER} shot removes at heat 0: base damage ${BASE_DAMAGE} times ` +
      `the multiplier at heat 0 against a redline of ${REDLINE}`,
  );
  assertCloseTo(
    removed[2] / removed[1],
    CHECKPOINTS[2],
    COUNT_DIGITS,
    `shots resolved by ${((CHECKPOINTS[2] + 0.5) / FIRE_RATE).toFixed(3)}s at ` +
      `${FIRE_RATE} shots a second, in units of the first shot`,
  );

  // ---- heatPerShot, then the mass that divides it and the air alike --------
  assertCloseTo(
    await firstShotHeat(h, TOWER),
    HEAT_PER_SHOT / MASS,
    GAIN_DIGITS,
    `heat one shot adds to a ${TOWER} opening at 0: heatPerShot ` +
      `${HEAT_PER_SHOT} over a mass of ${MASS}`,
  );
  assertCloseTo(
    await coolingRate(h, TOWER, COOL_HEAT),
    airLossPerSecond(TOWER, COOL_HEAT) / MASS,
    RATE_DIGITS,
    `heat per second a lone ${TOWER} at ${COOL_HEAT} sheds: its air term over ` +
      `a mass of ${MASS}`,
  );
});
