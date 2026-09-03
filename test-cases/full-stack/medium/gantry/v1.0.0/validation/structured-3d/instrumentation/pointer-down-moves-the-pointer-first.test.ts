// instrumentation/pointer-down-moves-the-pointer-first — a posed press moves the
// pointer to its own position before pressing.
//
// `specs/instrumentation.md` § Input: "`pointerDown(x, y)` | A press at a
// logical stage position. It moves the pointer there first, so a press needs no
// `pointerMove` before it." That is what makes a press self-contained, and the
// consequence the requirement names is what the press PICKS: the pick is
// "decided by the pick radii and the tie-breaks `specs/controls.md` fixes" from
// "the pointer's current position" (§ Snapshot shape), so a press that had not
// moved the pointer would pick at wherever the pointer was left.
//
// SO THE POINTER IS LEFT SOMEWHERE ELSE FIRST. The check moves it to a corner of
// the stage, far from the point it then presses at, and presses without a
// `pointerMove` in between. What it reads back is the pointer's own position,
// the position the live press went down at — "A press writes the position it
// went down at, and a release leaves it" (§ The run and the screens) — and the
// node the click took.
//
// THE NODE IS A LATTICE NODE OF THE OPEN SITE, PICKED WHERE THE BUILD DRAWS IT.
// "A node pick considers every lattice node in the envelope that stands in front
// of the camera" (`specs/controls.md`), so an empty structure has nodes to pick,
// and `project` is what answers where one is drawn: "a press and release at a
// visible node's projected point picks that node"
// (`specs/instrumentation.md` § Readings). The strut tool is selected because
// its first click is the one that holds a node pending — "the first click picks
// a node and holds it pending" (`specs/controls.md`) — which is how the pick a
// press took is read back off the snapshot.
//
// The world is emptied whole, so nothing but the site's own lattice is there to
// pick and no member can come between the camera and the node.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertClose,
  assertEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import { CLICK_SLOP } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The lattice node pressed: on the pitch, inside site 0's envelope. */
const NODE = { x: 0, y: 4, z: 0 };

/** Where the pointer is parked first: a corner of the stage. */
const PARKED = { x: 12, y: 12 };

/**
 * A build is free to keep the pointer at whole logical pixels: `specs/state.md`
 * fixes the units the position is in and not its precision.
 */
const TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("presses at its own position, picking what is drawn there", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.setTool("strut");

  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the lattice node (${NODE.x}, ${NODE.y}, ${NODE.z}) is drawn on the stage`,
  );
  assertGreaterThan(
    Math.hypot(at.x - PARKED.x, at.y - PARKED.y),
    CLICK_SLOP,
    "the distance between where the pointer is parked and where it is " +
      "pressed, so a press taken at the parked position would be caught",
  );

  // Parked, and READ, so the pointer has genuinely been left elsewhere: every
  // update reads the pointer's current position into the state.
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);
  assertClose(
    (await h.snapshot()).pointer.x,
    PARKED.x,
    TOLERANCE,
    "where the pointer stands before the press, with no pointerMove after it",
  );

  await h.click(at.x, at.y);
  const s = await h.snapshot();

  await h.capture("pressed", "The node a press with no move before it took");

  assertClose(
    s.pointer.x,
    at.x,
    TOLERANCE,
    "pointer.x after a pointerDown that moved the pointer there first " +
      "(specs/instrumentation.md)",
  );
  assertClose(
    s.pointer.y,
    at.y,
    TOLERANCE,
    "pointer.y after a pointerDown that moved the pointer there first " +
      "(specs/instrumentation.md)",
  );
  assertClose(
    s.pointer.pressX,
    at.x,
    TOLERANCE,
    "pointer.pressX: the position the press went down at " +
      "(specs/instrumentation.md)",
  );
  assertClose(
    s.pointer.pressY,
    at.y,
    TOLERANCE,
    "pointer.pressY: the position the press went down at " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(s.pendingNode),
    JSON.stringify(NODE),
    "the node the press picked, which is the pick at its own position " +
      "(specs/instrumentation.md)",
  );
});
