// assets/hook-model-at-the-bob — the hook block is drawn where the bob is, so it
// goes where the bob goes.
//
// specs/assets.md § The models says where the model goes: "The game draws each
// model wherever its subject is: … the hook at the bob turned to the grip's yaw
// …". specs/state.md gives the bob as the run's own reading, `run.bob.pos`, and
// specs/rigging.md hangs it from the trolley on the hoist cable, so the block's
// place is wherever the build says its bob currently is.
//
// TWO PLACES, because one cannot tell a block drawn at the bob from a block drawn
// at the trolley, at the track's origin, or at any other point that happens to
// coincide with the bob in a single pose. The first is the bob hanging straight
// under the carriage part-way along the track; the second is the bob swung out
// from a carriage at the far end, so it shares neither its position, its point on
// the track, nor the vertical under either of them.
//
// EACH POSE IS SETTLED BEFORE IT IS READ. `setBob` places the bob and `setAxis`
// sets the hoist to exactly the pivot-to-bob distance, so the cable is already
// satisfied and the frame that draws it moves nothing; the box is then read
// against the bob the run itself reports, not against the figure this file asked
// for.
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
// THE WORLD IS THE CRANE ALONE: no loads, no obstacles, and a tape of one grip
// move, the only axis whose motion "applies no force to anything".

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
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

/**
 * The two poses: a carriage part-way along the track with the bob hanging
 * straight under it, and the carriage at the far end with the bob swung out
 * thirty degrees, at the same cable length either way.
 */
const CABLE = 3;
const POSES: readonly { name: string; trolley: number; bob: Vec3 }[] = [
  { name: "hanging under the carriage", trolley: 2, bob: { x: 2, y: 1, z: 0 } },
  {
    name: "swung out from the carriage",
    trolley: 4,
    bob: {
      x: 4 + CABLE * Math.sin(Math.PI / 6),
      y: 4 - CABLE * Math.cos(Math.PI / 6),
      z: 0,
    },
  },
];

/**
 * How far outside the box a model fills the point it is drawn at may stand.
 *
 * specs/assets.md sizes each model only "about" its figure and says of the part
 * figures that they "are the intent, not a tolerance", so a build is free to
 * sculpt a block a little short of the point it is drawn around. A quarter of a
 * unit is two voxels at `VOXELS_PER_UNIT` (`8`), and far short of
 * `LATTICE_PITCH` (`2`), so a model drawn at the neighboring node does not
 * answer.
 */
const SLACK = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the hook at the bob, wherever the bob stands", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);

  for (const pose of POSES) {
    await h.debug.setAxis("trolley", pose.trolley);
    await h.debug.setBob(pose.bob.x, pose.bob.y, pose.bob.z);
    await h.debug.setBobVelocity(0, 0, 0);
    await h.debug.setAxis(
      "hoist",
      distance3((await h.snapshot()).run.pivot, pose.bob),
    );
    await h.advance(1);

    // The bob the run reports, rather than the figure this file asked for.
    const at = (await h.snapshot()).run.bob.pos;
    const boxes = (await drawnFromModel(h, MODEL)).map((one) =>
      drawnModelBox(one),
    );
    assertTrue(
      boxes.some(
        (box) =>
          box !== null &&
          at.x >= box.min.x - SLACK &&
          at.x <= box.max.x + SLACK &&
          at.y >= box.min.y - SLACK &&
          at.y <= box.max.y + SLACK &&
          at.z >= box.min.z - SLACK &&
          at.z <= box.max.z + SLACK,
      ),
      `the hook model drawn over the bob with the bob ${pose.name}, at ` +
        `(${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}): "the ` +
        'hook at the bob" (specs/assets.md). It is drawn at ' +
        JSON.stringify(boxes.map((box) => box?.centre)),
    );
  }

  await h.capture("hook", "The hook at the bob");
});
