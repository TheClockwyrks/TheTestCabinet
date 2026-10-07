// presentation/burst-effect-at-hitbox — Flare's sheet is drawn over the burst's
// own circle, for every tick the flash is live.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live ... so
// the effect's drawn extent is the hitbox's extent on every tick it is drawn."
// Its own row: "flare burst | Flare | `assets/sprites/effects/flare/0.png` to
// `5.png` | a sheet of `6`, played once | `128 x 128` | the burst's circle, for
// `FLARE_FLASH` (`0.4`) seconds", and, below the table, "The burst is drawn at the
// full diameter of its circle, past the edges of the view where the circle reaches
// past them."
//
// `specs/weapons.md` — "Flare" fixes the circle: "On firing, every enemy within
// `radius` of the player's center takes `damage` on that tick ... The burst is
// drawn for `FLARE_FLASH` (`0.4`) seconds and has no hitbox after the tick it
// fires", which at level `1` is a radius of `640` for `round(0.4 x TICK_HZ)`
// (`24`) ticks by `specs/world.md`'s timer rule, and
// `specs/instrumentation.md` reports "a burst's `radius` is its Flare `radius`".
// A `640` radius is a `1280`-unit diameter, so the drawn extent is the whole width
// of the stage: the burst is the one effect whose picture is drawn far larger than
// the canvas it was produced on, and a build that drew it at its file's size
// misses by a factor of ten.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held and
// Flare alone, held at level `1` and due at once. "Flare fires whether or not any
// enemy exists", so nothing is alive; `weaponFire` goes back off the moment it has
// fired, and Flare's own cooldown is sixty seconds besides.
//
// WHICH FRAME OF THE SHEET IS DRAWN IS ANOTHER POINT'S. This one reads where the
// effect landed and how big it was drawn, so any of the six produced files
// satisfies it; the cadence they run at is decided on its own.
//
// WHAT IS READ. Every tick from the firing tick to four past the flash's end: on
// each tick the zone is in `zones`, the frame must carry a draw of one of the
// produced flare files centred on it and drawn at twice its own radius; on each
// tick after, no draw of any of them.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on the centre and one on the
// extent, which is one device pixel at the harness's fit: a build is free to
// round a fractional world position to the pixel grid before it blits. Nothing
// wider is allowed, because the extent IS the figure the specification fixes.

import { afterEach, beforeEach, it } from "vitest";
import { FLARE_FLASH, dueTicks } from "../constants";
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

/** "drawn for `FLARE_FLASH` (`0.4`) seconds": twenty-four ticks, the firing included. */
const LIFE = dueTicks(FLARE_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the flare sheet over the burst's circle for every tick it is live", async () => {
  await isolate(h);
  await primeSources(h, effectFiles("flare"));

  await captureReplay(h, "effect", async () => {
    const firing = await fireWeapon(h, "flare", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.zones,
      1,
      "the zones Flare's firing tick created, which is one burst " +
        "(specs/weapons.md)",
    );
    const burst = firing.zones[0]!;

    await drawnOverShape(h, {
      weapon: "flare",
      life: LIFE,
      opened: firing.after,
      find: (snapshot) => {
        const live = zoneById(snapshot, burst.id);
        return live === undefined ? null : circleShape(live);
      },
    });
  });
});
