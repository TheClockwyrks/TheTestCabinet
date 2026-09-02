// instrumentation/set-selected — the operation that selects a part.
//
// THE RULE. "`setSelected(part)` | Selects that part. `null` clears the selection"
// (`specs/instrumentation.md`, The editor's hands). What being selected MEANS is
// `specs/editor.md`: "At most one part is selected, and the selected part is drawn
// visibly distinct", and "The field-focus actions of `specs/controls.md` act on
// the selected part: `part-cw` and `part-ccw` turn an arm, a wheel, or a sigil one
// rotation step".
//
// SO THE CHECK READS THE SELECTION AND THEN THE CONSEQUENCE. `editor.selected` is
// the posed part, and the field-focus verb the player presses lands on that part
// and on no other: `part-cw` (`KeyE`, `specs/controls.md`) turns the selected arm
// one step clockwise and leaves the unselected one exactly where it stands. The
// still is the evidence for "drawn visibly distinct"; the verdict is the
// selection and what the verb did with it.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, an empty machine, and two
// arms placed far enough apart that neither's rotation can make the other's
// placement illegal — two, because "selects THAT part" says nothing at all on a
// machine holding one. The focus is posed to `field`, which is the focus the
// field verbs are read under (`specs/controls.md`, Focus), so the press is
// routed by a posed focus rather than by whatever the editor was left holding.
// No run is started: selection is an editing hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { turnDirection } from "../field";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  pressAction,
  type Harness,
} from "../harness";
import { BARE, EAST, ORIGIN } from "../fixtures";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("makes that part the selection, and the field verb acts on it alone", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const first = await placePart(h, "arm", ORIGIN, 0);
  const second = await placePart(h, "arm", EAST, 0);
  await h.debug.setFocus("field");

  await h.debug.setSelected(second);
  const posed = await h.snapshot();
  assertEqual(
    posed.editor.selected,
    second,
    "setSelected(part) makes that part the selection",
  );

  await pressAction(h, "part-cw");
  await captureStill(h, "selected");

  const turned = await h.snapshot();
  assertEqual(
    turned.editor.selected,
    second,
    "the selection stands after the verb it routed",
  );
  const acted = partById(turned, second);
  assertNotNull(acted, "the selected arm is still on the machine");
  assertEqual(
    acted?.rotation,
    turnDirection(0, 1),
    "part-cw turns the selected part one rotation step clockwise",
  );
  const untouched = partById(turned, first);
  assertNotNull(untouched, "the unselected arm is still on the machine");
  assertEqual(
    untouched?.rotation,
    0,
    "the field verb acts on the selected part alone, so the unselected arm is where it was placed",
  );
});
