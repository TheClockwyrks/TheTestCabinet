// nodes/field-persists — the field carries into the next level.
//
// specs/nodes.md, under "The field persists": "The field is laid once, when a run
// starts, and it stands from there. Clearing a level does not reset it. The nodes
// standing when a level clears are the nodes standing when the next level's play
// begins, at the charges they held." specs/progression.md says the same from the
// run's side: on a clear, "Every foe and every bolt in flight is removed. The node
// field stands exactly as it was, at the charges they held."
//
// THE FIELD IS POSED AT ALL FOUR CHARGES. A field of one charge would let a build
// that re-lays a fresh inert scatter pass whenever it happened to lay a node on
// the same tile; four distinct charges on four scattered tiles mean a re-scatter,
// a reset to inert, or a clear all read back as a different field.
//
// THE CLEAR IS REACHED THE WAY THE RULE DEFINES IT. specs/progression.md clears a
// level "on the step in which the last of its worm segments is removed", so the
// board is posed with exactly one segment, held still by the step faculty being
// off, and a bolt removes it. The tile that segment died on is left OUT of the
// comparison: the fresh inert node a shot-killed segment lays there is
// nodes/shot-leaves-node's requirement, and folding it in would grade that rule
// twice.
//
// The worm entry gate stays shut for the whole check (specs/instrumentation.md's
// `setWormEntry`, shut by the harness's `startPlaying`), so the next level's worm
// never arrives to bump a node while the reading is being taken, and the foe
// spawning gate stays shut so no dropper lays one.
//
// NO TOLERANCE APPLIES: the field is compared node for node, charge for charge.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BANNER_TIME, CHARGE_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  poseNodes,
  poseWorm,
  shootTile,
  startPlaying,
  type Harness,
  type NodeView,
  type WirewormSnapshot,
} from "../harness";

/** The level the run is posed on, so the clear advances to the next one. */
const LEVEL = 1;

/** The field the clear must carry: one tile at each of the four charges. */
const FIELD: readonly (readonly [number, number, number])[] = [
  [3, 3, 0],
  [8, 5, 1],
  [20, 12, 2],
  [33, 7, CHARGE_MAX],
];

/** The level's one segment, whose removal is what clears the level. */
const SEGMENT = { c: 12, r: 10 } as const;

/** How long the next level's banner is waited out for, with room to spare. */
const OPEN_FRAMES = framesFor(BANNER_TIME + 1);

/**
 * The field as a stable list, with the tile the killed segment stood on left
 * out: the node laid there is nodes/shot-leaves-node's requirement.
 */
function carried(snapshot: WirewormSnapshot): NodeView[] {
  return snapshot.nodes
    .filter((node) => !(node.c === SEGMENT.c && node.r === SEGMENT.r))
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the next level on the field the cleared level left standing", async () => {
  await startPlaying(h, { level: LEVEL });
  await poseNodes(h, FIELD);
  await poseWorm(h, {
    c: SEGMENT.c,
    r: SEGMENT.r,
    length: 1,
    dh: 1,
    dv: 1,
    stepping: false,
  });
  const before = carried(await h.snapshot());
  assertEqual(
    before.length,
    FIELD.length,
    "the field as posed, before the clear",
  );

  await shootTile(h, SEGMENT.c, SEGMENT.r);
  const opened = await h.until(
    (snapshot) => snapshot.level === LEVEL + 1 && snapshot.phase === "active",
    { maxFrames: OPEN_FRAMES, poll: 1 },
  );
  await captureStill(h, "carried");

  assertEqual(
    opened.hit,
    true,
    `level ${LEVEL + 1} reaching live play, which is the scenario this point needs`,
  );
  assertDeepEqual(
    carried(opened.snapshot),
    before,
    `the node field as level ${LEVEL + 1} opens`,
  );
});
