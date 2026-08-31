// waves/the-saucer-hunts-during-the-banner — a saucer up when the last rock dies
// keeps travelling and keeps firing under the banner.
//
// THE RULE. `specs/progression.md`, "The banner": "The banner is a breather rather
// than a pause. Only the rocks are held back: the ship keeps flying under the
// player's control, timers keep running, and a saucer already on the field keeps
// travelling, keeps firing, and can still be shot down."
//
// WHAT IS MEASURED, over the banner a real clear raised:
//
//   TRAVELLING — how far the saucer's centre moved along its course, against
//     `SAUCER_SPEED` times the game time that passed;
//   FIRING — that at least one saucer bullet appeared, none having been on the
//     field when the banner went up.
//
// They are one item and one requirement — that the banner suspends nothing of the
// saucer — and both halves are read because either alone leaves the other kind of
// build passing: a build that holds the saucer still but lets it shoot passes a
// firing-only check, and a build that lets it drift but stops its gun passes a
// travel-only check. The ship's half of the same rule is
// `the-ship-flies-during-the-banner`'s item, so a build that freezes the ship and
// not the saucer loses one point.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that pauses the
// whole simulation under the banner reads `0` units of travel and `0` shots. A
// build that pauses only the enemies reads the same. A build that removes the
// saucer on a clear reads no saucer at all, which fails the reading outright. A
// build that keeps it moving but suspends its fire clock reads full travel and
// `0` shots.
//
// THE SAUCER IS POSED WITH ITS MIND OFF, and that is the isolation. The
// requirement is travel and fire; the WEAVE and the core-avoidance are the
// saucer's steering, which `saucer/weave-interval` and `saucer/avoids-the-core`
// decide. `setSaucerMind(false)` gates the steering decisions alone —
// "Off, nothing it decides changes its velocity; it still travels and still
// fires" (`specs/instrumentation.md`) — so the saucer holds the course
// `addSaucer` gave it and the travel reading is a straight line rather than a
// weave the check would have to model. Its row is far from the star's, so the
// avoidance it no longer has is never wanted.
//
// THE GUN IS SYNCHRONISED FROM THE BUILD'S OWN CADENCE, not from the specified
// one. The saucer fires every `SAUCER_FIRE_INTERVAL` (`1.6` s) on the field
// (`specs/saucer.md`), which is LONGER than `WAVE_BANNER_TIME` (`1.5` s), so a
// banner raised at an arbitrary moment need not contain a shot at all. The check
// therefore watches TWO of the saucer's shots before it clears anything: the first
// gives it the phase, the pair gives it the interval, and it then raises the
// banner half of THAT interval before the next shot is due. Nothing in the reading
// holds the build to `1.6` seconds — a build whose interval is its own still fires
// squarely inside the window, and `saucer/fire-interval` is the item that decides
// the figure itself. What the check does need is a banner long enough to hold the
// lead, and it says so rather than reporting a gun that never fired.
//
// THE WINDOW IS THE BANNER, WHATEVER LENGTH THE BUILD RUNS IT FOR: the watch stops
// when the banner does. A build whose banner is too SHORT is wrong about a rule
// `banner-runs-for-1p5s` already charges it for, and a fixed window would charge
// it again here.
//
// THE ENEMY BULLETS ARE CLEARED ON THE TICK THE BANNER GOES UP, after the clear
// rather than before it, so every bullet the reading counts was fired under the
// banner and none can be one the saucer let off in the run-up.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_W,
  SAUCER_FIRE_INTERVAL,
  SAUCER_SPEED,
  TICK_DT,
  WAVE_BANNER_TIME,
} from "../../src/constants";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { shortestDelta } from "../geometry";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  seconds,
  ticksFor,
  type Harness,
} from "../harness";
import { killTheLastRock, openWaveAt, poseLastRock } from "./scene";

/** The wave the field is posed at. Any wave raises the same banner. */
const WAVE = 3;

