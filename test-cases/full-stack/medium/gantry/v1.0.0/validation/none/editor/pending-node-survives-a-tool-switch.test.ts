// editor/pending-node-survives-a-tool-switch — a held node outlives every tool
// switch.
//
// `specs/controls.md` § The build tools: "A pending node belongs to the placement
// rather than the tool, so it survives every tool switch. The ring, counterweight,
// and delete tools neither read it nor clear it", and the sentence that closes the
// section names the whole of what does clear it — "Placing the member, a click on
// the pending node itself, `back` on the build screen, and opening a site" — with
// no tool among them.
//
// EVERY SWITCH, because the requirement is stated over every one of them: the tool
// moves through all six of `specs/controls.md`'s tools and the node is read after
// each. The three that "neither read it nor clear it" are the ones a build is
// most likely to have clearing it, and the three placement tools are the ones a
// build is most likely to reset the placement on, so nothing is left out.
//
// The tool starts on `strut` (`specs/instrumentation.md`: a `reset` leaves "the
// strut tool"), so the walk begins at `cable` and comes back round to `strut`,
// which makes every step of it a genuine switch.
//
// The world is emptied first so no structure is in the way, and `(0, 0, 0)` is a
// ground anchor of site 0, inside its envelope.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Tool,
  type Vec3,
} from "../harness";

/** The node held pending across the walk: a ground anchor of site 0. */
const NODE: Vec3 = { x: 0, y: 0, z: 0 };

/** Every tool, walked from the one a reset leaves and back round to it. */
const WALK: readonly Tool[] = [
  "cable",
  "rail",
  "ring",
  "counterweight",
  "delete",
  "strut",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the pending node through a switch to every tool", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  const posed = await h.snapshot();
  assertNotNull(
    posed.pendingNode,
    `the pending node at (${NODE.x}, ${NODE.y}, ${NODE.z}), held before the ` +
      "first switch",
  );

  try {
    for (const tool of WALK) {
      await h.debug.setTool(tool);
      await h.advance(1);
      const s = await h.snapshot();
      assertEqual(s.tool, tool, "the tool selected before this reading");
      assertNotNull(
        s.pendingNode,
        `the pending node after switching to the ${tool} tool ` +
          "(specs/controls.md)",
      );
      assertEqual(
        s.pendingNode?.x,
        NODE.x,
        `the pending node's x under ${tool}`,
      );
      assertEqual(
        s.pendingNode?.y,
        NODE.y,
        `the pending node's y under ${tool}`,
      );
      assertEqual(
        s.pendingNode?.z,
        NODE.z,
        `the pending node's z under ${tool}`,
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture(
      "pending-node-survives-a-tool-switch",
      "The node still held pending after every tool switch",
    );
  }
});
