// screens/build-draws-the-obstacles — the build screen draws the site's
// obstacles.
//
// `specs/ui.md` § Build lists what the screen shows: "`build` shows the yard
// through the camera: the ground, the lattice and envelope aids, the anchors, THE
// OBSTACLES, the loads at their starting poses, the pads, and the structure as
// built." An obstacle a player cannot see is one they will build into.
//
// TWO OBSTACLES, so a build that draws "an obstacle" rather than each of them is
// caught: what the screen owes is every one the site carries.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  addOneObstacle,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

/** Two boxes, well apart, so each has its own place in the yard. */
const FIRST = { min: { x: 4, y: 0, z: 4 }, size: { x: 2, y: 3, z: 2 } };
const SECOND = { min: { x: -8, y: 0, z: -6 }, size: { x: 3, y: 2, z: 3 } };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each of the site's obstacles on the build screen", async () => {
  await openSite(h, 0);
  await h.debug.setScreen("build");
  await addOneObstacle(h, FIRST.min, FIRST.size);
  await h.debug.addObstacle(
    SECOND.min.x,
    SECOND.min.y,
    SECOND.min.z,
    SECOND.size.x,
    SECOND.size.y,
    SECOND.size.z,
  );
  await h.advance(1);

  const drawn = entriesOf(await h.drawn(), "obstacle");

  await h.capture("obstacle-drawn", "The build screen drawing the obstacles");

  assertEqual(
    drawn.length,
    2,
    "obstacles drawn against the two the site carries (specs/ui.md)",
  );
});
