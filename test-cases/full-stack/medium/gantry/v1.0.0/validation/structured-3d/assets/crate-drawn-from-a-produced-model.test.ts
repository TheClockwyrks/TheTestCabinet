// assets/crate-drawn-from-a-produced-model — the crate on screen is a produced
// model file, decoded and drawn.
//
// specs/assets.md § The models: the eight models are produced with `voxel` and
// committed as `assets/models/<model>.glb`, and the table's row for `crate` is
// "the `crate` load class". specs/assets.md, intro: "The name a file carries is
// what says which subject or which cue it is", and each model is committed "under
// the model name the table below gives it". So the file that draws a crate is not
// something a validator has to guess: it is the one the specification named.
//
// HOW A DRAWING IS SHOWN TO COME FROM A FILE, UNDER AN ENGINE. specs/assets.md
// has an engine build load each model "through the engine's own asset loader
// under its asset root" and adds that "No part of the build decodes glTF
// itself", so a model on screen is a `ModelComponent` the world holds, built
// over the decode of one of the committed files. The check decodes the
// committed file for itself, through the same loader, and looks for a placement
// of THAT decode: `drawnFromModel` matches a component's model against the file
// by its contents — every node name in traversal order and every mesh's vertex
// and index count — so a subject drawn from another subject's file does not
// answer, and neither does one drawn from geometry the build wrote in code.
//
// AND IT HAS TO STAND WHERE THE SUBJECT IS, or the reading would pass a build
// that decoded the file and drew it somewhere else entirely. specs/assets.md
// fixes that too: "The game draws each model wherever its subject is". What is
// compared is the box the placed model FILLS — the model's own extent, scaled and
// turned and stood where the component stands — because the component's transform
// is the model's origin, which the exporter is free to put at a corner.
//
// THE ENGINELESS PROJECT DECIDES THE SAME POINT BY SERVING THE SUBJECT'S FILE
// WITH ANOTHER MODEL'S BYTES and reading the pixels that change. There is no
// rasterizer here — `validation/host.ts` gives three a WebGL2 context that
// answers every call and draws nothing — so the reading is the picture's
// contents rather than its pixels.
//
// THE WORLD IS ONE CRATE AND NOTHING ELSE — an emptied yard with no structure, no
// obstacles and no other load — so the only subject in it whose model this
// scenario can place is that load.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  addOneLoad,
  clearAll,
  committedModel,
  createHarness,
  drawnFromModel,
  drawnModelBox,
  openSite,
  type Harness,
  type LoadPose,
} from "../harness";

/** The subject's produced model, under the asset root specs/assets.md fixes. */
const MODEL = "models/crate.glb";

const SITE = 0;
const MASS = 40;

/** Where the one load stands: clear of the site's anchors, on the ground. */
const AT = { x: 7, z: -3, yaw: 0 };

/**
 * How far outside the box a model fills the subject's own point may stand.
 *
 * specs/assets.md sizes each model only "about" its figure and says of the part
 * figures that they "are the intent, not a tolerance", so a build is free to
 * sculpt a block a little short of the point it is drawn around. A quarter of a
 * unit is two voxels at `VOXELS_PER_UNIT` (`8`) — the smallest step the sculpting
 * grid has any business being off by — and is far short of `LATTICE_PITCH` (`2`),
 * so a model drawn at the neighboring node does not answer.
 */
const SLACK = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the crate from its produced model file", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  // The load rests on the ground, so its lift point stands at its class height
  // above it (specs/world.md).
  const size = LOAD_CLASS_DIMENSIONS["crate"];
  const pose: LoadPose = { x: AT.x, y: size.y, z: AT.z, yaw: AT.yaw };
  await addOneLoad(h, "crate", MASS, pose, pose);
  await h.advance(1);

  // The committed file itself, decoded through the engine's own loader: what a
  // component in the world is matched against.
  const committed = await committedModel(h, MODEL);
  if (committed === null) {
    fail(
      `the produced model committed at \`assets/${MODEL}\`, which ` +
        "specs/assets.md requires the build to produce with `voxel` and commit " +
        "under that name",
      "nothing under the asset root decodes there",
    );
  }

  const placed = await drawnFromModel(h, MODEL);
  if (placed.length === 0) {
    fail(
      `\`assets/${MODEL}\` decoded and drawn in the yard, which is what ` +
        "specs/assets.md asks of the build: it produces the model, commits it " +
        "under that name, and the game loads it through the engine's asset " +
        "loader and draws it wherever its subject is",
      "no render component in the world carries that model",
    );
  }

  // Where the load stands: the middle of the class box hanging under its lift
  // point (specs/world.md).
  const middle = {
    x: pose.x,
    y: pose.y - size.y / 2,
    z: pose.z,
  };
  const covering = placed
    .map((one) => drawnModelBox(one))
    .filter((box) => box !== null)
    .filter(
      (box) =>
        middle.x >= box.min.x - SLACK &&
        middle.x <= box.max.x + SLACK &&
        middle.y >= box.min.y - SLACK &&
        middle.y <= box.max.y + SLACK &&
        middle.z >= box.min.z - SLACK &&
        middle.z <= box.max.z + SLACK,
    );
  assertGreaterThan(
    covering.length,
    0,
    "a placement of the committed model standing over the middle of the load's class box, " +
      `(${middle.x.toFixed(2)}, ${middle.y.toFixed(2)}, ` +
      `${middle.z.toFixed(2)}): "The game draws each model wherever its ` +
      'subject is" (specs/assets.md). It is drawn at ' +
      JSON.stringify(placed.map((one) => drawnModelBox(one)?.centre)),
  );

  await h.capture("crate", "The crate drawn from its produced model");
});
