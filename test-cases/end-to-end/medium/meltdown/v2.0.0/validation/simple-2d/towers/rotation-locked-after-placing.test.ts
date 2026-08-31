// Meltdown — towers/rotation-locked-after-placing: orientation is fixed at the
// moment of placement.
//
// THE RULE. specs/towers.md: a tower's placement rotation is "chosen while the
// tower is held and fixed the moment it is placed". specs/building.md says it
// twice over: "A tower's orientation is fixed at the moment it is placed: a placed
// tower's rotation and its world radiator faces never change again", and placement
// "stays armed afterward, at the same type and the same rotation, so a second copy
// drops without arming again". specs/instrumentation.md closes the door from the
// other side: "There is no operation that rotates a placed tower."
//
// THE DEFECT THIS NAMES. A build that keeps ONE rotation — the armed one — and
// draws every standing tower from it turns a whole floor of towers every time the
// player presses the rotate key. That build places correctly, reports correctly
// the instant it places, and is wrong from the next press onward, so the reading
// has to be taken AFTER a turn rather than at the moment of placing.
//
// A STUTTER, BECAUSE ITS FACES ARE ASYMMETRIC. Its local radiators are N and E, so
// each of the four rotations names a different pair of world faces and a leak from
// the held rotation into the placed tower shows up whichever way it leaked. It is
// placed at rotation `1`, so its world faces are E and S; the preview is then
// turned to `2`, `3` and `0` in turn, each of which would give a different pair.
// An Arc, whose N-and-S pair a half turn maps onto itself, would miss a leak of
// two steps entirely.
//
// THE TURN IS DRIVEN THROUGH THE ROTATE KEY, which is how a player turns a held
// preview (specs/controls.md), and the placed tower is read after each press
// rather than only after the last, so the failure names the press that moved it.
// A frame runs between the press and the reading, so a build that redraws or
// recomputes its towers inside its own update is read after that update.
//
// THE HELD PREVIEW IS READ TOO, in the same breath. The rule has two halves — the
// placed tower must not move AND the preview must — and a build that answered by
// refusing to turn anything at all would satisfy the first half alone. Reading
// both means the check passes only for a build that turns the one and holds the
// other.
//
// THE FACES ARE COMPARED AS A SET, sorted before the comparison: nothing in the
// specification fixes the ORDER `radiatorFaces` lists them in.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import {
  costOf,
  freeSite,
  heldPreview,
  placeAt,
  requirePlaced,
  sortedFaces,
} from "./roster";

/** The tower placed. Its local radiators are N and E: an asymmetric pair. */
const TOWER = "stutter";

/** The rotation it is placed at, and the world faces that rotation gives it. */
const PLACED_AT = 1;
const PLACED_FACES = ["E", "S"];

/** The presses the held preview is turned by afterwards: a full cycle. */
const PRESSES = [1, 2, 3, 4];

/** The key specs/controls.md binds `rotate` to, and the only one. */
const ROTATE_KEY = BINDINGS.rotate[0];

/** Money far above two Stutters, so no placement is refused for the purse. */
const PURSE = 100 * costOf(TOWER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Orientation is fixed at placement", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  const at = freeSite(0);
  const id = requirePlaced(
    placeAt(h, TOWER, at.col, at.row, PLACED_AT),
    `placing a ${TOWER} at rotation ${PLACED_AT}`,
  );

  // The preview left armed by the placement is moved off the tower it just
  // built, so nothing that follows turns a preview standing on its own footprint.
  const spare = freeSite(1);
  h.debug.setPreview(spare.col, spare.row);
  await h.advance(1);

  const placed = towerOf(h.snapshot(), id);
  assertEqual(
    placed.rotation,
    PLACED_AT,
    `the rotation the ${TOWER} reports the moment it was placed`,
  );
  assertDeepEqual(
    sortedFaces(placed.radiatorFaces),
    PLACED_FACES,
    `the world radiator faces of a ${TOWER} placed at rotation ${PLACED_AT}, ` +
      `whose local radiators are N and E`,
  );

  for (const press of PRESSES) {
    await h.tap(ROTATE_KEY);
    await h.advance(1);
    captureStill(h, "locked");

    const held = heldPreview(h, `after ${press} press(es) of ${ROTATE_KEY}`);
    assertEqual(
      held.rotation,
      (PLACED_AT + press) % 4,
      `the HELD rotation after ${press} press(es) of ${ROTATE_KEY}, which the ` +
        `same rule requires to turn (specs/building.md, Rotating the preview)`,
    );

    const after = towerOf(h.snapshot(), id);
    assertEqual(
      after.rotation,
      PLACED_AT,
      `the placed ${TOWER}'s rotation after ${press} press(es) of ` +
        `${ROTATE_KEY} turned the held preview to ${(PLACED_AT + press) % 4} ` +
        `(specs/building.md, Rotating the preview)`,
    );
    assertDeepEqual(
      sortedFaces(after.radiatorFaces),
      PLACED_FACES,
      `the placed ${TOWER}'s world radiator faces after ${press} press(es) ` +
        `of ${ROTATE_KEY}`,
    );
  }
});
