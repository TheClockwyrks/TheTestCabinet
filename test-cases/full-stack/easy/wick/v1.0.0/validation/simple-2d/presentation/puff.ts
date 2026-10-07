// presentation — the one death the two puff points are about.
//
// Both points need the same thing: a moth that dies on a known tick, at a known
// world position, in a world holding nothing else that draws. The kill comes
// from the game's own systems rather than from a pose, as the authoring rule
// requires: a Pin dart is posed on top of the moth and the next tick resolves
// the hit, which is 6 damage against a moth's 5 health (specs/weapons.md, Pin;
// specs/enemies.md, the roster).

import { assertEqual, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE, PIN_LEVELS } from "../constants";
import {
  isolate,
  spawnEnemyAt,
  spawnProjectileAt,
  type Harness,
  type Point,
  type WickSnapshot,
} from "../harness";

/**
 * Where the moth stands: far enough from the lamplighter that the gem it drops
 * is outside PICKUP_RADIUS (48) and so is never attracted or collected, and
 * well inside the view.
 */
export const DIES_AT: Point = { x: 300, y: -80 };

/**
 * Pose the isolated night, kill one moth with a Pin dart, and hand back the
 * snapshot of the tick it died on.
 *
 * Every driver switch stays off: `effectMotion` off holds the dart where it was
 * posed and leaves the hits to resolve, which is what specs/instrumentation.md
 * states of the switch, and `enemyMotion` off holds the moth on the point the
 * puff is then read against.
 */
export async function killOneMoth(h: Harness): Promise<WickSnapshot> {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the death happens on");
  const mothId = spawnEnemyAt(h, "moth", DIES_AT.x, DIES_AT.y);
  const placed = h.snapshot().run.enemies.find((enemy) => enemy.id === mothId);
  assertWithin(
    placed?.hp ?? 0,
    ENEMIES.moth.hp,
    FIGURE_TOLERANCE,
    "the moth's health at the start of the night",
  );
  assertEqual(
    PIN_LEVELS[0].damage >= ENEMIES.moth.hp,
    true,
    "a Pin dart's damage against a moth's health",
  );
  spawnProjectileAt(h, "pin", DIES_AT.x, DIES_AT.y, 0, 0, 0);

  const died = await h.tick(1);
  assertEqual(died.run.kills, 1, "the kills the dart's tick counted");
  assertEqual(
    died.run.enemies.length,
    0,
    "the enemies left alive after the dart's tick",
  );
  return died;
}
