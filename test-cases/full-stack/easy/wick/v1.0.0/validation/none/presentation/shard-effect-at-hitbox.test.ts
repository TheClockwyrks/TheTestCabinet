// presentation/shard-effect-at-hitbox — Shard's sprite is drawn over the shard's
// own circle, for the whole of its life.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live ... so
// the effect's drawn extent is the hitbox's extent on every tick it is drawn."
// Its own row: "shard | Shard | `assets/sprites/effects/shard.png` | one sprite |
// `16 x 16` | the shard's circle, for its life".
//
// `specs/weapons.md` — "Shard" fixes the circle: "A shard is a circle of `radius`,
// fired from the player's center at `speed` toward the nearest enemy, or in the
// facing direction when no enemy exists ... and it is removed after `duration`
// seconds", which at level `1` is a radius of `8` for `3.0` seconds,
// `round(3.0 x TICK_HZ)` (`180`) ticks by `specs/world.md`'s timer rule.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held and
// Shard alone, held at level `1` and due at once. "Shard fires whether or not any
// enemy exists", so nothing is alive; `weaponFire` goes back off the moment it has
// fired, so no second shard arrives over the reading, and `effectMotion` stays
// off, which `specs/instrumentation.md` says holds "every projectile ... position
// and velocity" while leaving `ttl` counting, so the shard neither travels nor
// bounces over the reading and lives exactly its own life.
//
// WHAT IS READ. Every tick from the firing tick to four past the shard's end: on
// each tick the projectile is in `projectiles`, the frame must carry a draw of the
// produced shard file centred on it and drawn at twice its own radius; on each
// tick after, no draw of that file. The extent is read as the destination
// rectangle's diagonal over the square root of two, because `specs/assets.md`
// leaves a projectile's sprite "upright or turned to its velocity as you choose".
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
  projectileById,
  type Harness,
} from "../harness";
import { circleShape, drawnOverShape } from "./effects";
import { effectFiles } from "./readouts";
import { primeSources } from "./sources";

/** "removed after `duration` seconds": Shard's level-1 row, in ticks. */
const LIFE = dueTicks(weaponRow("shard", 1).duration ?? 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the shard sprite over its circle for every tick it is live", async () => {
  await isolate(h);
  await primeSources(h, effectFiles("shard"));

  await captureReplay(h, "effect", async () => {
    const firing = await fireWeapon(h, "shard", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.projectiles,
      1,
      "the projectiles Shard's firing tick created, which at level 1 is one " +
        "shard (specs/weapons.md)",
    );
    const shard = firing.projectiles[0]!;

    await drawnOverShape(h, {
      weapon: "shard",
      life: LIFE,
      opened: firing.after,
      find: (snapshot) => {
        const live = projectileById(snapshot, shard.id);
        return live === undefined ? null : circleShape(live);
      },
    });
  });
});
