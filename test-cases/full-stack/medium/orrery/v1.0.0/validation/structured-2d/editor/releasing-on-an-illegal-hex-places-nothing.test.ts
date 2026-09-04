// editor/releasing-on-an-illegal-hex-places-nothing — a place drag released over a
// hex the placement rules refuse adds nothing to the machine.
//
// THE RULE. "From the tray: ... Releasing on a legal hex places it and selects it;
// RELEASING ANYWHERE ELSE PLACES NOTHING" (`specs/editor.md`, Dragging). What
// "legal" means is `specs/parts.md`'s six placement rules, which the same file
// defers to: "a ghost of the part is drawn at the targeted hex, visibly legal or
// illegal under the placement rules". And "A drag ends at its release", so the
// gesture leaves no drag behind either.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm already anchored on
// `ORIGIN`, put there through the surface — "None pushes an undo entry"
// (`specs/instrumentation.md`), so the machine's history is empty and the standing
// arm is simply where the scenario needs it. The drag then takes tray entry `0`,
// which is `arm`, onto `ORIGIN` itself and releases there. That target breaks
// placement rule 4 — "No two arms or wheels share an anchor hex" — and nothing
// else: the hex is on the field, no footprint and no track is anywhere near it,
// and no rise or set is placed. The placement oracle names that rule before the
// gesture, so what makes the hex illegal is `specs/parts.md` rather than the
// build's opinion.
//
// THE VERDICT. `editor.parts` is exactly the list it was — the one standing arm,
// still on `ORIGIN`, still at its pose — and `editor.drag` is `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { armPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { placementFault } from "../parts";
import {
  captureStill,
  createHarness,
  dragFromTray,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
  type Harness,
} from "../harness";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const ARM_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the machine as it was and ends the drag", async () => {
  const arm = armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []);
  assertEqual(
    placementFault([arm, arm], {
      reagents: BARE.reagents,
      products: BARE.products,
    })?.rule,
    4,
    "a second arm on the origin's anchor breaks placement rule 4 and nothing else",
  );

  await openChallengeDocument(h, BARE);
  const standing = await placePart(h, "arm", ORIGIN);
  const before = await partIds(h);

  await dragFromTray(h, ARM_SLOT, ORIGIN);
  await h.advance(1);
  await captureStill(h, "refused");

  const snapshot = await h.snapshot();
  assertDeepEqual(
    await partIds(h),
    before,
    "the release over an illegal hex added no part: the machine holds the ids it held",
  );
  assertEqual(
    `${partById(snapshot, standing)?.q},${partById(snapshot, standing)?.r}`,
    `${ORIGIN.q},${ORIGIN.r}`,
    "and the arm that was standing there is untouched",
  );
  assertNull(snapshot.editor.drag, "the drag ended at its release");
});
