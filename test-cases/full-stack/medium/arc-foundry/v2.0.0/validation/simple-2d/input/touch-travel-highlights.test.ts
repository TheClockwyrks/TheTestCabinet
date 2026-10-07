// input/touch-travel-highlights — a contact travelling onto an entry highlights it.
//
// THE REQUIREMENT. `specs/controls.md`'s touch table gives a contact that "travels
// onto one" the same effect as one that lands on it, and
// `specs/instrumentation.md` says which positions carry it: "`touchMove(x, y)` |
// Moves the contact that is down to a logical position, as a finger traveling
// across the stage does." So a player who put a finger down away from the menu and
// slid it onto an entry has highlighted that entry, without lifting.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms. A contact is landed at
// a point the build reported no rectangle over — searched for over the stage rather
// than named here — and then travelled onto the centre of a reported entry and left
// down. `menuIndex` is read back against that entry's place in the reported order,
// so what is decided is the TRAVEL alone: the landing was over nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  controlCenter,
  createHarness,
  type Harness,
  openMenu,
  pointOutside,
  touchOnto,
} from "../harness";

/** The entry the contact travels onto: not the one a fresh menu opens on. */
const ENTRY = "map-switchyard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the highlight to the entry a contact travelled onto", async () => {
  h.debug.reset();
  const entries = openMenu(h, "mapselect");
  const at = entries.findIndex((entry) => entry.action === ENTRY);
  assertGreaterThan(
    at,
    0,
    `menuButtons() to carry \`${ENTRY}\` past the entry a fresh menu opens on, ` +
      "so travelling onto it is a change (specs/instrumentation.md, specs/ui.md)",
  );

  await touchOnto(h, pointOutside(entries), controlCenter(entries[at]!));
  captureStill(h, "travel");

  assertEqual(
    h.snapshot().menuIndex,
    at,
    `travelling a contact onto the reported \`${ENTRY}\` rectangle to move the ` +
      "highlight to that entry (specs/controls.md, specs/ui.md)",
  );
});
