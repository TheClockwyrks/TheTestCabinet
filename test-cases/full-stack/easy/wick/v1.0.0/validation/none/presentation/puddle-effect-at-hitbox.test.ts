// presentation/puddle-effect-at-hitbox — Oil Splash's puddle sprite is drawn over
// the puddle's own circle, for the whole of its life.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live ... so
// the effect's drawn extent is the hitbox's extent on every tick it is drawn."
// Its own row: "puddle | Oil Splash | `assets/sprites/effects/oil-splash.png` |
// one sprite | `100 x 100` | the puddle's circle, for its life".
//
// `specs/weapons.md` — "Oil Splash" fixes the circle: "A puddle is a circle of
// `radius` that stays where it landed for `duration` seconds and then vanishes",
// which at level `1` is a radius of `50` for `2.5` seconds,
// `round(2.5 x TICK_HZ)` (`150`) ticks by `specs/world.md`'s timer rule.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held and
// Oil Splash alone, held at level `1` and due at once. "Oil Splash fires whether
// or not any enemy exists", so nothing is alive, and the point never has to know
// which random point of the scatter disk the puddle landed on: where it landed is
// read off the snapshot. `weaponFire` goes back off the moment it has fired, so no
// second puddle arrives over the reading.
//
// WHY THE PICTURE MAY CHANGE UNDER THE READING. `specs/assets.md` says "a
// puddle's" picture on the tick it pulses differs from its picture on the tick
// before, and this point is about neither: it reads the file the frame drew and
// where it landed, so a build that brightens its puddle on a pulse tick is drawing
// the same produced file over the same circle.
//
// WHAT IS READ. Every tick from the firing tick to four past the puddle's end: on
// each tick the zone is in `zones`, the frame must carry a draw of the produced
// puddle file centred on it and drawn at twice its own radius; on each tick after,
// no draw of that file.
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

/** "stays where it landed for `duration` seconds": the level-1 row, in ticks. */
const LIFE = dueTicks(weaponRow("oil-splash", 1).duration ?? 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the puddle sprite over its circle for every tick it is live", async () => {
  await isolate(h);
  await primeSources(h, effectFiles("oil-splash"));

  await captureReplay(h, "effect", async () => {
    const firing = await fireWeapon(h, "oil-splash", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.zones,
      1,
      "the zones Oil Splash's firing tick created, which at level 1 is one " +
        "puddle (specs/weapons.md)",
    );
    const puddle = firing.zones[0]!;

    await drawnOverShape(h, {
      weapon: "oil-splash",
      life: LIFE,
      opened: firing.after,
      find: (snapshot) => {
        const live = zoneById(snapshot, puddle.id);
        return live === undefined ? null : circleShape(live);
      },
    });
  });
});
