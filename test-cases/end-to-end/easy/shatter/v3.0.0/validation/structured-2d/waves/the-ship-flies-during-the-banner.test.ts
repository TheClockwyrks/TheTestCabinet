// waves/the-ship-flies-during-the-banner — the banner is a breather, not a pause:
// the ship keeps flying under it.
//
// THE RULE. `specs/progression.md`, "The banner": "The banner is a breather rather
// than a pause. Only the rocks are held back: the ship keeps flying under the
// player's control, timers keep running, and a saucer already on the field keeps
// travelling, keeps firing, and can still be shot down."
//
// WHAT IS MEASURED. The speed a second of held thrust from rest builds UNDER A
// RUNNING BANNER, against the speed the same second of held thrust builds in
// ordinary play, in the same harness, from the same pose, with the same key. The
// ship alone; the saucer's half of the same rule is
// `the-saucer-hunts-during-the-banner`'s item, so a build that freezes one and not
// the other loses one point.
//
// AND WHY THE CONTROL IS THE SAME BUILD RATHER THAN THE SPECIFIED FIGURE. What
// this item decides is whether the banner CHANGES anything, not what a second of
// thrust comes to — that is `flight/thrust-accelerates`'s point, and it is
// measured there against `specs/ship.md`'s own two rows. Read against the
// specified figure, this check would fail every build whose thrust is wrong for
// reasons that have nothing to do with the banner, and would take a point the
// build has already lost once. Read against the build's own play burn, it fails
// exactly the build that treats the banner as a pause.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that freezes the
// whole simulation under the banner reads `0` against the play burn's `428`, a
// hundred percent out. A build that keeps the physics running but stops reading
// the keyboard reads `0` too — the ship starts at rest — and both fail. A build
// that runs the banner at half speed reads about half. A build that holds the ship
// still but lets its timers run reads `0`. The bound is two percent.
//
// THE BANNER RUN COMES FIRST AND THE CONTROL SECOND, so the control cannot be the
// thing that armed the banner. `startPlaying` puts the banner back to `0`
// (`specs/instrumentation.md`: `setWaveBanner`) and re-poses the world, so the two
// burns differ in exactly one thing: whether a banner is running.
//
// THE BURN IS ONE SECOND OR THE BANNER, WHICHEVER IS SHORTER, and the control burn
// is then run for EXACTLY THE SAME NUMBER OF TICKS. A second fits inside
// `WAVE_BANNER_TIME` (`1.5` s) with room at each end, so on a conformant build the
// two burns are both a full second. On a build whose banner is too SHORT the
// banner burn stops with the banner and the control matches it, so the comparison
// stays exact and the item still decides what it is for — a banner of the wrong
// LENGTH is `banner-runs-for-1p5s`'s defect, and reading a fixed second here would
// charge that build twice. What the check does still require is that the banner
// lasted long enough for a burn to mean anything, which is the quarter second
// below.
//
// THE POSE IS AT REST, OFF EVERY AXIS AND FAR FROM THE CORE, exactly as
// `flight/thrust-accelerates` poses it: at rest so the whole of each reading is
// what its own burn built; off both axes so no accidental alignment flatters a
// build; and far enough out that `specs/collision.md`'s slide along the core —
// which runs whether the ship's lethal contact gate is on or off — never comes
// into either burn. Over the second the ship covers about `196` units from
// `(200, 200)` along `-35` degrees, which never brings it within `380` of the
// star's centre, against the `44` at which the slide begins.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, WAVE_BANNER_TIME } from "../../src/constants";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdActionFor,
  keysFor,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { clearTheWave, openWaveAt } from "./scene";

/** The wave the field is posed at. Any wave raises the same banner. */
const WAVE = 3;

/** Where the ship burns, and which way it faces: off both axes, clear of the core. */
const SHIP_X = 200;
const SHIP_Y = 200;
const FACING = -35 * DEG;

/**
 * The burn: one second of game time with the thrust key held.
 *
 * Two thirds of `WAVE_BANNER_TIME` (`1.5` s), so the whole of it is under the
 * banner even after the couple of ticks the clear itself spends.
 */
const BURN_TICKS = ticksFor(1);