/**
 * Where the saucer is brought on: near the left edge, on a row `240` units above
 * the star's.
 *
 * `addSaucer` sends it right at `SAUCER_SPEED` with no vertical component
 * (`specs/instrumentation.md`), and with its mind off it holds that course, so it
 * crosses the field on this row. `240` units clear of the star's row is far
 * outside the `CORE_R + SAUCER_R` (`48`) the specification holds it to, so the
 * steering it does not have is never wanted; and over the five seconds this check
 * can spend it travels at most `700` units from here, so it neither leaves the
 * field nor wraps.
 */
const SAUCER_X = 200;
const SAUCER_Y = 120;

/**
 * How long each of the two run-up shots is waited for.
 *
 * Three firing intervals. `specs/saucer.md` has the saucer fire "every
 * `SAUCER_FIRE_INTERVAL` (`1.6` seconds) on the field", and `addSaucer` starts its
 * fire clock at a full interval — so one interval is what a build that reads that
 * clock as time-remaining takes and zero is what a build that reads it as
 * ready-to-fire takes. Three covers both with room for a build whose interval is
 * its own, and two of them together stay well inside `SAUCER_LIFETIME` (`12` s).
 */
const SHOT_WINDOW_TICKS = ticksFor(3 * SAUCER_FIRE_INTERVAL);

/**
 * The most of an interval the banner may be raised ahead of the next shot.
 *
 * Six tenths of a second. The lead is half the interval the build was MEASURED
 * firing at, capped here, so the shot lands squarely inside a banner of the
 * specified `1.5` seconds however long the build's own interval is.
 */
const MAX_LEAD_SECONDS = 0.6;

/**
 * The least banner the reading needs: the lead the shot was placed at, and a
 * seventh of a second on top for a build whose cadence wanders between two
 * consecutive shots.
 */
const LEAD_MARGIN_SECONDS = 0.15;

/**
 * The most of the banner that is ever watched.
 *
 * Three times `WAVE_BANNER_TIME` and a half second — a bound on the scenario
 * rather than a threshold, so a build whose banner is too LONG is still read here
 * and charged only by `banner-runs-for-1p5s`.
 */
const BANNER_WINDOW_TICKS = ticksFor(3 * WAVE_BANNER_TIME + 0.5);

/**
 * How far the measured travel may fall from `SAUCER_SPEED` times the elapsed time,
 * in units.
 *
 * Four ticks of cruise, `4.7` units. The saucer is a powered craft the well never
 * pulls (`specs/gravity.md`, `specs/saucer.md`) and its mind is off, so with a
 * constant velocity the only slack is which ticks fall inside the window: the
 * clear itself takes a few, and the endpoints are read a tick either side of where
 * the elapsed time is counted from. A build that holds the saucer still is the
 * whole distance out.
 */
const TRAVEL_TOLERANCE = 4 * SAUCER_SPEED * TICK_DT;

/**
 * Advance one tick at a time until a saucer bullet the roster did not already hold
 * appears, and answer how many ticks that took — `0` if none did.
 *
 * By ID rather than by count, because `specs/saucer.md` removes a bullet
 * `SAUCER_BULLET_LIFE` (`1.4` s) after it is fired and the interval is longer than
 * that: a roster that emptied and refilled would show the same length twice.
 */
