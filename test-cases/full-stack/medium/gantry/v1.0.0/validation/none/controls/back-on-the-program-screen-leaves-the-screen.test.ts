// controls/back-on-the-program-screen-leaves-the-screen — `back` on the program
// screen leaves for `select`, even with a pending node held.
//
// `specs/controls.md` § The actions resolves `back` "against the first of these
// that applies", and the table's rows are: "The build screen, with a pending node
// held — Clears the pending node and stays on the build screen"; "The run screen,
// with a run in progress — Aborts the run..."; "Anywhere else — Leaves the screen
// for the one `specs/ui.md` gives it". THE FIRST ROW NAMES THE BUILD SCREEN
// ALONE, so on the program screen neither of the first two rows applies and the
// last one decides: `specs/ui.md` § Program gives it — "`back` returns to
// `select`". § The build tools says the same from the pending node's side:
// "`back` on any other screen leaves it held, as the table above states."
//
// SO THE PENDING NODE IS THE POINT. A build that resolves the first row against
// the pending node alone rather than against the build screen carrying one stays
// on the program screen and clears the node, which is exactly what this scenario
// separates from the conforming answer: the node is held, and the screen is the
// one the last row leads to.
//
// The node is posed with `setPendingNode`, which "Holds that lattice node as the
// pending first node of a member placement, as a first click does", rather than
// clicked there: picking is its own review point. `(0, 4, 0)` is a lattice node
// inside site 1's envelope (`x` `-8`..`12`, `y` `0`..`16`, `z` `-8`..`12`), so
// the pose is not refused. The world is emptied first, so nothing else stands
// that a `back` could be resolving against.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { BINDINGS } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** `back`'s binding, as `specs/controls.md` fixes it. */
const BACK = BINDINGS.back[0]!;

/** The lattice node held pending: inside site 1's envelope. */
const NODE = { x: 0, y: 4, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to select from the program screen with a node held pending", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  await h.debug.setScreen("program");
  const posed = await h.snapshot();
  assertEqual(posed.screen, "program", "the screen `back` is pressed on");
  assertNotNull(
    posed.pendingNode,
    `the pending node held at (${NODE.x}, ${NODE.y}, ${NODE.z}) when \`back\` ` +
      "is pressed (specs/instrumentation.md)",
  );

  await h.press(BACK);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).screen,
    "select",
    `the screen after ${BACK} on the program screen: the pending-node row of ` +
      "the `back` table names the build screen alone, so the last row " +
      "decides and the program screen returns to `select` " +
      "(specs/controls.md § The actions, specs/ui.md § Program)",
  );

  await h.capture(
    "state",
    "the select screen back left the program screen for",
  );
});
