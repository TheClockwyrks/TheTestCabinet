// presentation/slash-effect-at-hitbox — Taper's slash sprite is drawn over the rectangle it hits with, for as long as that rectangle is live.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live, as
// `specs/weapons.md` and `specs/evolutions.md` define that shape. Each is
// produced on the canvas its row states and scaled in code to the live shape,
// which `areaMul` and later levels grow, so the effect's drawn extent is the
// hitbox's extent on every tick it is drawn." Its own row of that table gives
// the file and the shape: "slash | Taper |
// `assets/sprites/effects/taper.png` | one sprite | `120 x 40` | the
// `width x height` rectangle, for `SLASH_FLASH` (`0.1`) seconds".
// `specs/weapons.md` — "Taper" fixes the rectangle itself: "A slash is a
// rectangle of `width x height`: on the tick it fires it hits every enemy
// overlapping it ... Its near vertical edge is at the player's `x`, it extends
// `width` in the facing direction, and it is centered vertically on the player's
// `y`. The slash is drawn for `SLASH_FLASH` (`0.1`) seconds", which
// `specs/world.md`'s timer rule makes `round(0.1 x TICK_HZ)` (`6`) ticks.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty
// held, and Taper alone, held at level `1` and due at once, so the one shape on
// the field is the slash the firing tick made. `weaponFire` goes back off the
// moment it has fired, so the cooldown holds where it stands and no second slash
// arrives over the reading. Taper needs no target, so nothing else is alive.
//
// WHAT IS READ. Every tick from the firing tick to four past the
// slash's end: on each tick the zone is in `zones`, the frame must carry a draw
// of the produced slash file centred on the zone's own centre and drawn at the
// zone's own `width` and `height`; on each tick after, no draw of that file at
// all. The rectangle is read side by side rather than as a diagonal, because
// `specs/weapons.md` fixes it axis-aligned.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on the centre and one on the
// extent, which is one device pixel at the harness's fit: a build is free to
// round a fractional world position to the pixel grid before it blits. Nothing
// wider is allowed, because the extent IS the figure the specification fixes.

import { afterEach, beforeEach, it } from "vitest";
import { SLASH_FLASH, dueTicks } from "../constants";
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
import { drawnOverShape } from "./effects";
import { effectFiles } from "./readouts";
import { primeSources } from "./sources";

/** "drawn for `SLASH_FLASH` (`0.1`) seconds": six ticks, the firing tick included. */
const LIFE = dueTicks(SLASH_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the slash sprite over its rectangle for every tick it is live", async () => {
  await isolate(h);
  await primeSources(h, effectFiles("taper"));

  await captureReplay(h, "effect", async () => {
    const firing = await fireWeapon(h, "taper", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.zones,
      1,
      "the zones Taper's firing tick created, which at level 1 is one slash " +
        "(specs/weapons.md)",
    );
    const slash = firing.zones[0]!;

    await drawnOverShape(h, {
      weapon: "taper",
      life: LIFE,
      opened: firing.after,
      rectangle: true,
      find: (snapshot) => {
        const zone = zoneById(snapshot, slash.id);
        return zone === undefined
          ? null
          : {
              x: zone.x,
              y: zone.y,
              width: zone.width ?? 0,
              height: zone.height ?? 0,
            };
      },
    });
  });
});
