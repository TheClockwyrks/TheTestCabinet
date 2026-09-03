// assets/ring-model-on-the-slew-axis — the ring is drawn on the slew axis, and
// between its own two flanges.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: the ring centered on the slew axis between its flanges …".
// specs/structure.md fixes both of those: the ring "occupies eight nodes" — four
// at the base corner's own `y` and the same four at `y + LATTICE_PITCH` — and
// "The slew axis is the vertical line through the flange square's center,
// `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)`".
//
// SO THE POINT IS TWO SENTENCES ABOUT ONE PLACEMENT, and it is read as one: the
// box the drum fills is centered on the slew axis in `x` and `z`, and it stands
// between the bottom flange's level and the top flange's rather than above or
// below them. A ring drawn at its base corner rather than at the flange square's
// center misses the first; a ring drawn on the ground, or up on the arm, misses
// the second.
//
// WHERE A MODEL IS DRAWN, UNDER AN ENGINE. specs/assets.md has an engine build
// load each model "through the engine's own asset loader under its asset root",
// so a model on screen is a `ModelComponent` the world holds. `drawnFromModel`
// answers the placements of one committed file — it decodes that file for itself
// through the same loader and matches a component's model against it by contents,
// so a subject drawn from another subject's file does not answer — and
// `drawnModelBox` answers the box each placement FILLS: the model's own extent,
// scaled and turned and stood where the component stands. The component's
// transform is the model's origin, which an exporter is free to put at a corner,
// so the box is what "where it is drawn" means.
//
// THE ENGINELESS PROJECT DECIDES THIS BY SERVING THE FILE WITH ANOTHER MODEL'S
// BYTES and reading which pixels change. There is no rasterizer here —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so the reading is the picture's contents rather than its
// pixels.
//
// THE WORLD IS ONE RING. `clearAll` empties the yard and `setRing` stands it on a
// base corner a lattice pitch off the ground, so the only subject in it is the
// ring itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertTrue } from "../assert";
import { LATTICE_PITCH } from "../constants";
import {
  clearAll,
  createHarness,
  drawnFromModel,
  drawnModelBox,
  openSite,
  type Harness,
} from "../harness";

/** The subject's produced model, under the asset root specs/assets.md fixes. */
const MODEL = "models/ring.glb";

const SITE = 0;

/** The base corner the ring is placed by (specs/structure.md). */
const CORNER = { x: 0, y: 2, z: 0 };

/** The slew axis: the vertical through the flange square's center. */
const AXIS = {
  x: CORNER.x + LATTICE_PITCH / 2,
  z: CORNER.z + LATTICE_PITCH / 2,
};

/** The two flanges' levels. */
const BOTTOM_FLANGE = CORNER.y;
const TOP_FLANGE = CORNER.y + LATTICE_PITCH;

/**
 * How far off the axis the drum's own middle may stand.
 *
 * specs/assets.md sizes the ring only "about `2.5 x 2 x 2.5` units" and says the
 * part figures "are the intent, not a tolerance", so the sculpt is free to be a
 * little lopsided inside its own box. A quarter of a unit is two voxels at
 * `VOXELS_PER_UNIT` (`8`) and an eighth of `LATTICE_PITCH`, so a drum centered on
 * the base corner rather than on the axis — a whole unit off — does not pass.
 */
const OFF_AXIS = 0.25;

/**
 * How far past a flange the drum may reach.
 *
 * "Between its flanges" is where the drum stands, and a bearing sculpted `2`
 * units tall for a two-unit gap fills it exactly; half a unit each way is room
 * for a flange lip the sculpt carries and still far short of the next node.
 */
const PAST_FLANGE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ring on the slew axis, between its flanges", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  await h.advance(1);

  const placed = await drawnFromModel(h, MODEL);
  assertEqual(
    placed.length,
    1,
    "the placements of the committed ring model with one ring standing: " +
      '"a crane has exactly one" (specs/structure.md) and the game draws it ' +
      '"centered on the slew axis between its flanges" (specs/assets.md)',
  );

  const box = drawnModelBox(placed[0]!);
  assertTrue(box !== null, "the ring model to carry geometry to be drawn from");

  assertNear(
    box!.centre.x,
    AXIS.x,
    OFF_AXIS,
    "the x the drawn ring is centered on, against the slew axis's " +
      `(${AXIS.x}) (specs/assets.md, specs/structure.md)`,
  );
  assertNear(
    box!.centre.z,
    AXIS.z,
    OFF_AXIS,
    "the z the drawn ring is centered on, against the slew axis's " +
      `(${AXIS.z}) (specs/assets.md, specs/structure.md)`,
  );
  assertTrue(
    box!.min.y >= BOTTOM_FLANGE - PAST_FLANGE &&
      box!.max.y <= TOP_FLANGE + PAST_FLANGE,
    `the drawn ring standing between its flanges, ${BOTTOM_FLANGE} to ` +
      `${TOP_FLANGE} (specs/assets.md, specs/structure.md) — it reaches ` +
      `${box!.min.y.toFixed(2)} to ${box!.max.y.toFixed(2)}`,
  );

  await h.capture("ring", "The ring on the slew axis, between its flanges");
});
