// Wick — clock/live-world: a world that VISIBLY runs when a tick runs, shared
// by the three checks that a screen ticks nothing. CASE-PROVIDED.
//
// A check that a screen ticks nothing has to hold a world that would change if
// it did. An empty world with every switch off holds still on `playing` as
// well as under an overlay, so it decides nothing; this one carries something
// for every phase of `specs/world.md`'s tick to move, and every driver switch
// on, so a build whose overlay, pause, or end screen keeps ticking is caught by
// whichever phase it left running:
//
//   - a moth 300 units out, which phase 4 walks toward the lamplighter at
//     `100 × TICK_DT` a tick while `enemyMotion` is on, with a contact cooldown
//     of 0.4 s, which phase 7 counts down on every tick whatever the switches;
//   - an Ember bolt flying +y at 100 units/s, which phase 6 integrates while
//     `effectMotion` is on and whose `ttl` counts down on every tick;
//   - an Oil Splash puddle, whose `ttl` counts down and which pulses every
//     `OIL_PULSE`;
//   - Ember held with 0.7 s on its cooldown timer, which phase 5 counts down
//     while `weaponFire` is on;
//   - `spawnTimer` posed to 0.9 s, which phase 10 counts down while `spawning`
//     is on;
//   - a gem and a bread far outside every pickup radius, so they sit rather
//     than being collected, and so a tick that ran would still have them to
//     move only if something else went wrong.
//
// Nothing here overlaps anything, nothing is due within the ticks the checks
// run, and the level is `ISOLATE_LEVEL`, so the opening tick of an overlay and
// the ending tick of a run leave a run in progress rather than a second event
// on top of the one under test.

import {
  holdWeapon,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  setSwitches,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** Where the moth stands: outside contact, inside `DESPAWN_DISTANCE`. */
export const LIVE_MOTH_X = 300;

/** The moth's posed contact cooldown, in seconds: counting, and not due soon. */
export const LIVE_CONTACT_COOLDOWN = 0.4;

/** The bolt's start and velocity: off to the left, flying down, hitting nothing. */
export const LIVE_BOLT_X = -200;
export const LIVE_BOLT_VY = 100;

/** The puddle's center: below the lamplighter, clear of the moth. */
export const LIVE_PUDDLE_Y = 300;

/** Ember's posed cooldown, in seconds: counting, and not due within a second. */
export const LIVE_WEAPON_COOLDOWN = 0.7;

/** The director's posed timer, in seconds: counting, and not due within a second. */
export const LIVE_SPAWN_TIMER = 0.9;

/** The gem and the bread, far outside every pickup radius. */
export const LIVE_GEM_X = 400;
export const LIVE_BREAD_Y = -400;

/**
 * Pose the live world into an ISOLATED run (call {@link isolate} first) and
 * turn every driver switch on. Read on return: the world as posed, before any
 * tick has run.
 */
export function poseLiveWorld(h: Harness): WickSnapshot {
  const moth = placeEnemy(h, "moth", LIVE_MOTH_X, 0);
  h.debug.setEnemyContactCooldown(moth, LIVE_CONTACT_COOLDOWN);
  placeProjectile(h, "ember", LIVE_BOLT_X, 0, 0, LIVE_BOLT_VY, 0);
  placePuddle(h, "oil-splash", 0, LIVE_PUDDLE_Y);
  placeGem(h, "small", LIVE_GEM_X, 0);
  placePickup(h, "bread", 0, LIVE_BREAD_Y);
  const slot = holdWeapon(h, "ember", 1);
  h.debug.setWeaponCooldown(slot, LIVE_WEAPON_COOLDOWN);
  h.debug.setSpawnTimer(LIVE_SPAWN_TIMER);
  setSwitches(h, true);
  return h.snapshot();
}
