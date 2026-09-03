// assets/counterweight-model-at-its-node — a counterweight is drawn at each node
// that carries one, and nowhere else.
//
// specs/assets.md § The models says where each produced model is drawn: "The game
// draws each model wherever its subject is: … a counterweight at each carrying
// node …". specs/structure.md says what a carrying node is — a counterweight is
// "placed on any node the structure uses, a node a member ends at or a flange node
// of the ring" — and that "a node carries at most one counterweight". So a
// structure carrying two of them owes a block at both nodes, and none anywhere
// else in the yard.
//
// TWO NODES RATHER THAN ONE, because one cannot tell a build that draws a block
// at each carrying node from one that draws a single block at some fixed place.
// The two struts stand eight units apart, which is four lattice pitches: far
// enough that no one block could cover both.
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
// THE WORLD IS TWO STRUTS AND TWO BLOCKS: no ring, no rail, no loads, no
// obstacles, no tape, so nothing else in the yard carries a counterweight.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  drawnFromModel,
  drawnModelBox,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The subject's produced model, under the asset root specs/assets.md fixes. */
const MODEL = "models/counterweight.glb";

const SITE = 0;

/** Two struts four lattice pitches apart, each carrying a block at its top. */
const STRUTS: readonly { foot: Vec3; node: Vec3 }[] = [
  { foot: { x: 0, y: 0, z: 0 }, node: { x: 0, y: 2, z: 0 } },
  { foot: { x: 8, y: 0, z: 0 }, node: { x: 8, y: 2, z: 0 } },
];

/**
 * How far outside the box a model fills the point it is drawn at may stand.
 *
 * specs/assets.md sizes each model only "about" its figure and says of the part
 * figures that they "are the intent, not a tolerance", so a build is free to
 * sculpt a block a little short of the point it is drawn around. A quarter of a
 * unit is two voxels at `VOXELS_PER_UNIT` (`8`), and far short of
 * `LATTICE_PITCH` (`2`), so a model drawn at the neighbouring node does not
 * answer.
 */
const SLACK = 0.25;

/** Whether the box `box` covers the point `at`, within `SLACK`. */
function covers(box: { min: Vec3; max: Vec3 } | null, at: Vec3): boolean {
  return (
    box !== null &&
    at.x >= box.min.x - SLACK &&
    at.x <= box.max.x + SLACK &&
    at.y >= box.min.y - SLACK &&
    at.y <= box.max.y + SLACK &&
    at.z >= box.min.z - SLACK &&
    at.z <= box.max.z + SLACK
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a counterweight at each of the two carrying nodes", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  for (const strut of STRUTS) {
    await h.debug.addMember(
      strut.foot.x,
      strut.foot.y,
      strut.foot.z,
      strut.node.x,
      strut.node.y,
      strut.node.z,
      "strut",
    );
    await h.debug.addCounterweight(strut.node.x, strut.node.y, strut.node.z);
  }
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).structure.counterweights.length,
    STRUTS.length,
    "the counterweights the scenario stands on the structure " +
      "(specs/structure.md)",
  );

  const placed = await drawnFromModel(h, MODEL);
  const boxes = placed.map((one) => drawnModelBox(one));

  for (const strut of STRUTS) {
    assertTrue(
      boxes.some((box) => covers(box, strut.node)),
      `the counterweight model drawn over the carrying node ` +
        `(${strut.node.x}, ${strut.node.y}, ${strut.node.z}): "a ` +
        'counterweight at each carrying node" (specs/assets.md). It is drawn ' +
        `at ${JSON.stringify(boxes.map((box) => box?.centre))}`,
    );
  }

  const stray = boxes.filter(
    (box) => !STRUTS.some((strut) => covers(box, strut.node)),
  );
  assertEqual(
    stray.length,
    0,
    "the counterweight model drawn at the carrying nodes and NOWHERE ELSE " +
      '("a counterweight at each carrying node", specs/assets.md), with a ' +
      "structure that carries one at each of two nodes and at no other: it is " +
      `also drawn at ${JSON.stringify(stray.map((box) => box?.centre))}`,
  );

  await h.capture(
    "counterweights",
    "A counterweight at each of the two carrying nodes",
  );
});
