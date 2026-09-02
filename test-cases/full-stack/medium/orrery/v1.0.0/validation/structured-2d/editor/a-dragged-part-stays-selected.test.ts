// editor/a-dragged-part-stays-selected — however a move drag ends, the part it
// grabbed is the part `editor.selected` names.
//
// THE RULE. "From the field: a press on a part selects it at once and begins a
// move ... releasing elsewhere moves the part by the offset when the result is
// legal, and leaves it in place when it is not. EITHER WAY THE PART STAYS
// SELECTED" (`specs/editor.md`, Dragging), and the sentence after covers the third
// ending: "A release while no hex is targeted commits no move and LEAVES THE PART
// IN PLACE, SELECTED."
//
// THE THREE ENDINGS, each on the same field and each read on its own. A COMMITTED
// move: `ORIGIN` pressed, `NORTH` released on, an offset no rule refuses. A
// REFUSED move: `NORTH` pressed, `WEST` released on, where a second arm stands, so
// placement rule 4 — "No two arms or wheels share an anchor hex" — leaves the arm
// in place. And a release OFF EVERY HEX: `NORTH` pressed and the pointer taken out
// to `(940, 304)`, which is `84` from the nearest hex centre and so past
// `HEX_HIT_R` (`26`), as the field oracle confirms.
//
// THE CONFIGURATION. `BARE` opened in the editor with two arms, the DRAGGED one on
// `ORIGIN` and a resting one on `WEST` that exists only to make the second ending's
// result illegal. The selection is cleared through the surface before each of the
// three gestures, so each reading is that gesture's doing rather than a value it
// inherited from the one before.
//
// THE VERDICT. After each of the three releases, `editor.selected` is the dragged
// arm's id.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { hexCenter, targetHex, type Hex, type StagePoint } from "../field";
import { armPart } from "../formats";
import { BARE, NORTH, ORIGIN, WEST } from "../fixtures";
import { placementFault } from "../parts";
import {
  captureReplay,
  createHarness,
  dragHex,
  moveTo,
  openChallengeDocument,
  partById,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** A point inside the field region and more than `HEX_HIT_R` from every centre. */
const OFF_EVERY_HEX: StagePoint = { x: 940, y: 304 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Clear the selection, so what the next gesture leaves is the next gesture's. */
async function forgetSelection(): Promise<void> {
  await h.debug.setSelected(null);
  assertNull(
    (await h.snapshot()).editor.selected,
    "nothing is selected before the gesture, so the selection after it is the gesture's doing",
  );
}

it("still names the dragged part after a committed, a refused, and an untargeted release", async () => {
  const onWest = armPart("arm", WEST.q, WEST.r, 0, 1, []);
  assertEqual(
    placementFault([onWest, onWest], {
      reagents: BARE.reagents,
      products: BARE.products,
    })?.rule,
    4,
    "two arms on WEST's anchor break placement rule 4, which is what refuses the second ending",
  );
  assertNull(
    targetHex(OFF_EVERY_HEX.x, OFF_EVERY_HEX.y),
    "the third ending's release point targets no hex at all",
  );

  await openChallengeDocument(h, BARE);
  await placePart(h, "arm", WEST);
  const dragged = await placePart(h, "arm", ORIGIN);

  const selections = await captureReplay(h, "selected", async () => {
    await h.advance(1);
    const seen: (number | null)[] = [];

    await forgetSelection();
    await dragHex(h, ORIGIN, NORTH);
    await h.advance(1);
    seen.push((await h.snapshot()).editor.selected);

    await forgetSelection();
    await dragHex(h, NORTH, WEST);
    await h.advance(1);
    seen.push((await h.snapshot()).editor.selected);

    await forgetSelection();
    await pressAt(h, hexCenter(NORTH));
    await moveTo(h, OFF_EVERY_HEX);
    await releasePointer(h);
    await h.advance(1);
    seen.push((await h.snapshot()).editor.selected);

    return seen;
  });

  const settled: Hex = NORTH;
  assertEqual(
    `${partById(await h.snapshot(), dragged)?.q},${partById(await h.snapshot(), dragged)?.r}`,
    `${settled.q},${settled.r}`,
    "the three gestures really ran: the committed move carried the arm to NORTH and the other two left it there",
  );
  assertDeepEqual(
    selections,
    [dragged, dragged, dragged],
    "the dragged arm is selected after a committed move, after a refused move, and after a release off every hex",
  );
});
