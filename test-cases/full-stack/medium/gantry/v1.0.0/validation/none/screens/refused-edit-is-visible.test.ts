// screens/refused-edit-is-visible — a refused edit shows in the moment it is
// refused.
//
// `specs/ui.md` § Build: "A REFUSED EDIT IS VISIBLE IN THE MOMENT IT IS REFUSED,
// in whatever form suits the look, so a player is never left wondering why a
// click did nothing."
//
// THE FORM IS DELIBERATELY THE BUILD'S — a line of text, a flash on the node, a
// mark under the pointer — so nothing here may ask for one. What the requirement
// fixes is that SOMETHING is different, and `drawn()` is the account of what the
// frame put on screen, so the reading is that the account changed.
//
// THE MOMENT IS THE POINTER'S, NOT THE CLICK'S. A build is free to say why a
// click will do nothing BEFORE it is made as well as after — the refusal is a
// fact about the edit under the pointer, and showing it early is showing it. So
// what is compared is the screen over a node where the edit would be refused
// against the screen over the same node where it would be taken, which isolates
// the refusal from everything else about the moment.
//
// THE CLICK IS STILL MADE, and the structure must come through it untouched: a
// screen that says "refused" and then takes the edit anyway has said nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  nodePoint,
  openSite,
  type Harness,
} from "../harness";

/** The node the pointer rests on, well clear of the ring already placed. */
const NODE = { x: 6, y: 2, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows something different where an edit would be refused", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");

  // A SECOND RING IS REFUSED OUTRIGHT (`specs/structure.md`), and a strut from
  // the same node is not. So the pointer is put on ONE node and the tool is
  // changed under it: everything about the moment is identical except whether
  // the edit the player is about to make would be taken.
  await h.debug.setRing(0, 2, 0);
  const at = await nodePoint(h, NODE);
  assertTrue(
    at.visible,
    "the node to be drawn on the stage, so the pointer can reach it",
  );

  await h.debug.setTool("strut");
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const accepted = JSON.stringify(await h.drawn());

  await h.debug.setTool("ring");
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const refused = JSON.stringify(await h.drawn());

  const before = await h.snapshot();
  await h.click(at.x, at.y);
  const after = await h.snapshot();

  await h.capture("refusal", "The build screen where an edit would be refused");

  assertEqual(
    JSON.stringify(after.structure),
    JSON.stringify(before.structure),
    "the structure across the refused click, which nothing may change " +
      "(specs/structure.md)",
  );
  assertTrue(
    refused !== accepted,
    "the screen to show something over a node where the edit would be refused " +
      "that it does not show where the same click would be taken " +
      "(specs/ui.md: a refused edit is visible in the moment it is refused)",
  );
});
