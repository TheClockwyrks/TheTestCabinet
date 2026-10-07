// editor/a-field-press-opens-a-move-drag — a press on a placed part opens a drag of
// kind `move` naming that part and the hex the press targeted.
//
// THE RULE. "From the field: A PRESS ON A PART SELECTS IT AT ONCE AND BEGINS A
// MOVE. The drag's offset is the targeted hex minus the pressed hex" (
// `specs/editor.md`, Dragging). `specs/instrumentation.md` fixes what the snapshot
// then reports: a drag of `kind: "move"`, with `part` the part's id and `from` "the
// hex the press grabbed". Which hex a press targets is `specs/field.md`'s rule —
// "the field hex whose center is nearest to the pointer position, provided that
// distance is at most `HEX_HIT_R` (`26`)" — so a press on a hex's own centre
// targets that hex.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm, anchored on
// `ORIGIN` through the surface. One part on the field means the press cannot reach
// the wrong one, and an arm occupies its anchor alone, so the hex pressed and the
// part's anchor are the same hex by construction. The press is read and then
// released on the hex it began on, which "commits no move", so the check leaves
// the machine exactly as it found it.
//
// THE VERDICT. `editor.drag` is a `move`, it names the arm, and its `from` is
// `ORIGIN`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
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

it("reports a move drag naming the part and the pressed hex", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);

  await pressAt(h, hexCenter(ORIGIN));
  await h.advance(1);
  await captureStill(h, "drag");
  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);

  assertEqual(
    drag?.kind,
    "move",
    "a press on a placed part begins a move rather than a placement",
  );
  assertEqual(
    drag?.kind === "move" ? drag.part : null,
    arm,
    "the move names the part the press landed on",
  );
  assertEqual(
    drag?.kind === "move" ? `${drag.from.q},${drag.from.r}` : null,
    `${ORIGIN.q},${ORIGIN.r}`,
    "and its from is the hex the press targeted",
  );
});
