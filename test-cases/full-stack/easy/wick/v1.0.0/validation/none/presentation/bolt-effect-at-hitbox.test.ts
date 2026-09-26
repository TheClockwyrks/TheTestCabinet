// presentation/bolt-effect-at-hitbox — Ember's bolt sprite is drawn over the bolt's own circle, for the whole of its life.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live, as
// `specs/weapons.md` and `specs/evolutions.md` define that shape. Each is
// produced on the canvas its row states and scaled in code to the live shape,
// which `areaMul` and later levels grow, so the effect's drawn extent is the
// hitbox's extent on every tick it is drawn." Its own row of that table gives
// the file and the shape: "bolt | Ember |
// `assets/sprites/effects/ember.png` | one sprite | `16 x 16` | the bolt's
// circle, for its life".
// `specs/weapons.md` — "Ember" fixes the circle: "A bolt is a circle of
// `radius`, fired from the player's center at `speed` in the direction of the
// nearest enemy's center on the tick of firing ... and is removed after
// `duration` seconds", which at level `1` is a radius of `8` and a duration of
// `2.0` seconds, `round(2.0 x TICK_HZ)` (`120`) ticks by `specs/world.md`'s
// timer rule.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty
// held, one hound `400` units out as the target Ember needs to fire at all, and
// Ember alone, held at level `1` and due at once. `weaponFire` goes back off the
// moment it has fired, so no second bolt arrives over the reading, and
// `effectMotion` stays off, so the bolt holds the place it was fired from and
// nothing it might overlap is in question: a hound is `18` units of radius at
// `400` units, and the bolt is `8` at the lamplighter's centre.
//
// WHAT IS READ. Every tick from the firing tick to four past the
// bolt's end: on each tick the projectile is in `projectiles`, the frame must
// carry a draw of the produced bolt file centred on it and drawn at twice its
// own radius; on each tick after, no draw of that file. The extent is read as the
// destination rectangle's diagonal over the square root of two, because
// `specs/assets.md` leaves a projectile's sprite "upright or turned to its
// velocity as you choose" and a rotation preserves a diagonal.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on the centre and one on the
// extent, which is one device pixel at the harness's fit: a build is free to
// round a fractional world position to the pixel grid before it blits. Nothing
// wider is allowed, because the extent IS the figure the specification fixes.

import { afterEach, beforeEach, it } from "vitest";
import { dueTicks, weaponRow } from "../constants";
import { assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  placeEnemy,
  projectileById,
  type Harness,
} from "../harness";
import { circleShape, drawnOverShape } from "./effects";
import { effectFiles } from "./readouts";
import { primeSources } from "./sources";

/** The target Ember needs, far enough out that the bolt never reaches it. */
const TARGET_AT = { dx: 400, dy: 0 };

/** "removed after `duration` seconds": Ember's level-1 row, in ticks. */
const LIFE = dueTicks(weaponRow("ember", 1).duration ?? 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the bolt sprite over its circle for every tick it is live", async () => {
  const posed = await isolate(h);
  await primeSources(h, effectFiles("ember"));
  const at = posed.run.player;
  await placeEnemy(h, "hound", at.x + TARGET_AT.dx, at.y + TARGET_AT.dy);

  await captureReplay(h, "effect", async () => {
    const firing = await fireWeapon(h, "ember", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.projectiles,
      1,
      "the projectiles Ember's firing tick created, which at level 1 with one " +
        "enemy alive is one bolt (specs/weapons.md)",
    );
    const bolt = firing.projectiles[0]!;

    await drawnOverShape(h, {
      weapon: "ember",
      life: LIFE,
      opened: firing.after,
      find: (snapshot) => {
        const live = projectileById(snapshot, bolt.id);
        return live === undefined ? null : circleShape(live);
      },
    });
  });
});
