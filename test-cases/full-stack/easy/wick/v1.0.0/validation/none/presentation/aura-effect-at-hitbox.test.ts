// presentation/aura-effect-at-hitbox — Halo's ring is drawn over the aura's own
// circle on every tick the aura is in the world.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live ... so
// the effect's drawn extent is the hitbox's extent on every tick it is drawn."
// Its own row: "aura ring | Halo | `assets/sprites/effects/halo.png` | one
// sprite, a ring | `160 x 160` | the aura's circle, always".
//
// `specs/weapons.md` — "Halo" fixes the circle and its life: "Halo is a permanent
// aura: one zone of kind `aura`, a circle of `radius` centered on the player's
// center every tick. The zone is created on the first `playing` tick Halo is held
// and none exists, it is removed on the next `playing` tick Halo is no longer
// held, and its `radius` and `damage` are recomputed on every tick." So the aura
// has no duration of its own, and "always" means every tick it exists — which is
// every tick between the one that placed it and the one that removes it.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held and
// Halo alone at level `1`. `specs/instrumentation.md` puts the aura outside the
// switches — "Placement is gated by neither `weaponFire` nor `effectMotion`: on
// every `playing` tick, whatever the two hold, the placement part of phase 5 of
// `specs/world.md` runs, so an aura ... is created, removed, re-centered, and
// resized exactly as that phase states" — so holding the weapon is all the
// scenario needs, and the aura never pulses over the reading.
//
// WHY SIXTY TICKS AND THEN THE DROP. A shape with no duration needs an end for
// the second half of the requirement to have anything to read, and the
// specification gives it exactly one: the weapon is no longer held. So the aura is
// watched for a second of ticks, Halo is dropped, and the ticks after read whether
// the ring went with it.
//
// WHAT IS READ. Every tick: while the zone is in `zones`, the frame must carry a
// draw of the produced ring centred on the zone's own centre and drawn at twice
// its live radius, which is read off each tick's snapshot rather than assumed,
// since the specification recomputes it every tick; on each tick after the drop,
// no draw of that file.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on the centre and one on the
// extent, which is one device pixel at the harness's fit: a build is free to
// round a fractional world position to the pixel grid before it blits. Nothing
// wider is allowed, because the extent IS the figure the specification fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  zoneById,
  zonesOfKind,
  type Harness,
} from "../harness";
import { circleShape, drawnOverShape } from "./effects";
import { effectFiles } from "./readouts";
import { primeSources } from "./sources";

/** How long the aura is watched before Halo is dropped: a second of ticks. */
const WATCHED = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the aura ring over the aura's circle for every tick it exists", async () => {
  await isolate(h);
  await primeSources(h, effectFiles("halo"));

  await captureReplay(h, "effect", async () => {
    const slot = await holdWeapon(h, "halo", 1);
    const placed = await h.step(1);
    const auras = zonesOfKind(placed, "aura");
    assertLength(
      auras,
      1,
      "the aura zones on the first playing tick Halo is held, which is the one " +
        "the placement phase creates (specs/weapons.md)",
    );
    const aura = auras[0]!;

    await drawnOverShape(h, {
      weapon: "halo",
      life: WATCHED,
      opened: placed,
      endLife: () => h.debug.removeWeapon(slot),
      find: (snapshot) => {
        const live = zoneById(snapshot, aura.id);
        return live === undefined ? null : circleShape(live);
      },
    });
  });
});
