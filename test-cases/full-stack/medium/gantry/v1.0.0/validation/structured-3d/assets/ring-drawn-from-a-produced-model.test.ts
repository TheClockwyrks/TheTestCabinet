// assets/ring-drawn-from-a-produced-model — the slew ring on screen is the
// committed `ring` model, decoded and drawn.
//
// specs/assets.md § The models: "ring | the slew ring: a squat bearing drum
// between its flanges", one of the eight models the build "produces … commits …
// and wires in", each committed as `assets/models/<model>.glb` under the name
// that table gives it. § What is drawn in code leaves the lattice, the ground and
// the aids to the build's own drawing; the bearing between the flanges is not one
// of them.
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
// THE WORLD IS THE RING AND NOTHING ELSE. `clearAll` empties the yard and
// `setRing` stands one ring on its base corner, so the only produced model this
// scenario can put in the world for this subject is the ring's own.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { LATTICE_PITCH } from "../constants";
import {
  clearAll,
  committedModel,
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

/**
 * The slew axis, and the level halfway between the two flanges.
 *
 * specs/structure.md: the ring "occupies eight nodes" — the four at the corner's
 * own `y` and the same four at `y + LATTICE_PITCH` — and "The slew axis is the
 * vertical line through the flange square's center,
 * `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)`". So the point the drum is
 * drawn around is on that axis, midway up the two flanges.
 */
const BETWEEN_THE_FLANGES = {
  x: CORNER.x + LATTICE_PITCH / 2,
  y: CORNER.y + LATTICE_PITCH / 2,
  z: CORNER.z + LATTICE_PITCH / 2,
};

/**
 * How far outside the box a model fills the subject's own point may stand.
 *
 * specs/assets.md sizes each model only "about" its figure and says of the part
 * figures that they "are the intent, not a tolerance", so a build is free to
 * sculpt a block a little short of the point it is drawn around. A quarter of a
 * unit is two voxels at `VOXELS_PER_UNIT` (`8`) — the smallest step the sculpting
 * grid has any business being off by — and is far short of `LATTICE_PITCH` (`2`),
 * so a model drawn at the neighbouring node does not answer.
 */
const SLACK = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ring from the committed ring model", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
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

  const covering = placed
    .map((one) => drawnModelBox(one))
    .filter((box) => box !== null)
    .filter(
      (box) =>
        BETWEEN_THE_FLANGES.x >= box.min.x - SLACK &&
        BETWEEN_THE_FLANGES.x <= box.max.x + SLACK &&
        BETWEEN_THE_FLANGES.y >= box.min.y - SLACK &&
        BETWEEN_THE_FLANGES.y <= box.max.y + SLACK &&
        BETWEEN_THE_FLANGES.z >= box.min.z - SLACK &&
        BETWEEN_THE_FLANGES.z <= box.max.z + SLACK,
    );
  assertGreaterThan(
    covering.length,
    0,
    "a placement of the committed model standing over the slew axis between the ring's two flanges, " +
      `(${BETWEEN_THE_FLANGES.x.toFixed(2)}, ${BETWEEN_THE_FLANGES.y.toFixed(2)}, ` +
      `${BETWEEN_THE_FLANGES.z.toFixed(2)}): "The game draws each model wherever its ` +
      'subject is" (specs/assets.md). It is drawn at ' +
      JSON.stringify(placed.map((one) => drawnModelBox(one)?.centre)),
  );

  await h.capture("ring", "The ring drawn from its produced model");
});
