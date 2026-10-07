// editor/a-ghost-rotation-survives-the-release — a rotation made on a move drag's
// ghost is the rotation the part carries once the drag ends, committed or refused.
//
// THE RULE. "From the field: ... releasing elsewhere moves the part by the offset
// when the result is legal, and leaves it in place when it is not. Either way the
// part stays selected, AND A ROTATION OR LENGTH CHANGE MADE ON THE GHOST IS KEPT"
// (`specs/editor.md`, Dragging). That the keys reach the ghost at all is the same
// section: "`part-cw`, `part-ccw`, `part-grow`, and `part-shrink` act on the
// ghost", and `specs/field.md` fixes the step: "Rotating a direction index
// clockwise ADDS `1` MODULO `6`".
//
// THE TWO ENDINGS. COMMITTED: the arm on `ORIGIN` is pressed, the pointer taken to
// `NORTH`, `part-cw` pressed twice, and the drag released — an offset no placement
// rule refuses, so the arm both moves and turns. REFUSED: the same arm, now on
// `NORTH`, is pressed, the pointer taken to `WEST` where a second arm stands,
// `part-cw` pressed once, and the drag released — placement rule 4, "No two arms
// or wheels share an anchor hex", refuses the result, so the arm stays on `NORTH`
// and the rotation is all that survives.
//
// THE CONFIGURATION. `BARE` opened in the editor with two arms, the DRAGGED one on
// `ORIGIN` and a resting one on `WEST` that exists only to make the second ending
// illegal. Both are ARMS, which occupy their anchor alone (`specs/parts.md`,
// placement rule 1), so no rotation of either ghost can be refused for a reason
// outside this point. Each press on the field leaves the focus on `field`
// (`specs/controls.md`), which is the focus `part-cw` is read under.
//
// THE VERDICT. After the committed release the arm is on `NORTH` at rotation `2`;
// after the refused one it is still on `NORTH`, at rotation `3`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { hexCenter } from "../field";
import { armPart } from "../formats";
import { BARE, NORTH, ORIGIN, WEST } from "../fixtures";
import { placementFault } from "../parts";
import {
  captureReplay,
  createHarness,
  moveTo,
  openChallengeDocument,
  partById,
  placePart,
  pressAction,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the turned rotation through a committed move and through a refused one", async () => {
  const onWest = armPart("arm", WEST.q, WEST.r, 0, 1, []);
  assertEqual(
    placementFault([onWest, onWest], {
      reagents: BARE.reagents,
      products: BARE.products,
    })?.rule,
    4,
    "two arms on WEST's anchor break placement rule 4, which is what refuses the second ending",
  );

  await openChallengeDocument(h, BARE);
  await placePart(h, "arm", WEST);
  const dragged = await placePart(h, "arm", ORIGIN);

  await captureReplay(h, "committed", async () => {
    await h.advance(RECORDING_RUN_UP);
    await pressAt(h, hexCenter(ORIGIN));
    await moveTo(h, hexCenter(NORTH));
    await pressAction(h, "part-cw");
    await pressAction(h, "part-cw");
    await releasePointer(h);
    await h.advance(RECORDING_SETTLE);
  });

  const moved = partById(await h.snapshot(), dragged);
  assertEqual(
    `${moved?.q},${moved?.r}`,
    `${NORTH.q},${NORTH.r}`,
    "the legal release carried the arm to the targeted hex",
  );
  assertEqual(
    moved?.rotation,
    2,
    "and the two part-cw presses made on its ghost are the rotation it carries",
  );

  await captureReplay(h, "refused", async () => {
    await h.advance(RECORDING_RUN_UP);
    await pressAt(h, hexCenter(NORTH));
    await moveTo(h, hexCenter(WEST));
    await pressAction(h, "part-cw");
    await releasePointer(h);
    await h.advance(RECORDING_SETTLE);
  });

  const refused = partById(await h.snapshot(), dragged);
  assertEqual(
    `${refused?.q},${refused?.r}`,
    `${NORTH.q},${NORTH.r}`,
    "the release rule 4 refuses left the arm on the anchor it stood on",
  );
  assertEqual(
    refused?.rotation,
    3,
    "and the part-cw press made on that ghost is kept all the same",
  );
});
