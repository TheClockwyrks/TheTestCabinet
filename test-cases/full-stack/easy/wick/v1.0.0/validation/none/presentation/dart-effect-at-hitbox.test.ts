// presentation/dart-effect-at-hitbox — Pin's dart sprite is drawn over the dart's own circle, for the whole of its life.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live, as
// `specs/weapons.md` and `specs/evolutions.md` define that shape. Each is
// produced on the canvas its row states and scaled in code to the live shape,
// which `areaMul` and later levels grow, so the effect's drawn extent is the
// hitbox's extent on every tick it is drawn." Its own row of that table gives
// the file and the shape: "dart | Pin |
// `assets/sprites/effects/pin.png` | one sprite | `12 x 12` | the dart's circle,
// for its life".
// `specs/weapons.md` — "Pin" fixes the circle: "A dart is a circle of `radius`,
// fired horizontally in the facing direction at `speed`, and removed after
// `duration` seconds", which at level `1` is a radius of `6` and a duration of
// `1.5` seconds, `round(1.5 x TICK_HZ)` (`90`) ticks by `specs/world.md`'s timer
// rule.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty
// held and Pin alone, held at level `1` and due at once. "Pin fires whether or
// not any enemy exists", so nothing is alive at all; `weaponFire` goes back off
// the moment it has fired, so no second dart arrives over the reading, and
// `effectMotion` stays off, so the dart holds the place it was fired from.
//
// WHAT IS READ. Every tick from the firing tick to four past the
// dart's end: on each tick the projectile is in `projectiles`, the frame must
// carry a draw of the produced dart file centred on it and drawn at twice its own
// radius; on each tick after, no draw of that file. The extent is read as the
// destination rectangle's diagonal over the square root of two, because
// `specs/assets.md` leaves a projectile's sprite "upright or turned to its
// velocity as you choose".
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

/** "removed after `duration` seconds": Pin's level-1 row, in ticks. */
const LIFE = dueTicks(weaponRow("pin", 1).duration ?? 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the dart sprite over its circle for every tick it is live", async () => {
  await isolate(h);
  await primeSources(h, effectFiles("pin"));

  await captureReplay(h, "effect", async () => {
    const firing = await fireWeapon(h, "pin", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.projectiles,
      1,
      "the projectiles Pin's firing tick created, which at level 1 is one dart " +
        "(specs/weapons.md)",
    );
    const dart = firing.projectiles[0]!;

    await drawnOverShape(h, {
      weapon: "pin",
      life: LIFE,
      opened: firing.after,
      find: (snapshot) => {
        const live = projectileById(snapshot, dart.id);
        return live === undefined ? null : circleShape(live);
      },
    });
  });
});
