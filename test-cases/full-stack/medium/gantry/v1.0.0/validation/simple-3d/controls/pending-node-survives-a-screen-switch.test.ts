// controls/pending-node-survives-a-screen-switch — a pending node is still held
// after the program screen has been shown and the build screen come back.
//
// `specs/controls.md` § The build tools: "Placing the member, a click on the
// pending node itself, `back` on the build screen, and opening a site are the
// whole of what clears it; `back` on any other screen leaves it held, as the
// table above states." A screen switch is not one of the four, so the node the
// player picked is still theirs when they come back from the tape.
//
// THE SCREENS ARE SHOWN THROUGH `setScreen` RATHER THAN THE `program` AND `build`
// KEYS. `setScreen` "shows the screen and sets nothing else"
// (`specs/instrumentation.md`), which is exactly the change this item is about,
// and reaching it that way keeps the verdict off the two key actions — a build
// whose `KeyP` is broken fails the `program` key's own item and this one still
// decides whether a screen switch costs the selection.
//
// THE PENDING NODE IS POSED RATHER THAN CLICKED, for the same reason:
// `setPendingNode` "holds that lattice node as the pending first node of a member
// placement, as a first click does". `(0, 0, 0)` is a ground anchor of site 1, on
// the lattice pitch and inside its envelope, so nothing about the node can refuse
// the pose. The world is emptied first, and emptied with the two operations this
// point needs rather than with `clearAll`: emptying the tape would show the
// program screen, and a validator about what a screen switch costs the selection
// must not make an unrelated one of its own on the way in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The node held pending: a ground anchor of site 1. */
const NODE: Vec3 = { x: 0, y: 0, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("still holds the pending node after the program screen and back", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.clearStructure();
  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen the node is held on");
  assertNotNull(
    posed.pendingNode,
    "the pending node setPendingNode holds (specs/instrumentation.md)",
  );

  await h.debug.setScreen("program");
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).screen,
    "program",
    "the screen shown between the two halves of the switch",
  );

  await h.debug.setScreen("build");
  await h.advance(1);

  const s = await h.snapshot();
  assertEqual(s.screen, "build", "the screen the switch came back to");
  assertNotNull(
    s.pendingNode,
    "the pending node after a switch to the program screen and back, which " +
      "is not among the four things that clear it (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.pendingNode),
    JSON.stringify(NODE),
    "the node still held pending",
  );

  await h.capture(
    "state",
    "The build screen with the pending node still held after the switch",
  );
});
