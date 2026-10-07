// editor/a-ghost-length-survives-the-release — a length change made on a move
// drag's ghost is the length the arm carries once the drag ends, committed or
// refused.
//
// THE RULE. "From the field: ... releasing elsewhere moves the part by the offset
// when the result is legal, and leaves it in place when it is not. Either way the
// part stays selected, AND A ROTATION OR LENGTH CHANGE MADE ON THE GHOST IS KEPT"
// (`specs/editor.md`, Dragging). That `part-grow` reaches the ghost is the same
// section — "`part-cw`, `part-ccw`, `part-grow`, and `part-shrink` act on the
// ghost" — and the range it works in is `specs/parts.md`: "Length is a whole
// number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`), chosen in the editor."
//
// THE TWO ENDINGS. REFUSED first, while the arm is still at `ARM_MIN_LEN`: the arm
// on `ORIGIN` is pressed, the pointer taken to `WEST` where a second arm stands,
// `part-grow` pressed once, and the drag released — placement rule 4, "No two arms
// or wheels share an anchor hex", refuses the result, so the arm stays on `ORIGIN`
// and the length is all that survives. COMMITTED second: the same arm is pressed,
// the pointer taken to `NORTH`, `part-grow` pressed once more, and the drag
// released, so the arm both moves and grows.
//
// THE CONFIGURATION. `BARE` opened in the editor with two arms, the DRAGGED one on
// `ORIGIN` and a resting one on `WEST` that exists only to make the first ending
// illegal. An arm occupies its anchor alone and "a gripper and the drawn arm
// between base and gripper pass over any hex, on or off the field, and over any
// part" (`specs/parts.md`), so lengthening a ghost can be refused for no reason
// outside this point. Each press on the field leaves the focus on `field`
// (`specs/controls.md`), which is the focus `part-grow` is read under rather than
// `ins-extend`, its `KeyW` stablemate.
//
// THE VERDICT. After the refused release the arm is still on `ORIGIN` at length
// `2`; after the committed one it is on `NORTH` at length `3`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
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

it("keeps the grown length through a refused move and through a committed one", async () => {
  const onWest = armPart("arm", WEST.q, WEST.r, 0, 1, []);
  assertEqual(
    placementFault([onWest, onWest], {
      reagents: BARE.reagents,
      products: BARE.products,
    })?.rule,
    4,
    "two arms on WEST's anchor break placement rule 4, which is what refuses the first ending",
  );

  await openChallengeDocument(h, BARE);
  await placePart(h, "arm", WEST);
  const dragged = await placePart(h, "arm", ORIGIN);
  assertEqual(
    partById(await h.snapshot(), dragged)?.length,
    ARM_MIN_LEN,
    "the dragged arm stands at ARM_MIN_LEN, so each press below has somewhere to go",
  );

  const refused = await captureReplay(h, "kept", async () => {
    await h.advance(1);
    await pressAt(h, hexCenter(ORIGIN));
    await moveTo(h, hexCenter(WEST));
    await pressAction(h, "part-grow");
    await releasePointer(h);
    await h.advance(1);
    const between = partById(await h.snapshot(), dragged);

    await pressAt(h, hexCenter(ORIGIN));
    await moveTo(h, hexCenter(NORTH));
    await pressAction(h, "part-grow");
    await releasePointer(h);
    await h.advance(1);
    return between;
  });

  assertEqual(
    `${refused?.q},${refused?.r}`,
    `${ORIGIN.q},${ORIGIN.r}`,
    "the release rule 4 refuses left the arm on the anchor it stood on",
  );
  assertEqual(
    refused?.length,
    ARM_MIN_LEN + 1,
    "and the part-grow press made on that refused ghost is kept all the same",
  );

  const grown = partById(await h.snapshot(), dragged);
  assertEqual(
    `${grown?.q},${grown?.r}`,
    `${NORTH.q},${NORTH.r}`,
    "the second release was legal, so the arm ends on the hex that drag targeted",
  );
  assertEqual(
    grown?.length,
    ARM_MAX_LEN,
    "and the two part-grow presses, one on a refused ghost and one on a committed one, are both kept",
  );
});
