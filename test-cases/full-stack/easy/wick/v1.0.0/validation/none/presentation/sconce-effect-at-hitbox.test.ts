// presentation/sconce-effect-at-hitbox — Sconce's sheet is drawn over the
// sconce's own circle, for the whole of its life.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live ... so
// the effect's drawn extent is the hitbox's extent on every tick it is drawn."
// Its own row: "sconce | Sconce | `assets/sprites/effects/sconce/0.png` to
// `3.png` | a sheet of `4`, spinning | `24 x 24` | the sconce's circle, for its
// life".
//
// `specs/weapons.md` — "Sconce" fixes the circle: "A sconce is a circle of
// `radius`, launched from the player's center at `speed` along the launch
// direction `d` ... it is removed after `duration` seconds", which at level `1`
// is a radius of `12` for `2.5` seconds, `round(2.5 x TICK_HZ)` (`150`) ticks by
// `specs/world.md`'s timer rule.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, one
// hound `300` units out, and Sconce alone, held at level `1` and due at once.
// "Sconce needs at least one enemy to fire", and the hound is the only one, so
// the launch direction is not a question. `weaponFire` goes back off the moment it
// has fired, and `effectMotion` stays off, which `specs/instrumentation.md` says
// holds every projectile's position and velocity while leaving `ttl` counting, so
// the sconce neither travels nor decelerates over the reading and never reaches
// the hound.
//
// WHICH FRAME OF THE SHEET IS DRAWN IS ANOTHER POINT'S. This one reads where the
// effect landed and how big it was drawn, so any of the four produced files
// satisfies it; the spin they run at is decided on its own.
//
// WHAT IS READ. Every tick from the firing tick to four past the sconce's end: on
// each tick the projectile is in `projectiles`, the frame must carry a draw of one
// of the produced sconce files centred on it and drawn at twice its own radius; on
// each tick after, no draw of any of them.
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

/** The target Sconce needs, far enough out that the held sconce never reaches it. */
const TARGET_AT = { dx: 300, dy: 0 };

/** "removed after `duration` seconds": Sconce's level-1 row, in ticks. */
const LIFE = dueTicks(weaponRow("sconce", 1).duration ?? 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the sconce sheet over its circle for every tick it is live", async () => {
  const posed = await isolate(h);
  await primeSources(h, effectFiles("sconce"));
  const at = posed.run.player;
  await placeEnemy(h, "hound", at.x + TARGET_AT.dx, at.y + TARGET_AT.dy);

  await captureReplay(h, "effect", async () => {
    const firing = await fireWeapon(h, "sconce", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.projectiles,
      1,
      "the projectiles Sconce's firing tick created, which at level 1 with " +
        "one enemy alive is one sconce (specs/weapons.md)",
    );
    const sconce = firing.projectiles[0]!;

    await drawnOverShape(h, {
      weapon: "sconce",
      life: LIFE,
      opened: firing.after,
      find: (snapshot) => {
        const live = projectileById(snapshot, sconce.id);
        return live === undefined ? null : circleShape(live);
      },
    });
  });
});
