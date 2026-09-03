// assets/models-drawn-at-voxel-scale — a model is drawn at a scale of
// 1 / VOXELS_PER_UNIT of the mesh it was sculpted as.
//
// specs/assets.md § The models: "Sculpt each model with `voxel` at
// `VOXELS_PER_UNIT` (`8`): eight voxels to one world unit, so the game draws
// every model at a scale of `1 / VOXELS_PER_UNIT`."
//
// WHY THAT IS A REQUIREMENT AT ALL. A `.glb` out of `voxel` is in VOXELS, so a
// mesh of a crate is sixteen units across rather than two. A build that dropped
// the model into the scene at the mesh's own scale would draw a crate eight times
// the size of the box it collides and places by, and one that scaled it to fit
// the class box would draw a model sculpted small at a size it was never sculpted
// for. The figure is exact and the specification states it, so it can be read
// exactly.
//
// THE READING, UNDER AN ENGINE. specs/assets.md has an engine build load each
// model "through the engine's own asset loader under its asset root", so a model
// on screen is a `ModelComponent` the world holds. The check decodes the
// committed file for itself through that same loader and measures the mesh's own
// extent in the units it was sculpted in; then it measures the box the placement
// FILLS in the world — the same extent, put through the transform the pipeline
// draws it at. The ratio of the two is the scale the model is drawn at, whatever
// the build applied it on: the actor, the component's offset, or both.
//
// THE ENGINELESS PROJECT MEASURES THE SILHOUETTE ON THE STAGE, by photographing
// the yard with the load and without it, and so has to allow for rounded corners,
// outlines and antialiasing. There is no rasterizer here — `validation/host.ts`
// gives three a WebGL2 context that answers every call and draws nothing — so
// what is measured is the extent itself, and the figure can be held to the exact
// one the specification states.
//
// ONE MODEL, POSED ALONE. The crate is the model a validator can put in an
// otherwise empty yard by itself, with nothing else drawn near it. The scale is
// one rule over all eight models, so reading it on the one that can be isolated
// is reading the rule.
//
// THE TOLERANCE IS A THOUSANDTH OF THE EXTENT, which is arithmetic error and
// nothing else: both numbers come from the same decoded mesh, one of them through
// the build's own transform.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertTrue, fail } from "../assert";
import { LOAD_CLASS_DIMENSIONS, VOXELS_PER_UNIT } from "../constants";
import {
  addOneLoad,
  clearAll,
  committedModel,
  createHarness,
  drawnFromModel,
  drawnModelBox,
  modelBounds,
  openSite,
  type Harness,
  type LoadPose,
} from "../harness";

const SITE = 0;

/** The one load: a crate, and the file specs/assets.md names for that class. */
const CLASS = "crate" as const;
const MODEL = "models/crate.glb";
const MASS = 40;

/** Where it stands: clear of the site's anchors, resting on the ground. */
const AT: LoadPose = {
  x: 7,
  y: LOAD_CLASS_DIMENSIONS[CLASS].y,
  z: -3,
  yaw: 0,
};

/** How far the drawn extent may stand from the sculpted one over the scale. */
const TOLERANCE_SHARE = 1 / 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a model at 1 / VOXELS_PER_UNIT of its sculpted extent", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await addOneLoad(h, CLASS, MASS, AT, AT);
  await h.advance(1);

  // The mesh as it was sculpted, in voxels: the file's own extent.
  const committed = await committedModel(h, MODEL);
  if (committed === null) {
    fail(
      `the produced model committed at \`assets/${MODEL}\`, which ` +
        "specs/assets.md requires the build to produce with `voxel` and commit " +
        "under that name",
      "nothing under the asset root decodes there",
    );
  }
  const sculpted = modelBounds(committed);
  if (sculpted === null) {
    fail(
      `\`assets/${MODEL}\` to carry a mesh, which is what \`voxel\`'s ` +
        "`render` writes into it (specs/assets.md)",
      "the decoded model carries no geometry",
    );
  }

  const placed = await drawnFromModel(h, MODEL);
  assertEqual(
    placed.length,
    1,
    "the placements of the committed crate model with one crate in the yard " +
      "(specs/assets.md)",
  );
  const drawn = drawnModelBox(placed[0]!);
  assertTrue(drawn !== null, "the placed model to carry geometry to draw");

  for (const axis of ["x", "y", "z"] as const) {
    const inVoxels = sculpted.size[axis];
    assertTrue(
      inVoxels > 0,
      `the sculpted mesh to have an extent in ${axis} to be scaled from`,
    );
    assertNear(
      drawn!.size[axis],
      inVoxels / VOXELS_PER_UNIT,
      Math.max((inVoxels / VOXELS_PER_UNIT) * TOLERANCE_SHARE, 1e-6),
      `the ${axis} extent the crate model is drawn at, against the ` +
        `${inVoxels} voxels it was sculpted as over VOXELS_PER_UNIT ` +
        `(${VOXELS_PER_UNIT}): "the game draws every model at a scale of ` +
        '`1 / VOXELS_PER_UNIT`" (specs/assets.md)',
    );
  }

  await h.capture(
    "scale",
    "The drawn extent measured against the sculpted mesh",
  );
});
