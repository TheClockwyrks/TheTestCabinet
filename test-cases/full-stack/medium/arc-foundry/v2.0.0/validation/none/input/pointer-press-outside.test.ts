// input/pointer-press-outside — a release outside every entry takes none.
//
// THE REQUIREMENT. `specs/ui.md`: "An entry is taken only when both edges of the
// gesture fall inside one entry's region ... an edge outside every region takes
// none." A player who presses an entry and slides off the menu entirely has
// changed their mind, and the build owes them the same nothing as sliding onto a
// neighbour does.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms. The pointer is pressed
// at the centre of a reported rectangle and released at a point the build reported
// no rectangle over — searched for over the stage rather than named here, so a
// build that draws its menu anywhere still has the point decided against its own
// layout. The screen is read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  controlCenter,
  createHarness,
  type Harness,
  openMenu,
  pointOutside,
  pointerDrag,
} from "../harness";

/** The entry the press lands in. */
const PRESSED = "map-switchyard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes no entry when the release falls outside every entry", async () => {
  await h.debug.reset();
  const entries = await openMenu(h, "mapselect");
  const pressed = entries.find((entry) => entry.action === PRESSED)!;

  await pointerDrag(h, controlCenter(pressed), pointOutside(entries));
  await captureStill(h, "outside");

  assertEqual(
    (await h.snapshot()).screen,
    "mapselect",
    `pressing inside the reported \`${PRESSED}\` rectangle and releasing outside ` +
      "every reported rectangle to take no entry, so the map select is still " +
      "showing (specs/ui.md)",
  );
});
