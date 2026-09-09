// instrumentation/saucer-gun-gate — `setSaucerGun(false)` really does shut the
// saucer's firing: four fire intervals pass and it has put nothing on the
// enemy-bullet roster. With its gun running, the same four intervals produce
// several rounds.
//
// WHAT THE FACULTY COVERS. `specs/instrumentation.md` scopes it to "the saucer's
// firing alone: the aimed shot it takes every `SAUCER_FIRE_INTERVAL`. Off, it fires
// nothing; it still steers and still travels." So what is counted is the roster it
// adds to, and nothing else about the craft is read.
//
// FOUR INTERVALS, BECAUSE ONE PROVES NOTHING. `specs/saucer.md` puts a shot every
// `SAUCER_FIRE_INTERVAL` (1.6 seconds), so a scenario shorter than one would pass a
// build with no gate at all. Six and a half seconds gives a build that ignores the
// gate four separate opportunities, and stays well inside the `SAUCER_LIFETIME`
// (12 seconds) after which the craft leaves on its own.
//
// THE SAUCER IS HELD STILL AND ITS MIND IS SHUT, so the only faculty running on
// either leg is the one under test: nothing it decides and nothing it travels can
// move the reading, and the ship it aims at is where `startPlaying` left it.
//
// AND THE OPEN LEG COUNTS ARRIVALS RATHER THAN THE ROSTER. `specs/saucer.md` gives
// a saucer bullet `SAUCER_BULLET_LIFE` (1.4 seconds), which is shorter than the gap
// between two shots — so a roster read at the end of the scenario holds at most one
// bullet however many were fired. What is counted is every DISTINCT id that
// appeared, sampled often enough that no bullet can live and die between two looks.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, assertTrue } from "../assert";
import { SAUCER_FIRE_INTERVAL } from "../constants";
import {
  captureStill,
  clearSaucer,
  createHarness,
  poseSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the saucer is held: near the top of the field, well clear of the star. */
const PLACE = { x: 300, y: 130 } as const;

/** How many fire intervals each leg runs for. */
const INTERVALS = 4;

/** The ticks each leg runs for. */
const SPAN_TICKS = ticksFor(INTERVALS * SAUCER_FIRE_INTERVAL);

/**
 * How often the enemy-bullet roster is looked at, in ticks.
 *
 * Half a second, which is less than a third of the `SAUCER_BULLET_LIFE`
 * (1.4 seconds) `specs/saucer.md` gives a round — so no round can be fired and
 * expire between two looks, and a count of distinct ids is a count of shots taken.
 */
const POLL = ticksFor(0.5);

/**
 * The fewest distinct rounds the open leg must produce.
 *
 * Three of the four the four intervals allow. `specs/saucer.md` fixes the interval
 * but not the phase within it, so a build whose first shot lands just past the end
 * of the span takes three inside it; demanding four would be demanding a phase the
 * specification never fixed.
 */
const LEAST_SHOTS = 3;

let h: Harness;

/** Every distinct saucer-bullet id that appears over `ticks` of game time. */
async function roundsOver(ticks: number): Promise<Set<number>> {
  const seen = new Set<number>();
  for (let run = 0; run < ticks; run += POLL) {
    await h.advance(Math.min(POLL, ticks - run));
    for (const bullet of (await h.snapshot()).enemyBullets) seen.add(bullet.id);
  }
  return seen;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires nothing while the gun is shut", async () => {
  await startPlaying(h);
  await poseSaucer(h, PLACE.x, PLACE.y, {
    mind: false,
    gun: false,
    travel: false,
  });

  const fired = await roundsOver(SPAN_TICKS);
  await captureStill(h, "silent");

  assertTrue(
    fired.size === 0,
    `no saucer bullet over ${INTERVALS} fire intervals with setSaucerGun(false); ` +
      `${fired.size} appeared`,
  );
  assertLength(
    (await h.snapshot()).enemyBullets,
    0,
    "the enemy-bullet roster at the end of the span",
  );
});

it("fires several rounds once the gun is running", async () => {
  await startPlaying(h);
  await clearSaucer(h);
  await poseSaucer(h, PLACE.x, PLACE.y, {
    mind: false,
    gun: true,
    travel: false,
  });

  const fired = await roundsOver(SPAN_TICKS);
  assertGreaterThanOrEqual(
    fired.size,
    LEAST_SHOTS,
    `the rounds fired over ${INTERVALS} fire intervals with setSaucerGun(true)`,
  );
});
