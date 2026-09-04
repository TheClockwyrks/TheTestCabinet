// presentation/lantern-effect-at-hitbox — Lantern's sprite is drawn over each
// lantern's own circle, for the whole of the set's life.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live ... so
// the effect's drawn extent is the hitbox's extent on every tick it is drawn."
// Its own row: "lantern | Lantern | `assets/sprites/effects/lantern.png` | one
// sprite | `28 x 28` | each lantern's circle, for its life".
//
// `specs/weapons.md` — "Lantern" fixes the circles: "On firing, `amount` lanterns
// appear on a circle of radius `orbit` around the player's center ... Each
// lantern is a circle of `radius`, and each is a zone with `ttl` set to
// `duration`", which at level `1` is one lantern of radius `14` on a `90` orbit
// for `3.0` seconds, `round(3.0 x TICK_HZ)` (`180`) ticks by `specs/world.md`'s
// timer rule.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held and
// Lantern alone, held at level `1` and due at once, so the one shape on the field
// is the single lantern the firing tick made. Lantern needs no target, so nothing
// is alive. `weaponFire` goes back off the moment it has fired, and
// `effectMotion` stays off, which `specs/instrumentation.md` says holds "every
// lantern ... angle" while leaving `ttl` counting, so the lantern stays where the
// firing put it for exactly its own life.
//
// WHY THE WEAPON IS DROPPED AT THE END. `specs/world.md`'s placement phase creates
// a lantern set "on a tick its weapon is held and none exists", so a set that
// expires while Lantern is still held may be followed at once by another one, and
// the ticks after the shape are then about a different shape. Dropping the weapon
// on the last tick of the set's life settles that: nothing can be placed, and what
// the ticks after the end read is whether the set that expired left anything drawn
// behind it.
//
// WHAT IS READ. Every tick from the firing tick to four past the set's end: on
// each tick the zone is in `zones`, the frame must carry a draw of the produced
// lantern file centred on it and drawn at twice its own radius; on each tick
// after, no draw of that file.
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
  zoneById,
  type Harness,
} from "../harness";
import { circleShape, drawnOverShape } from "./effects";
import { effectFiles } from "./readouts";
import { primeSources } from "./sources";

/** "`ttl` set to `duration`": Lantern's level-1 row, in ticks. */
const LIFE = dueTicks(weaponRow("lantern", 1).duration ?? 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the lantern sprite over its circle for every tick it is live", async () => {
  await isolate(h);
  await primeSources(h, effectFiles("lantern"));

  await captureReplay(h, "effect", async () => {
    const firing = await fireWeapon(h, "lantern", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.zones,
      1,
      "the zones Lantern's firing tick created, which at level 1 is one " +
        "lantern (specs/weapons.md)",
    );
    const lantern = firing.zones[0]!;

    await drawnOverShape(h, {
      weapon: "lantern",
      life: LIFE,
      opened: firing.after,
      endLife: () => h.debug.removeWeapon(firing.slot),
      find: (snapshot) => {
        const live = zoneById(snapshot, lantern.id);
        return live === undefined ? null : circleShape(live);
      },
    });
  });
});