/**
 * The least of that burn the banner has to cover for the reading to mean
 * anything: a quarter of a second, which is thirty ticks of a `480` units per
 * second squared thrust — over a hundred units per second of speed, against the
 * two percent the two burns are then compared within. A banner shorter than that
 * is `banner-runs-for-1p5s`'s defect, and this check says so rather than reading
 * a burn too short to separate a flying ship from a frozen one.
 */
const MIN_BURN_TICKS = ticksFor(0.25);

/**
 * How far the burn under the banner may fall from the burn in play, as a fraction
 * of the play burn.
 *
 * 2 percent. The two burns are the same code over the same second, so the only
 * legitimate difference between them is where the tick boundaries fall relative to
 * the key's edge: one tick of a `480` units-per-second-squared thrust is `4` units
 * per second, and two percent of a `428` unit-per-second burn is `8.6` — room for
 * a couple of ticks of offset and nothing else. A build that pauses the ship under
 * the banner is a hundred percent out.
 */
const MATCH_TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds the same speed under the banner as it does in play", async () => {
  // The banner burn.
  openWaveAt(h, WAVE);
  await clearTheWave(h);

  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACING);

  const raised = h.snapshot();
  assertGreaterThan(
    raised.waveBanner,
    0,
    "a banner running when the burn under it begins, since this item is about " +
      "what the ship does while one shows (specs/progression.md); a build that " +
      "raises no banner is decided by waves/clears-on-last-rock",
  );

  // Burn for a second, or for as long as the banner lasts — whichever ends
  // first — so the whole of the burn is flown under the banner whatever length
  // the build runs it for.
  let burned = 0;
  h.hold(keysFor("up")[0]);
  try {
    for (; burned < BURN_TICKS; burned += 1) {
      await h.advance(1);
      if (h.snapshot().waveBanner <= 0) break;
    }
  } finally {
    h.release(keysFor("up")[0]);
  }
  const underBanner = h.snapshot();
  // The ship flying on under the banner, its flame still lit.
  captureStill(h, "banner");

  assertGreaterThanOrEqual(
    burned,
    MIN_BURN_TICKS,
    `a banner lasting at least ${String(MIN_BURN_TICKS / ticksFor(1))} s, so ` +
      `there is a burn under it to compare against one in play — ` +
      `WAVE_BANNER_TIME is ${String(WAVE_BANNER_TIME)} s ` +
      `(specs/progression.md); a banner of the wrong length is decided by ` +
      `waves/banner-runs-for-1p5s`,
  );

  // The control: the same burn, from the same pose, with no banner running.
  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACING);

  // EXACTLY the ticks the banner burn ran for, so the two are the same burn.
  await holdActionFor(h, "up", burned);
  const inPlay = h.snapshot();

  // Without a burn to compare against there is nothing to read. That a second of
  // thrust reaches the speed `specs/ship.md` fixes is `flight/thrust-accelerates`.
  assertGreaterThan(
    inPlay.ship.speed,
    0,
    "the ship gaining speed over a second of held thrust in ordinary play, " +
      "which is the control the banner burn is read against (specs/ship.md); a " +
      "build whose thrust does nothing at all is decided by " +
      "controls/thrust-up and flight/thrust-accelerates",
  );
  assertLessThanOrEqual(
    inPlay.waveBanner,
    0,
    "no banner running over the control burn, so the two burns differ in " +
      "exactly one thing (specs/instrumentation.md: setWaveBanner)",
  );

  assertLessThanOrEqual(
    Math.abs(underBanner.ship.speed - inPlay.ship.speed) / inPlay.ship.speed,
    MATCH_TOLERANCE,
    `${seconds(burned).toFixed(2)} s of held thrust building the same speed ` +
      `under the WAVE N banner ` +
      `as it does in play, within ${String(MATCH_TOLERANCE * 100)} percent — ` +
      `the banner is a breather rather than a pause, and only the rocks are ` +
      `held back: the ship keeps flying under the player's control ` +
      `(specs/progression.md); under the banner ` +
      `${underBanner.ship.speed.toFixed(1)}, in play ` +
      `${inPlay.ship.speed.toFixed(1)} units per second`,
  );
});
