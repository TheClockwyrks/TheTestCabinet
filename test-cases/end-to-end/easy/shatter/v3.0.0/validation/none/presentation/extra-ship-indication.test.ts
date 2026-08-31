// presentation/extra-ship-indication — an extra ship being granted is announced, and
// stays announced long enough to be seen.
//
// THE RULE. `specs/scoring.md`: "One extra ship is granted each time the score
// crosses a multiple of `EXTRA_LIFE_STEP` (`10 000`) through play... An extra ship
// being granted is announced on the field for at least half a second, distinctly
// from anything drawn there the moment before." A build that grants the ship
// silently has given the player something they never find out about, and the reserve
// row alone (`specs/ui.md`) does not announce it — a glyph appearing in a corner is
// not a thing drawn "on the field... distinctly".
//
// THE CROSSING IS A REAL KILL, not a posed score: `specs/instrumentation.md` states
// that "`setScore` grants no extra ship, whatever multiple of `EXTRA_LIFE_STEP` it
// carries", so the only way to a granted ship is through play. The score is posed at
// `SCORE_SAUCER` below the boundary and the saucer is shot down, which pays the
// `200` `specs/scoring.md` fixes and carries the score across.
//
// WHY THE SAUCER AND NOT A ROCK. Destroying the last rock on the field CLEARS THE
// WAVE (`specs/progression.md`), which raises a `WAVE N` banner over the field for a
// second and a half — a large thing drawn that was not there the moment before, and
// nothing to do with an extra ship. A field with no rocks on it has no wave to clear
// ("a field that holds no rocks and has had none destroyed on that tick is a wave
// being played, not a wave cleared"), so the saucer's `200` is the one kill that
// crosses a boundary and changes nothing else.
//
// WHAT THE READING IS COMPARED AGAINST, AND WHY IT IS NOT THE TICK BEFORE. The score
// and the reserve row both change on the crossing, so a frame from before the kill
// differs from one after it wherever the build drew its HUD, and no amount of
// excluding regions can tell that apart from an announcement without knowing where
// the build put its readouts. So the frame compared against is posed rather than
// remembered: before the shot is fired, the score and the lives are posed forward to
// exactly where the kill will leave them and the field is read. That picture holds
// everything the after-kill picture holds — the same HUD, the same star, the same
// ship — except the announcement, which no pose can produce.
//
// AND THE DISC AROUND THE KILL IS IGNORED, because the saucer is on the field in the
// posed picture and gone from the after-kill one, and the round that killed it flew
// there. `KILL_CLEARANCE` is `120`, several times the `SAUCER_R` a craft is drawn
// about and well past the `25` the round is placed at.
//
// THE THREE READINGS ARE THE "AT LEAST HALF A SECOND". One a tick after the kill,
// one a quarter of a second in, and one two ticks short of `EXTRA_LIFE_SHOW_MIN`.
// All three must carry the announcement — which is also what separates an
// announcement from a build's own kill flash, since a flash is gone long before the
// half second is up.
//
// AND THE FLOOR IS THE BUILD'S OWN. `specs/overview.md` lets a build draw what it
// likes behind the bodies, animation included, so the posed picture is read TWICE
// over the same span the readings cover and whatever changed between those two is
// added to the bar. A build with a drifting starfield must announce more than its
// starfield drifts.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertNull, fail } from "../assert";
import {
  EXTRA_LIFE_SHOW_MIN,
  EXTRA_LIFE_STEP,
  SCORE_SAUCER,
  START_LIVES,
} from "../constants";
import { wrappedDistance, type Vec } from "../geometry";
import {
  captureStill,
  createHarness,
  driveBullet,
  fireAt,
  poseSaucer,
  requireSaucer,
  sampleField,
  saucerTarget,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { changedCells, readInk } from "./ink";
import { KILL_SPOT, SHIP_SPOT, WHOLE_FIELD } from "./scene";

/** The score the saucer's `200` is paid onto, so the kill lands exactly on `10 000`. */
const BEFORE_SCORE = EXTRA_LIFE_STEP - SCORE_SAUCER;

/**
 * One cell of the reading, in logical units.
 *
 * Three: each cell carries the furthest any of its nine pixels fell from the field,
 * so a mark drawn as thin as a single unit of stroke still lights the cell it falls
 * in, while the whole field reduces to about a hundred thousand readings rather than
 * a million.
 */
const CELL = 3;

/** How much a cell's ink must move to count as changed, of 441. */
const CHANGE = 60;

/**
 * How far from where the kill happened a change must be to be the announcement, in
 * logical units.
 *
 * `120`: several times the `SAUCER_R` (`18`) a craft is drawn about, and well past
 * the `25` outside its surface the round is placed at, so the saucer's own drawing
 * and the shot that took it are both inside and neither is read as an announcement.
 */
const KILL_CLEARANCE = 120;

/**
 * How many cells of the field the announcement must cover, above the build's own
 * floor.
 *
 * Forty cells is three hundred and sixty square units — a mark about nineteen units
 * on a side, which is smaller than the ship. Low enough for a modest badge and far
 * above what a single anti-aliased edge moves.
 */
const MIN_AWARD = 40;

/** Ticks after the kill each of the three readings is taken at. */
const READ_AT = [1, ticksFor(0.25), ticksFor(EXTRA_LIFE_SHOW_MIN) - 2] as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("draws something on the field for the whole of the half second after a crossing kill", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  await poseSaucer(harness, KILL_SPOT.x, KILL_SPOT.y, {
    mind: false,
    gun: false,
    travel: false,
  });
  await harness.debug.setScore(BEFORE_SCORE);
  await harness.advance(1);

  const saucer = requireSaucer(await harness.snapshot(), "the posed saucer");
  const field = await sampleField(harness);
  const awayFromKill = (at: Vec): boolean =>
    wrappedDistance(at, saucer) > KILL_CLEARANCE;

  // The picture the kill will leave, minus the announcement: the readouts posed
  // forward, granting nothing (specs/instrumentation.md).
  await harness.debug.setScore(EXTRA_LIFE_STEP);
  await harness.debug.setLives(START_LIVES + 1);
  await harness.advance(1);
  const posed = await readInk(harness, WHOLE_FIELD, CELL, field);
  await harness.advance(READ_AT[READ_AT.length - 1]);
  const again = await readInk(harness, WHOLE_FIELD, CELL, field);
  const floor = changedCells(posed, again, CHANGE, awayFromKill).length;

  // And back to the tick before the kill.
  await harness.debug.setScore(BEFORE_SCORE);
  await harness.debug.setLives(START_LIVES);

  const round = await fireAt(harness, saucerTarget(saucer));
  const struck = await driveBullet(harness, round);
  assertNull(
    struck.snapshot.saucer,
    `the saucer destroyed by a round on its doorstep, so the ${SCORE_SAUCER} it pays carries the score across ${EXTRA_LIFE_STEP} (specs/collision.md)`,
  );
  if (struck.snapshot.score < EXTRA_LIFE_STEP) {
    fail(
      `a score of at least ${EXTRA_LIFE_STEP} after the kill, so a multiple of EXTRA_LIFE_STEP was crossed through play (specs/scoring.md)`,
      struck.snapshot.score,
    );
  }

  let driven = 0;
  for (const at of READ_AT) {
    await harness.advance(at - driven);
    driven = at;
    const shown = await readInk(harness, WHOLE_FIELD, CELL, field);
    // Overwritten at each reading, so the picture kept is the last instant that RAN.
    await captureStill(harness, "award");
    assertGreaterThanOrEqual(
      changedCells(posed, shown, CHANGE, awayFromKill).length,
      MIN_AWARD + floor,
      `${(at / ticksFor(1)).toFixed(2)}s after the crossing kill: how many cells of the field, clear of where the kill happened, the build drew differently from the same field with the score and the ships already posed forward — against a floor of ${MIN_AWARD} plus the ${floor} that field moved on its own over the same span (specs/scoring.md)`,
    );
  }
});
