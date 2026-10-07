// nodes/segment-charges-nothing — a worm turned by a segment charges nothing.
//
// specs/nodes.md: "A worm turned by the side edge of the board or by a worm
// segment changes no node's charge." specs/worm.md makes "a tile holding a worm
// segment, of this worm or of any other" a block in its own right, and this point
// reads that such a block leaves the field exactly as it stood.
//
// WHAT MAKES THIS SENSITIVE. The blocking tile holds NO node — a tile carrying
// both a node and a segment is blocked by both at once, and specs/nodes.md does
// not say which of the two a build should credit, so posing one there would grade
// an ambiguity rather than the rule. What is read instead is that no node
// APPEARS on that tile and no charge moves anywhere: a build whose block path
// runs `bump(target)` through an operation that creates a node where none stood
// lays a charge-1 node on the blocker's tile, and a build that reverses the
// heading before charging lifts the node posed BEHIND the head. Nodes at three
// further charges stand away from the scenario as witnesses, `2` among them
// because it is the value from which charged, cleared, replaced and de-energized
// all read back differently.
//
// THE BLOCKER IS AN OBSTACLE AND NOTHING ELSE. It is posed with its step faculty
// off (specs/instrumentation.md's `setWormStepping`), so it holds its tile for
// the whole drive and cannot wander into the reading; both worms are a head
// alone, so no body follow is in it either. The tile the turn drops the moving
// head into is left empty, since what a drop does to a node under it is
// nodes/drop-leaves-charge's requirement.
//
// NO TOLERANCE APPLIES: the field is compared node for node, charge for charge.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { CHARGE_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  driveSteps,
  poseNodes,
  poseWorm,
  startPlaying,
  type Harness,
  type NodeView,
  type WirewormSnapshot,
} from "../harness";

/** The moving worm's head, above the player band. */
const HEAD = { c: 10, r: 8 } as const;

/** The blocking worm's one segment, on the tile the head's step is aimed at. */
const BLOCKER = { c: HEAD.c + 1, r: HEAD.r } as const;

/**
 * The field the turn must leave alone.
 *
 * `(9, 8)` is the tile the head's REVERSED heading points at; the rest are
 * witnesses far from the scenario. Neither the blocker's tile nor the tile the
 * turn drops the head into carries a node.
 */
const FIELD: readonly (readonly [number, number, number])[] = [
  [HEAD.c - 1, HEAD.r, 2],
  [25, 14, CHARGE_MAX],
  [4, 5, 1],
  [31, 3, 0],
];

/** The drive: exactly the one step the segment turns the worm on. */
const STEPS = 1;

/** The field as a stable list, so two readings compare by content alone. */
function field(snapshot: WirewormSnapshot): NodeView[] {
  return [...snapshot.nodes].sort((a, b) => a.r - b.r || a.c - b.c);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every node's charge alone when another worm's segment turns the worm", async () => {
  await startPlaying(h);
  await poseNodes(h, FIELD);
  await poseWorm(h, {
    c: BLOCKER.c,
    r: BLOCKER.r,
    length: 1,
    dh: 1,
    dv: 1,
    stepping: false,
  });
  await poseWorm(h, { c: HEAD.c, r: HEAD.r, length: 1, dh: 1, dv: 1 });
  const before = field(await h.snapshot());

  await driveSteps(h, STEPS);
  await captureStill(h, "segment");

  assertDeepEqual(
    field(await h.snapshot()),
    before,
    "the node field after a segment turned the worm",
  );
});
