// clock/stage — the live night the freeze checks and the division check pose.
//
// A check that the clock holds still, or that a span of game time reaches the
// same state however it is divided, decides nothing over an empty night: a world
// with nothing in motion looks frozen whether or not the build ticked it. So the
// checks in this directory that read "nothing moved" or "the same state" pose
// one night with something of every kind that a tick would change, and the
// faculties that would change them turned on, so that a tick the build ran by
// mistake shows in the snapshot.
//
// WHAT MOVES, AND UNDER WHICH RULE. A moth walking in from the right
// (specs/enemies.md, "Chase": one step of `speed × TICK_DT` toward the
// lamplighter every tick `enemyMotion` is on), with its contact cooldown posed
// mid-count (specs/world.md, "Contact damage": "The cooldown counts down on
// every tick the enemy is alive, in or out of contact"). An Ember bolt in
// flight (specs/weapons.md, "Projectiles and pierce": its position advances by
// its velocity times `TICK_DT` every tick `effectMotion` is on, and its `ttl`
// counts down every tick). A puddle whose `ttl` counts (specs/world.md, "One
// tick", phase 6). A gem already attracted (specs/world.md, "Attraction and
// flight": "An attracted gem moves toward the lamplighter's center each tick by
// `GEM_SPEED × TICK_DT`"). And Taper held with its cooldown timer mid-count
// (specs/weapons.md, "Cooldown timers": "The timers count ... on the ticks the
// `weaponFire` switch ... is on"), set long enough that it fires on no tick a
// check here runs, so the timer counts and nothing new is created.
//
// WHAT STAYS OFF. `enemyContact`, so the moth's arrival lands no hit on a
// check that is not about hits; `spawning`, `events`, and `despawning`, so
// nothing arrives or leaves that the check did not pose, unless a check asks
// for them through `on`. Every figure below is the harness's own choice of a
// scene, not a specification value; the specification values the scene reads
// are imported from `../constants`.

import type { SwitchName } from "../constants";
import {
  isolate,
  holdWeapon,
  placeEnemy,
  placeGem,
  placeProjectile,
  placePuddle,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The faculties a live night runs under: motion for everything, and the timers. */
export const LIVE_FACULTIES: readonly SwitchName[] = [
  "enemyMotion",
  "effectMotion",
  "weaponFire",
];

/** The moth's spawn point: 300 units right of the lamplighter, walking in. */
export const MOTH_X = 300;
export const MOTH_Y = 0;

/** The moth's contact cooldown, posed mid-count so a tick would lower it. */
const MOTH_CONTACT_COOLDOWN = 0.4;

/** The bolt: left and below the lamplighter, flying straight up. */
export const BOLT_X = -100;
export const BOLT_Y = 100;
export const BOLT_VX = 0;
export const BOLT_VY = -200;
const BOLT_PIERCE = 0;

/** The puddle, off to the upper right where nothing touches it. */
const PUDDLE_X = 150;
const PUDDLE_Y = -150;

/** The gem, already attracted, a hundred units out on its way in. */
const GEM_X = 100;
const GEM_Y = 0;

/**
 * Taper's timer, posed mid-count: longer than any span a check here runs, so
 * the timer counts on every tick and Taper fires on none of them.
 */
const TAPER_TIMER = 1.0;

/** What {@link poseLiveNight} arranges. */
export interface LiveNightOptions {
  /** The faculties to run under. Defaults to {@link LIVE_FACULTIES}. */
  on?: readonly SwitchName[];
}

/**
 * Pose one night with something of every kind in motion, over an isolated run,
 * and read the state it stands in before anything ticks.
 *
 * Everything here is a pose, so nothing has moved when this returns: the moth
 * is at its spawn point, the bolt where it was placed, the gem a hundred units
 * out, and the run at tick `0`. The first tick a check runs is the first tick
 * anything moves.
 */
export async function poseLiveNight(
  h: Harness,
  options: LiveNightOptions = {},
): Promise<WickSnapshot> {
  await isolate(h, { on: options.on ?? LIVE_FACULTIES });
  const slot = await holdWeapon(h, "taper");
  await h.debug.setWeaponCooldown(slot, TAPER_TIMER);
  const moth = await placeEnemy(h, "moth", MOTH_X, MOTH_Y);
  await h.debug.setEnemyContactCooldown(moth.id, MOTH_CONTACT_COOLDOWN);
  await placeProjectile(
    h,
    "ember",
    BOLT_X,
    BOLT_Y,
    BOLT_VX,
    BOLT_VY,
    BOLT_PIERCE,
  );
  await placePuddle(h, "oil-splash", PUDDLE_X, PUDDLE_Y);
  const gem = await placeGem(h, "small", GEM_X, GEM_Y);
  await h.debug.setGemAttracted(gem.id, true);
  return h.snapshot();
}
