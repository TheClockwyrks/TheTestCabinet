// assets/hook-drawn-from-a-produced-model — the hook block at the cable's end is
// the committed `hook` model, decoded and drawn.
//
// specs/assets.md § The models: "hook | the hook block at the cable's end", one
// of the eight models the build "produces … commits … and wires in", each
// committed as `assets/models/<model>.glb` under the name that table gives it.
// § What is drawn in code keeps the cable itself, the members and the ground on
// the build's own side of the line; the block at the cable's end is not one of
// them.
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
// THE WORLD IS ONE CRANE, RUNNING, AND NOTHING ELSE — no loads, no obstacles, and
// a tape of one grip move, the only axis whose motion "applies no force to
// anything" (specs/rigging.md). The bob is posed and the hoist set to exactly the
// pivot-to-bob distance, so the cable is already satisfied and the frame that
// draws it moves nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  committedModel,
  createHarness,
  distance3,
  drawnFromModel,
  drawnModelBox,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The subject's produced model, under the asset root specs/assets.md fixes. */
const MODEL = "models/hook.glb";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** Where the carriage stands, and where the bob hangs under it. */
const TROLLEY_AT = 4;
const BOB: Vec3 = { x: 4, y: 1, z: 0 };

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

it("draws the hook from the committed hook model", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.debug.setAxis(
    "hoist",
    distance3((await h.snapshot()).run.pivot, BOB),
  );
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

  // Where the block stands: the bob the run itself reports, rather than the figure
  // this file asked for.
  const bob = (await h.snapshot()).run.bob.pos;
  const covering = placed
    .map((one) => drawnModelBox(one))
    .filter((box) => box !== null)
    .filter(
      (box) =>
        bob.x >= box.min.x - SLACK &&
        bob.x <= box.max.x + SLACK &&
        bob.y >= box.min.y - SLACK &&
        bob.y <= box.max.y + SLACK &&
        bob.z >= box.min.z - SLACK &&
        bob.z <= box.max.z + SLACK,
    );
  assertGreaterThan(
    covering.length,
    0,
    "a placement of the committed model standing over the bob at the cable's end, " +
      `(${bob.x.toFixed(2)}, ${bob.y.toFixed(2)}, ` +
      `${bob.z.toFixed(2)}): "The game draws each model wherever its ` +
      'subject is" (specs/assets.md). It is drawn at ' +
      JSON.stringify(placed.map((one) => drawnModelBox(one)?.centre)),
  );

  await h.capture("hook", "The hook drawn from its produced model");
});
