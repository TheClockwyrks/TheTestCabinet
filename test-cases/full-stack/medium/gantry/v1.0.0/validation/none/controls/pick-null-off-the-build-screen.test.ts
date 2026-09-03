// controls/pick-null-off-the-build-screen — `pick` reads nothing on a screen that
// is not the build screen.
//
// `specs/instrumentation.md` § Snapshot shape, the resting values table: "`pick`
// — `{ node: null, member: null }` on every screen but `build`, and where nothing
// is in range." The rule comes from what picking is for: `specs/controls.md` §
// Clicks and drags says "a click edits the structure ON THE BUILD SCREEN ALONE",
// and § The build tools has the selected tool decide what a click does there.
//
// SO THE POINTER IS PUT SOMEWHERE THAT WOULD PICK, and then the screen is
// changed. `project` answers "the point on the stage the world position is drawn
// at, through the camera as it stands", and § Readings says what that buys: "a
// press and release at a visible node's projected point picks that node". The
// node is `(0, 4, 0)`, a top-flange node of the crane this scenario stands up, so
// the point under the pointer is one the build screen genuinely picks — which is
// read back on the build screen first, because a validator whose pointer was
// nowhere near a candidate would report `null` off the build screen for the wrong
// reason and pass any build at all.
//
// THE PROGRAM SCREEN IS WHERE THE READING IS TAKEN because it is the other screen
// drawing the same yard through the same camera: `specs/ui.md` § Program, "shows
// the same yard and readouts, with the tape editor over it". A build that decides
// `pick` from the projection alone rather than from the screen reports the node
// there, which is exactly what this separates.
//
// The screen is taken with `setScreen`, which "shows a named screen and sets
// nothing else", so the camera and the pointer are the ones the reading was taken
// under. A frame runs after the move, because a build is free to read the pointer
// once a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** A top-flange node of the minimal crane: what the pointer is put over. */
const NODE = { x: 0, y: 4, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads no node and no member on the program screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the node (${NODE.x}, ${NODE.y}, ${NODE.z}) is drawn on the stage, so ` +
      "there is a point to put the pointer on (specs/instrumentation.md)",
  );
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const aimed = await h.snapshot();
  assertEqual(aimed.screen, "build", "the screen the pointer is aimed on");
  assertNotNull(
    aimed.pick.node,
    "the node a click at that point would take on the build screen, so the " +
      "pointer stands somewhere a pick is genuinely in range " +
      "(specs/controls.md § Clicks and drags)",
  );

  await h.debug.setScreen("program");
  await h.pointerMove(at.x, at.y);
  await h.advance(1);

  const { pick } = await h.snapshot();
  assertNull(
    pick.node,
    "pick.node on the program screen, with the pointer on a node's projected " +
      "point: `pick` reads `{ node: null, member: null }` on every screen but " +
      "`build` (specs/instrumentation.md § Snapshot shape)",
  );
  assertNull(
    pick.member,
    "pick.member on the program screen, with the pointer on the crane: " +
      "`pick` reads `{ node: null, member: null }` on every screen but " +
      "`build` (specs/instrumentation.md § Snapshot shape)",
  );

  await h.capture("state", "the program screen with the pointer over a node");
});
