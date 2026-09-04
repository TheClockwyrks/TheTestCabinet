// input/touch-landing-highlights — a contact landing on an entry highlights it.
//
// THE REQUIREMENT. `specs/controls.md`'s touch table: "A contact lands inside a menu
// entry's reported hit region, or travels onto one | Moves the menu highlight to
// that entry." `specs/ui.md` says the same: "A touch contact landing inside an
// entry's region, or traveling onto one | The highlight moves to that entry." A
// finger has no hover, so the landing is the only way a contact reaches an entry
// without having travelled, which is why it is decided apart from the travel.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms. A contact is LANDED at
// the centre of the rectangle the build reported for an entry that is not the one
// already highlighted, and left down, so what is read is the landing's own effect
// and not a lift's. `menuIndex` is read back against that entry's place in the
// reported order.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  controlCenter,
  createHarness,
  type Harness,
  openMenu,
  touchOnto,
} from "../harness";

/** The entry the contact lands on: not the one a fresh menu opens on. */
const ENTRY = "map-switchyard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the highlight to the entry a contact landed inside", async () => {
  h.debug.reset();
  const entries = openMenu(h, "mapselect");
  const at = entries.findIndex((entry) => entry.action === ENTRY);
  assertGreaterThan(
    at,
    0,
    `menuButtons() to carry \`${ENTRY}\` past the entry a fresh menu opens on, ` +
      "so landing on it is a change (specs/instrumentation.md, specs/ui.md)",
  );

  const centre = controlCenter(entries[at]!);
  await touchOnto(h, centre, centre);
  captureStill(h, "landing");

  assertEqual(
    h.snapshot().menuIndex,
    at,
    `landing a contact inside the reported \`${ENTRY}\` rectangle to move the ` +
      "highlight to that entry (specs/controls.md, specs/ui.md)",
  );
});
