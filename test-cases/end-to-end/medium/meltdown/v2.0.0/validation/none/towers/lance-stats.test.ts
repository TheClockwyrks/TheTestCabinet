// towers/lance-stats — the Lance's row of `specs/towers.md`'s roster, figure by
// figure.
//
// `specs/towers.md`, The emitters, gives the Lance: cost 150, size 4, range 12.0,
// fire rate 0.8, base damage 43, `heatPerShot` 48.9, redline 92, mass 2.8, and
// radiators N and E.
//
// FOUR OF THE NINE FIGURES ARE IN THE SNAPSHOT AND FIVE ARE NOT, so five are
// measured where the specification says they act. `towers/probes.ts` takes all
// nine off one tower standing alone on a quiet anchor, and the note at the head of
// that file states why its legs run in the order they do; every bound the readings
// are held to is below, in this check.
//
//   COST is `spent`. `specs/instrumentation.md` puts an added tower's `spent`
//   "equal to its build cost", so the figure the build charges for this type is
//   read without spending a coin or running a placement check.
//
//   SIZE and REDLINE are reported outright, and `specs/towers.md` fixes both at
//   every level.
//
//   RADIATORS are `radiatorFaces` at rotation `0`, which
//   `specs/towers.md` defines as "the tower's local orientation". What a rotation
//   then does to them is `towers/rotation-*`'s requirement.
//
//   RANGE is measured by what the tower will TARGET. `specs/combat.md`: "A surge
//   unit is in range when the distance from that centre to the unit's centre is at
//   most `range * TILE` logical units", and `targeting` reports "the id of the unit
//   it is firing on". One unit is walked to a point just inside that boundary and
//   then just outside it, so the pair straddles the figure rather than sampling
//   somewhere near it: a build with a shorter range fails the inside probe and one
//   with a longer range fails the outside probe.
//
//   FIRE RATE is counted in units of the window's own first shot, so what is graded
//   is how OFTEN this tower fires and not how hard. The window stops half an
//   interval past the shot it counts to, the furthest point from either boundary.
//
//   BASE DAMAGE is `damage` read at heat `0`. `specs/heat.md` puts
//   `heatMultiplier(H, R) = 0.35 + 3.15 * (min(H, R) / R)^2`, which at `H = 0` is
//   `MIN_HEAT_MULT` for every redline there is — so reading it there separates the
//   base damage from the redline entirely, and the figure due is
//   `baseDamage * 0.35` whatever this tower's redline turns out to be.
//
//   MASS and heatPerShot ARE ONE PAIR OF READINGS, because neither is observable
//   on its own. `specs/heat.md` divides the whole of a frame's change by the mass,
//   so a shot from cold leaves `heatPerShot / mass` and one frame of air cooling
//   removes `airLoss * dt / mass` — two equations whose only unknowns are the two
//   figures. The cooling frame settles the mass, since its `airLoss` coefficient is
//   fixed by the specification's own `RAD_K` and `BASE_K` over a face layout this
//   check has already asserted; the shot then settles `heatPerShot` at that mass.
//   Reading the shot alone would pass a build that doubled both.
//
// THE ROW AT EVERY EXTREME. The Lance "hits hardest at the longest range, heats
// slowly for its bulk, and has the highest redline, so it wants feeding"
// (`specs/towers.md`): the largest footprint on the roster, the longest range, the
// slowest rate, the heaviest mass and the largest per-shot heat. Its cost of `150`
// is shared with the Bloom and nothing else about it is shared with anything, so a
// build that scaled one figure off another lands wrong here first.
//
// THE SLOWEST RATE IS WHY THE WINDOW IS THE LONGEST. At `0.8` shots a second the
// window below spends over fifteen seconds of game time; the harness runs those
// frames in one crossing, so the cost is the game's own arithmetic and nothing
// else. Counting fewer shots instead would not do: the window has to hold enough
// shots that a wrong rate cannot land on the same whole number, and that is what
// fixes the count rather than the clock.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
} from "../assert";
import { MIN_HEAT_MULT, TILE, worldRadiators } from "../constants";
import { FREE_SITE } from "../fixtures";
import { captureStill, createHarness, type Harness } from "../harness";
import { readEmitter } from "./probes";
import { airCoefficient, emitterDefOf } from "./roster";

/** The row under test, and the quiet anchor the tower stands alone on. */
const TYPE = "lance";
const DEF = emitterDefOf(TYPE);
const AT = FREE_SITE;

/**
 * The heat the one cooling frame opens at.
 *
 * Air cooling is proportional to `H / 100` (`specs/heat.md`), so a frame opening
 * at `0` sheds nothing and measures nothing; `80` is high enough that one frame's
 * loss is four significant figures of signal, and twenty clear of the `100` where
 * `specs/heat.md` puts the trip, so nothing can trip while the frame runs.
 * Geometry, not a tolerance.
 */
const COOL_HEAT = 80;

/**
 * How many shots the rate window is driven to.
 *
 * A window of `(shots + 0.5) / fireRate` seconds resolves whole shots, so a build
 * firing at `r'` where `r` is due lands `floor((shots + 0.5) * r' / r)` of them —
 * a count that only separates rates further apart than `0.5 / (shots + 0.5)`.
 * Twelve shots puts that at four percent, which is comfortably finer than the
 * closest two rates on the roster (`2.4` against `2.6`, eight percent apart) and
 * than the `1.15` an upgrade multiplies a rate by. Geometry, not a tolerance: the
 * band the count is held to is below.
 */
