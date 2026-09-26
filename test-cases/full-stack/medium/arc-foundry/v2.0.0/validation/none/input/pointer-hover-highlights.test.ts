// input/pointer-hover-highlights — the highlight follows the pointer across a menu.
//
// THE REQUIREMENT. `specs/controls.md`'s pointer table: "Move over a menu entry's
// reported hit region | Moves the menu highlight to that entry, so the highlight
// follows the pointer as it crosses the menu." `specs/ui.md` says the same from the
// menu's side: "A pointer moved onto an entry's region | The highlight moves to
// that entry." A bare MOVE is the whole of the act — nothing is pressed — which is
// what makes this its own point rather than half of the press that takes an entry.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms. Its entries come back
// from `menuButtons`, and the pointer is moved onto the centre of the rectangle the
// BUILD reported for an entry that is not the one already highlighted. `menuIndex`
// is read back and held against that entry's place in the reported order, so a
// build that draws its menu anywhere and reports it honestly passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  hoverControl,
  openMenu,
} from "../harness";

/** The entry the pointer is moved onto: not the one a fresh menu opens on. */
const ENTRY = "map-switchyard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight to the entry the pointer moved onto", async () => {
  await h.debug.reset();
  const entries = await openMenu(h, "mapselect");
  const at = entries.findIndex((entry) => entry.action === ENTRY);
  assertGreaterThan(
    at,
    0,
    `menuButtons() to carry \`${ENTRY}\` past the entry a fresh menu opens on, ` +
      "so moving onto it is a change (specs/instrumentation.md, specs/ui.md)",
  );
  assertEqual(
    (await h.snapshot()).menuIndex,
    0,
    "the entry a menu reached other than by returning to it opens on " +
      "(specs/ui.md)",
  );

  await hoverControl(h, entries[at]!);
  await captureStill(h, "hover");

  assertEqual(
    (await h.snapshot()).menuIndex,
    at,
    `moving the pointer onto the reported \`${ENTRY}\` rectangle to move the ` +
      "highlight to that entry (specs/controls.md, specs/ui.md)",
  );
});
