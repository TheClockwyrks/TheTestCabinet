// presentation/strike-effect-at-hitbox — Spark's strike sheet is drawn over the
// strike's own area circle, for every tick the flash is live.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live ... so
// the effect's drawn extent is the hitbox's extent on every tick it is drawn."
// Its own row: "strike | Spark | `assets/sprites/effects/spark/0.png` to `3.png`
// | a sheet of `4`, played once | `80 x 80` | the strike's `area` circle, for
// `SPARK_FLASH` (`0.2`) seconds".
//
// `specs/weapons.md` — "Spark" fixes the circle: "A strike deals `damage` to its
// target and to every other enemy within `area` of the target's center, on the
// tick it lands. The strike is drawn for `SPARK_FLASH` (`0.2`) seconds and has no
// hitbox after the tick it lands", which `specs/world.md`'s timer rule makes
// `round(0.2 x TICK_HZ)` (`12`) ticks, and `specs/instrumentation.md` reports "a
// strike's `radius` is its `area`".
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, one
// hound `300` units out, and Spark alone, held at level `1` and due at once.
// Spark needs a target within `SPARK_RANGE` (`600`) to fire at all, and the hound
// is the only one, so the strike lands on it and where the strike is is not a
// random draw. A hound carries `120` health against Spark's `15` at level `1`, so
// it survives the flash and nothing else joins the frame. `weaponFire` goes back
// off the moment it has fired.
//
// WHICH FRAME OF THE SHEET IS DRAWN IS ANOTHER POINT'S. This one reads where the
// effect landed and how big it was drawn, so any of the four produced files
// satisfies it; the cadence they run at is decided on its own.
//
// WHAT IS READ. Every tick from the firing tick to four past the flash's end: on
// each tick the zone is in `zones`, the frame must carry a draw of one of the
// produced strike files centred on it and drawn at twice its own radius; on each
// tick after, no draw of any of them.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on the centre and one on the
// extent, which is one device pixel at the harness's fit: a build is free to
// round a fractional world position to the pixel grid before it blits. Nothing
// wider is allowed, because the extent IS the figure the specification fixes.

import { afterEach, beforeEach, it } from "vitest";
import { SPARK_FLASH, dueTicks } from "../constants";
import { assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  placeEnemy,
  zoneById,
  type Harness,
} from "../harness";
import { circleShape, drawnOverShape } from "./effects";
import { effectFiles } from "./readouts";
import { primeSources } from "./sources";

/** The target Spark needs, well inside SPARK_RANGE and clear of the centre. */
const TARGET_AT = { dx: 300, dy: 0 };

/** "drawn for `SPARK_FLASH` (`0.2`) seconds": twelve ticks, the landing included. */
const LIFE = dueTicks(SPARK_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the strike sheet over its area circle for every tick it is live", async () => {
  const posed = await isolate(h);
  await primeSources(h, effectFiles("spark"));
  const at = posed.run.player;
  await placeEnemy(h, "hound", at.x + TARGET_AT.dx, at.y + TARGET_AT.dy);

  await captureReplay(h, "effect", async () => {
    const firing = await fireWeapon(h, "spark", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.zones,
      1,
      "the zones Spark's firing tick created, which at level 1 with one " +
        "enemy in range is one strike (specs/weapons.md)",
    );
    const strike = firing.zones[0]!;

    await drawnOverShape(h, {
      weapon: "spark",
      life: LIFE,
      opened: firing.after,
      find: (snapshot) => {
        const live = zoneById(snapshot, strike.id);
        return live === undefined ? null : circleShape(live);
      },
    });
  });
});
