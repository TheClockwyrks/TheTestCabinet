// hurt — the night every point in this directory reads the hurt flash on, the
// hit that arms it, and the frame a drawn reading is taken from.
//
// THE TIMER THESE POINTS ARE ABOUT. `specs/world.md` ("Contact damage"): "The
// lamplighter carries `hurtFlash`, a timer that counts down with the contact
// cooldowns in phase 7 and is set to `HURT_FLASH` on every tick on which a
// contact hit lands, whatever the number of hits that tick. It is `0` on the
// idle run and on a fresh run, and a contact hit is the only thing that sets
// it". Every figure below is `HURT_FLASH` (`0.3`) or the count-down rule of
// "Timers": "On every tick a timer counts down by `TICK_DT` and is held at `0`
// ... a timer set to `s` seconds is due `round(s x TICK_HZ)` ticks after the
// tick it was set on".
//
// THE NIGHT. `isolate` from the harness opens a fresh run, empties the world of
// every enemy, projectile, zone, gem, and pickup, drops the Taper a run starts
// with, and holds all nine driver switches; `enemyContact` alone is turned back
// on, because a contact hit is the one thing these points are about. With
// `enemyMotion` held, an enemy is tested at exactly the point it was posed, and
// with no passive held `armor` is `0` and `recovery` is `BASE_RECOVERY` (`0`),
// so nothing but the hit moves `hp`.
//
// THE HIT. A rat posed {@link RAT_OFFSET} units from the lamplighter's center.
// `specs/enemies.md` gives the rat radius `12` and damage `8`, `specs/world.md`
// gives the lamplighter `PLAYER_RADIUS` (`12`), and the two circles overlap when
// the distance between their centers "is less than the enemy's radius plus
// `PLAYER_RADIUS`", so 20 overlaps 24 by four. An enemy "spawns ... with `age`
// `0`, `contactCooldown` `0`" (specs/enemies.md), and a timer at `0` "stays due
// on every tick until it is set again", so the rat hits on the first tick it
// stands there.
//
// THE COUNT-DOWN ON ITS OWN. `specs/world.md` runs the count-down in phase 7
// unconditionally — "Every live enemy's `contactCooldown` and the lamplighter's
// `hurtFlash` count down, and, while `enemyContact` is on, an overlapping enemy
// whose cooldown is due hits" — so a point about the timer running out takes the
// rat away after the arming tick and leaves `enemyContact` on. That is what
// makes "with no further hit landing" true by construction rather than by
// leaning on `CONTACT_COOLDOWN`, and it is also the state a build that gated the
// count-down behind the switch would fail on.

import { assertEqual, assertLessThan } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  isolate,
  placeEnemyNear,
  type EnemyView,
  type Harness,
  type PixelRect,
  type WickSnapshot,
} from "../harness";

/**
 * How far from the lamplighter's center the rat that lands the hit is posed:
 * `20`, inside the rat's radius `12` plus `PLAYER_RADIUS` (`12`).
 */
export const RAT_OFFSET = 20;

/**
 * How far from the lamplighter's center a rat that must NOT hit is posed: far
 * outside the `24` its radius and `PLAYER_RADIUS` add to, and with `enemyMotion`
 * held it never closes.
 */
export const AWAY_OFFSET = 200;

/** The enemy every point here is hit by. */
export const HITTER = "rat" as const;

/** The seconds left of the flash a snapshot reports. */
export function flashOf(snapshot: WickSnapshot): number {
  return snapshot.run.hurtFlash;
}

/** Open the isolated night every point here reads the flash on. */
export async function poseNight(h: Harness): Promise<WickSnapshot> {
  const posed = await isolate(h, { on: ["enemyContact"] });
  assertEqual(
    posed.screen,
    "playing",
    "the screen an isolated night stands on",
  );
  return posed;
}

/** A hit landed on the lamplighter, and the night on either side of it. */
export interface Arming {
  /** What the night held on the tick before the hit. */
  before: WickSnapshot;
  /** The rat posed overlapping the lamplighter. */
  rat: EnemyView;
  /** What the tick the hit landed on left. */
  armed: WickSnapshot;
}

/**
 * Pose a rat overlapping the lamplighter and run the one tick on which it hits.
 *
 * The hit is read back rather than assumed: `hp` falling is what says a contact
 * hit landed at all, and a night in which none did would leave every point here
 * reading a timer that was never asked to arm.
 */
export async function armFlash(h: Harness): Promise<Arming> {
  const before = await h.snapshot();
  const rat = await placeEnemyNear(h, HITTER, RAT_OFFSET, 0);
  const armed = await h.step(1);
  assertLessThan(
    armed.run.player.hp,
    before.run.player.hp,
    "the lamplighter's health after the tick a rat overlapped it",
  );
  return { before, rat, armed };
}

/**
 * Arm the flash and put the night back exactly as it stood before the hit: the
 * rat gone and the health it took restored.
 *
 * What that leaves is the pair the specification talks about — one night and one
 * timer between the two readings — for a point about the flash running down on
 * its own, and for the point that compares two frames "drawn on the same state".
 */
export async function armAlone(h: Harness): Promise<Arming> {
  const arming = await armFlash(h);
  await h.debug.removeEnemy(arming.rat.id);
  await h.debug.setHp(arming.before.run.player.hp);
  return arming;
}

/**
 * Drive everything {@link armAlone} drives with the rat posed out of reach, so
 * the night is parted by one tick and the same debug calls and no hit lands.
 *
 * What that leaves is the pair a drawn reading measures its own floor from: two
 * frames of one night parted by exactly what the arming parts its pair by, with
 * `hurtFlash` `0` on both. The health is read back rather than assumed, so a
 * night in which a hit landed anyway fails here rather than folding the hit into
 * the floor.
 */
export async function missAlone(h: Harness): Promise<WickSnapshot> {
  const before = await h.snapshot();
  const rat = await placeEnemyNear(h, HITTER, AWAY_OFFSET, 0);
  const missed = await h.step(1);
  assertEqual(
    missed.run.player.hp,
    before.run.player.hp,
    "the lamplighter's health after the tick a rat stood out of reach",
  );
  await h.debug.removeEnemy(rat.id);
  await h.debug.setHp(before.run.player.hp);
  return missed;
}

/* -------------------------------------------------------------------------- */
/* The frame a drawn reading is taken from                                    */
/* -------------------------------------------------------------------------- */
//
// The point that reads pixels compares two frames drawn by the same build a pose
// apart, so anything that changed between them is what the pose changed — and
// the run clock is the exception, since it changes on every tick on its own. So
// each frame is drawn at the same posed tick: `specs/instrumentation.md` has
// `setTick` change "nothing else", and `specs/world.md` has phase 1 of a tick
// raise `tick` before the phases that follow it read the new value, so a clock
// posed one short of {@link HURT_TICK} and stepped once draws {@link HURT_TICK}.

/**
 * The tick every frame here is drawn at: `2.5` seconds into the night, which
 * the HUD clock shows as `0:02` and no rounding sits on the edge of.
 */
export const HURT_TICK = 150;

/** Draw one frame at {@link HURT_TICK}, whatever was posed before it. */
export async function drawFrame(h: Harness): Promise<WickSnapshot> {
  await h.debug.setTick(HURT_TICK - 1);
  return h.step(1);
}

/** The whole stage as the last frame left it. */
export function stageFrame(h: Harness): Promise<PixelRect> {
  return h.pixelRect(0, 0, STAGE_W, STAGE_H);
}
