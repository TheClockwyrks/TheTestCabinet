// editor/an-illegal-move-leaves-the-part-in-place — a move whose result the
// placement rules refuse leaves the part at the anchor it stood on.
//
// THE RULE. "Releasing on the starting hex commits no move; releasing elsewhere
// moves the part by the offset WHEN THE RESULT IS LEGAL, AND LEAVES IT IN PLACE
// WHEN IT IS NOT" (`specs/editor.md`, Dragging). "An edit changes the edited part
// alone" is the same file's next rule, so the refusal reaches no other part
// either.
//
// THE CONFIGURATION. `BARE` opened in the editor with TWO arms, on `WEST` and on
// `ORIGIN`, put there through the surface. The gesture presses `ORIGIN` and
// releases on `WEST`: an offset of three hexes west, whose result would put two
// arms on one anchor. That breaks placement rule 4 — "No two arms or wheels share
// an anchor hex" — and only that rule: both hexes are on the field, no footprint
// and no track is anywhere near them, and no rise or set is placed. The placement
// oracle names rule 4 before the gesture, so what refuses the move is
// `specs/parts.md` rather than the build's opinion.
//
// THE VERDICT. The dragged arm is still anchored on `ORIGIN`, and the arm on
// `WEST` is where it was.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { armPart } from "../formats";
import { BARE, ORIGIN, WEST } from "../fixtures";
import { placementFault } from "../parts";
import {
  captureStill,
  createHarness,
  dragHex,
  openChallengeDocument,
  partById,
  placePart,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the dragged part on its own anchor and touches no other", async () => {
  const onWest = armPart("arm", WEST.q, WEST.r, 0, 1, []);
  assertEqual(
    placementFault([onWest, onWest], {
      reagents: BARE.reagents,
      products: BARE.products,
    })?.rule,
    4,
    "two arms on WEST's anchor break placement rule 4 and nothing else",
  );

  await openChallengeDocument(h, BARE);
  const resting = await placePart(h, "arm", WEST);
  const dragged = await placePart(h, "arm", ORIGIN);

  await dragHex(h, ORIGIN, WEST);
  await h.advance(1);
  await captureStill(h, "refused");

  const snapshot = await h.snapshot();
  assertEqual(
    `${partById(snapshot, dragged)?.q},${partById(snapshot, dragged)?.r}`,
    `${ORIGIN.q},${ORIGIN.r}`,
    "the move whose result rule 4 refuses left the dragged arm on its own anchor",
  );
  assertEqual(
    `${partById(snapshot, resting)?.q},${partById(snapshot, resting)?.r}`,
    `${WEST.q},${WEST.r}`,
    "and the arm the drag was released over is where it stood: an edit changes the edited part alone",
  );
});