async function waitForShot(h: Harness, maxTicks: number): Promise<number> {
  const seen = new Set(h.snapshot().enemyBullets.map((bullet) => bullet.id));
  for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
    await h.advance(1);
    const fresh = h
      .snapshot()
      .enemyBullets.some((bullet) => !seen.has(bullet.id));
    if (fresh) return ticks;
  }
  return 0;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the saucer travelling and firing while the banner shows", async () => {
  openWaveAt(h, WAVE);
  // The last rock goes up BEFORE the clock runs, so the field is never observed
  // empty while the gun's phase is being learned. A build that clears on an empty
  // predicate rather than on a destruction would otherwise turn its wave over
  // during the run-up and be failed here for a defect
  // `an-empty-field-does-not-clear-by-itself` is the item for.
  const lastRock = poseLastRock(h);
  poseSaucer(h, SAUCER_X, SAUCER_Y);
  // The steering alone is gated: the requirement is travel and fire, and a saucer
  // that weaves would make the travel reading a curve rather than a line.
  h.debug.setSaucerMind(false);

  // Learn the gun's PHASE and its INTERVAL from the saucer's own two first shots,
  // rather than assuming either from the specification.
  const first = await waitForShot(h, SHOT_WINDOW_TICKS);
  const second = await waitForShot(h, SHOT_WINDOW_TICKS);
  const interval = seconds(second);
  assertGreaterThan(
    interval,
    0,
    `the saucer firing twice, each within ` +
      `${String(3 * SAUCER_FIRE_INTERVAL)} s of the shot before it, so this ` +
      `check knows the phase and the length of its own firing cadence — it ` +
      `fires every SAUCER_FIRE_INTERVAL (${String(SAUCER_FIRE_INTERVAL)} s) on ` +
      `the field (specs/saucer.md); a saucer that never fires is decided by ` +
      `saucer/fire-interval, and the figure itself by the same item. First ` +
      `shot after ${String(first)} ticks`,
  );

  // Run on to a lead before the next shot is due, then raise the banner.
  const lead = Math.min(interval / 2, MAX_LEAD_SECONDS);
  await h.advance(ticksFor(interval - lead));

  const kill = await killTheLastRock(h, lastRock);
  const opened = h.snapshot();
  assertGreaterThan(
    opened.waveBanner,
    0,
    "a banner running when the window opens, since this item is about what " +
      "the saucer does while one shows (specs/progression.md); a build that " +
      "raises no banner is decided by waves/clears-on-last-rock",
  );

  // Cleared with the banner already up, so every bullet counted below was fired
  // under it.
  h.debug.clearEnemyBullets();

  const before = requireSaucer(
    opened,
    "the saucer on the field when the last rock is destroyed",
  );

  // The window is the banner: watched tick by tick until it runs out.
  let watched = 0;
  let shots = 0;
  for (; watched < BANNER_WINDOW_TICKS; watched += 1) {
    await h.advance(1);
    const at = h.snapshot();
    shots = Math.max(shots, at.enemyBullets.length);
    if (at.waveBanner <= 0) break;
  }
  const closing = h.snapshot();
  // The saucer still hunting under the banner.
  captureStill(h, "banner");

  assertGreaterThanOrEqual(
    seconds(watched),
    lead + LEAD_MARGIN_SECONDS,
    `a banner lasting at least ${(lead + LEAD_MARGIN_SECONDS).toFixed(2)} s, ` +
      `which is where the saucer's next shot was placed — WAVE_BANNER_TIME is ` +
      `${String(WAVE_BANNER_TIME)} s (specs/progression.md); a banner of the ` +
      `wrong length is decided by waves/banner-runs-for-1p5s`,
  );

  const after = requireSaucer(
    closing,
    "the saucer still on the field at the end of the banner — a saucer already " +
      "on the field keeps travelling and can still be shot down, so a clear " +
      "does not remove it (specs/progression.md)",
  );

  // TRAVELLING. The saucer's mind is off and the well never pulls it, so its
  // course is the one `addSaucer` gave it and the distance is speed times time.
  const travelled = Math.abs(shortestDelta(before.x, after.x, FIELD_W));
  const owed = SAUCER_SPEED * seconds(watched);
  assertLessThanOrEqual(
    Math.abs(travelled - owed),
    TRAVEL_TOLERANCE,
    `the saucer crossing ${owed.toFixed(1)} units over the ` +
      `${seconds(watched).toFixed(2)} s of banner, within ` +
      `${TRAVEL_TOLERANCE.toFixed(1)} — a saucer already on the field keeps ` +
      `travelling while the banner shows, at SAUCER_SPEED ` +
      `(${String(SAUCER_SPEED)}) (specs/progression.md, specs/saucer.md); a ` +
      `reading of 0 is a build that holds the field still under the banner`,
  );

  // FIRING.
  assertGreaterThanOrEqual(
    shots,
    1,
    `at least one saucer bullet fired while the banner showed, the saucer's ` +
      `bullets having been cleared on the tick the banner went up — a saucer ` +
      `already on the field keeps firing while the banner shows, every ` +
      `${interval.toFixed(2)} s, the interval it was measured firing at, and ` +
      `the banner was raised ${lead.toFixed(2)} s before its next shot was due ` +
      `(specs/progression.md, specs/saucer.md); the clear itself took ` +
      `${String(kill.ticks)} ticks`,
  );
});
