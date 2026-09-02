// waves/the-saucer-hunts-during-the-banner — a saucer up when the last rock dies
// goes on hunting through the banner.
//
// `specs/progression.md`, The banner: "The banner is a breather rather than a
// pause. Only the rocks are held back: the ship keeps flying under the player's
// control, timers keep running, and a saucer already on the field keeps travelling,
// keeps firing, and can still be shot down."
//
// THE OTHER HALF OF THE BREATHER. `the-ship-flies-during-the-banner` grades what
// the player keeps; this grades what the field keeps. A build that stops the world
// for the banner hands the player a second and a half in which the saucer stands
// still with its gun silent — which reads as a small thing and is the difference
// between a breather and a pause.
//
// THE SAUCER IS ALREADY ON THE FIELD WHEN THE WAVE TURNS OVER, which is the
// scenario the specification describes. It is brought on, given eight tenths of a
// second of ordinary crossing, and only then is the last rock shot down — so the
// banner opens over a saucer mid-visit rather than one that arrived with it.
//
// TRAVEL IS READ AS THE BUILD AGAINST ITSELF. What the saucer's speed IS belongs to
// `specs/saucer.md` and the `saucer` group; what this item decides is that the
// banner makes no difference to it. So the ground it covers per tick over the
// banner is compared with the ground it covered per tick over the eight tenths of a
// second before the banner, from the same faculties and the same velocity. A build
// that travels identically either way passes whatever its cruise speed is; a build
// that freezes reads zero against a number that is not zero. Nothing about the
// specification's own figure for `SAUCER_SPEED` enters the comparison, so nothing
// about it can decide the item.
//
// ITS MIND IS OFF, ITS GUN AND ITS TRAVEL ARE ON. `specs/instrumentation.md` gates
// the three separately, and this item exercises two of them: with the weave rerolls
// shut off the saucer holds one velocity for the whole scenario, so the two
// per-tick readings are comparable at all, and its steering cannot wander the
// reading. The lane is three hundred and thirty units below the star's row, where
// `specs/saucer.md`'s core-avoidance — which is part of the mind — would have
// nothing to do even if it were running.
//
// FIRING IS READ AS A NEW SHOT, not as a rate. `specs/saucer.md` puts
// `SAUCER_FIRE_INTERVAL` (`1.6` seconds) between shots, which is longer than the
// banner, so a cadence cannot be read across one and this item does not try:
// `saucer/fires-on-a-cadence` decides that. What is read here is that a saucer
// under a banner puts a bullet on the field that was not there when the banner went
// up, identified by an id — `specs/instrumentation.md` gives every saucer bullet
// one that is distinct among live entities — so a bullet that was already in flight
// cannot be counted as a shot the banner allowed.
//
// AND THE EIGHT TENTHS OF A SECOND IS WHAT PUTS THE SHOT INSIDE THE BANNER.
// `addSaucer` starts the fire clock at a full `SAUCER_FIRE_INTERVAL`, so a shot
// falls due `1.6` seconds into the visit; the banner opens at about `0.9` seconds
// and closes at about `2.4`, which leaves seven tenths of a second of margin on
// each side. A build that instead takes its first shot the moment the saucer
// arrives fires its second at the same `1.6` seconds and lands inside the same
// window, so neither reading of the clock decides the item.
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note at
// the top of `scenario.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { SAUCER_FIRE_INTERVAL, WAVE_BANNER_TIME } from "../constants";
import { wrappedDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";
import { LAST_ROCK, bannerUp, shootTheFieldClear } from "./scenario";

/** The lane the saucer crosses, and where it enters it. */
const SAUCER_AT = { x: 100, y: 690 };

/** The wave the run is posed at. Nothing here reads the number; it only needs one. */
const POSED_WAVE = 3;

/**
 * How long the saucer crosses before the wave is cleared: eight tenths of a second.
 *
 * A baseline long enough to read a travel rate off — ninety-six ticks — and short
 * enough that the shot falling due at `SAUCER_FIRE_INTERVAL` lands well inside the
 * banner rather than beside either of its edges.
 */
const PRERUN_SECONDS = 0.8;
const PRERUN_TICKS = ticksFor(PRERUN_SECONDS);

/** How long the banner is followed for before the sweep gives up on it. */
const BANNER_TICKS = ticksFor(WAVE_BANNER_TIME + 0.2);

/**
 * How far the two travel rates may differ: five percent, and a hundredth of a unit
 * either way.
 *
 * The saucer holds one velocity across both spans — `specs/gravity.md` leaves it
 * unpulled and its weave is shut off — so a conformant build produces the same
 * number twice and this is insurance against a float rather than a real allowance.
 * A build that holds the saucer still under the banner misses by a hundred percent.
 */
const RATE_TOLERANCE = 0.05;
const RATE_FLOOR = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/** How far the saucer moved between two snapshots, per tick of the span. */
function travelRate(
  from: ShatterSnapshot,
  to: ShatterSnapshot,
  ticks: number,
  what: string,
): number {
  const before = requireSaucer(from, what);
  const after = requireSaucer(to, what);
  return wrappedDistance(before, after) / ticks;
}

it("keeps the saucer travelling and firing while the banner shows", async () => {
  await startPlaying(h, { wave: POSED_WAVE });
  await poseSaucer(h, SAUCER_AT.x, SAUCER_AT.y, { mind: false });

  const entered = await h.snapshot();
  await h.skip(PRERUN_TICKS);
  const crossing = await h.snapshot();
  const beforeRate = travelRate(
    entered,
    crossing,
    PRERUN_TICKS,
    "a saucer crossing the field before the wave was cleared",
  );

  // The last rock, and the loop that notices it. Both go on in the same turn, so
  // the field never spends a tick empty with the wave loop open.
  await poseRock(h, "small", LAST_ROCK.x, LAST_ROCK.y);
  await h.debug.setWaveSpawning(true);
  const cleared = await shootTheFieldClear(h);
  await bannerUp(h, cleared);
  // The banner the clear EARNED is what `bannerUp` above insisted on; how long it
  // runs for is `banner-runs-for-1p5s`'s point, not this one, so the window is
  // levelled to WAVE_BANNER_TIME before it is watched. Without this a build whose
  // banner is half the stated length would fail here too — its banner would be
  // over before the shot falling due at SAUCER_FIRE_INTERVAL landed — and one
  // defect would cost two points.
  await h.debug.setWaveBanner(WAVE_BANNER_TIME);
  const raised = await h.snapshot();

  const visit = requireSaucer(raised, "a saucer up when the last rock died");
  const knownShots = new Set(raised.enemyBullets.map((bullet) => bullet.id));
  let fired = 0;
  let ticks = 0;
  let last = raised;
  let pictured = false;

  while (ticks < BANNER_TICKS) {
    const now = await h.advance(1);
    if (now.waveBanner <= 0) break;
    ticks += 1;
    last = now;
    for (const bullet of now.enemyBullets) {
      if (!knownShots.has(bullet.id)) {
        knownShots.add(bullet.id);
        fired += 1;
      }
    }
    if (!pictured && now.waveBanner <= WAVE_BANNER_TIME / 2) {
      // The saucer still hunting under a banner half run down.
      await captureStill(h, "banner");
      pictured = true;
    }
  }

  // A build whose banner outruns the span swept above never reaches the moment
  // the picture is meant to be taken at, and the item still owes a reviewer its
  // evidence — so the last tick swept stands in for it. A capture point, not a
  // threshold: nothing here can change the verdict below.
  if (!pictured) await captureStill(h, "banner");

  assertGreaterThan(
    ticks,
    0,
    "ticks the banner was still showing for after it went up, which is the span " +
      "this item reads",
  );

  const stillUp = requireSaucer(
    last,
    `a saucer still on the field after ${ticks} ticks of banner, which ` +
      `specs/saucer.md keeps for SAUCER_LIFETIME seconds from its arrival`,
  );
  assertEqual(
    stillUp.id,
    visit.id,
    "the id of the saucer on the field at the end of the banner, against the " +
      "one that was up when the wave cleared: specs/instrumentation.md makes it " +
      "fresh on every arrival, so a changed id is a different visit",
  );

  const underRate = travelRate(
    raised,
    last,
    ticks,
    "a saucer travelling under the banner",
  );
  const allowed = Math.max(beforeRate * RATE_TOLERANCE, RATE_FLOOR);
  assertBetween(
    underRate,
    beforeRate - allowed,
    beforeRate + allowed,
    `the units the saucer covered per tick over ${ticks} ticks of banner, ` +
      `against the ${beforeRate} per tick it covered over the ` +
      `${PRERUN_TICKS} ticks before the wave cleared: specs/progression.md has ` +
      `a saucer already on the field keep travelling while the banner shows`,
  );

  assertGreaterThan(
    fired,
    0,
    `saucer bullets that appeared on the field over ${ticks} ticks of banner ` +
      `and were not in flight when it went up: specs/progression.md has a ` +
      `saucer already on the field keep firing while the banner shows, and ` +
      `specs/saucer.md puts a shot every SAUCER_FIRE_INTERVAL ` +
      `(${SAUCER_FIRE_INTERVAL}) seconds on the field`,
  );
});