const SHOTS = 12;

/**
 * How far inside and outside the range boundary the two targeting probes sit, in
 * logical units.
 *
 * `specs/combat.md` puts the boundary at `range * TILE` and says "a unit one
 * logical unit further out is not in range", so one unit is the finest the
 * specification itself distinguishes and two is an honest margin either side of a
 * boundary read a round trip away. Against what has to stay separated it is tiny:
 * the closest two ranges on the roster are `9.5` units apart and one upgrade adds
 * `19`.
 */
const RANGE_MARGIN = 2;

/**
 * How close the counted shots must come, as decimal places.
 *
 * Two places is `0.005` of a shot. With the heat pinned every shot of the window
 * removes exactly the same hp (`specs/instrumentation.md`, the thermal gate), so
 * the ratio of the window's damage to its first shot's is a whole number up to the
 * float slack of a dozen additions. The bound is there to exclude a count out by a
 * whole shot, which is what any wrong rate produces.
 */
const SHOT_DIGITS = 2;

/**
 * How far the per-shot damage may sit from `baseDamage * MIN_HEAT_MULT`.
 *
 * Exact arithmetic on both sides, so this band is float noise alone. For scale,
 * the closest two base damages on the roster are two whole points apart, which is
 * `0.7` of a point once the cold multiplier is applied — seventy times this.
 */
const DAMAGE_TOLERANCE = 0.01;

/**
 * How far the measured mass may sit from the figure the roster gives it.
 *
 * The cooling frame is one frame of exact arithmetic on both sides — every term of
 * `specs/heat.md`'s resolution but `airLoss` is zero for a tower alone on open
 * floor with its guns off — so this band, like the one above, exists for float
 * noise. The closest two masses on the roster are `0.9` and `1.0`, five times this
 * apart.
 */
const MASS_TOLERANCE = 0.02;

/**
 * How far the measured `heatPerShot` may sit from the roster's figure.
 *
 * It carries the mass reading's own error as well as its own, and both are exact
 * arithmetic, so this is float noise twice over. The closest two figures on the
 * roster are `9.6` and `10.3`, fourteen times this apart.
 */
const HEAT_PER_SHOT_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("carries the cost, footprint, range, rate, damage, heat and radiators the roster gives the Lance", async () => {
  const read = await readEmitter(h, TYPE, AT, {
    coolHeat: COOL_HEAT,
    shots: SHOTS,
    rangeMargin: RANGE_MARGIN,
  });

  await h.debug.setSelected(read.id);
  await h.advance(1);
  await captureStill(h, "lance");

  /* ---- The four figures the snapshot carries outright -------------------- */

  assertEqual(
    read.spent,
    DEF.cost,
    "the build cost the Lance charges, which specs/instrumentation.md puts " +
      "into an added tower's spent",
  );
  assertEqual(
    read.size,
    DEF.size,
    "the side of the Lance's footprint, in tiles",
  );
  assertEqual(read.redline, DEF.redline, "the Lance's redline");
  assertDeepEqual(
    read.radiatorFaces,
    [...worldRadiators(TYPE, 0)].sort(),
    "the Lance's radiator faces at rotation 0, its local orientation",
  );

  /* ---- Range: one target either side of the boundary --------------------- */

  assertEqual(
    read.insideTaken,
    true,
    `the Lance to take a target ${RANGE_MARGIN} logical units inside its ` +
      `range of ${DEF.range} tiles, which specs/combat.md puts at ` +
      `${DEF.range * TILE} units from the footprint's centre`,
  );
  assertEqual(
    read.outsideTaken,
    false,
    `the Lance to leave a target ${RANGE_MARGIN} logical units outside that ` +
      `same ${DEF.range * TILE}-unit boundary alone`,
  );

  /* ---- Fire rate: shots counted in units of the first ------------------- */

  assertCloseTo(
    read.shotsCounted,
    SHOTS,
    SHOT_DIGITS,
    `shots a Lance at ${DEF.fireRate}/s resolved in ` +
      `${(SHOTS + 0.5) / DEF.fireRate}s of game time`,
  );

  /* ---- Base damage: read where the multiplier is the same for every row -- */

  assertBetween(
    read.damageWhenCold,
    DEF.baseDamage * MIN_HEAT_MULT - DAMAGE_TOLERANCE,
    DEF.baseDamage * MIN_HEAT_MULT + DAMAGE_TOLERANCE,
    `the Lance's per-shot damage at heat 0: a base damage of ` +
      `${DEF.baseDamage} scaled by heatMultiplier(0, ${DEF.redline}), which ` +
      `specs/heat.md puts at ${MIN_HEAT_MULT}`,
  );

  /* ---- Mass and heatPerShot: the pair, settled in that order ------------- */

  assertBetween(
    read.mass,
    DEF.mass - MASS_TOLERANCE,
    DEF.mass + MASS_TOLERANCE,
    `the Lance's thermal mass, from the ${read.coolLoss.toFixed(5)} of heat ` +
      `one frame of air cooling took off ${COOL_HEAT} at the coefficient ` +
      `specs/heat.md gives its faces, ${airCoefficient(TYPE)}`,
  );
  assertBetween(
    read.heatPerShot,
    DEF.heatPerShot - HEAT_PER_SHOT_TOLERANCE,
    DEF.heatPerShot + HEAT_PER_SHOT_TOLERANCE,
    `the Lance's heatPerShot, from the ${read.firstShotHeat.toFixed(5)} of ` +
      `heat its first shot from cold added over the mass measured above`,
  );
});
