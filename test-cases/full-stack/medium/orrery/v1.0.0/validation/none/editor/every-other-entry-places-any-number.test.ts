// editor/every-other-entry-places-any-number — an entry that is not a rise or a set
// places as many copies as the player asks for.
//
// THE RULE. "A rise or set entry is spent once its part is on the field: it is
// drawn visibly distinct from an unspent entry, and a press on it does nothing
// until the placed part is deleted. EVERY OTHER ENTRY PLACES ANY NUMBER OF COPIES"
// (`specs/editor.md`, The tray). The placement rules agree from their own side:
// `specs/parts.md`'s rule 5 bounds rises and sets alone, and rule 4 asks only that
// "No two arms or wheels share an anchor hex."
//
// HOW A COPY IS PLACED is the tray drag of `specs/editor.md`: "From the tray: the
// ghost is a new part at the targeted hex, at rotation `0` and length `1`.
// Releasing on a legal hex places it and selects it."
//
// THE CONFIGURATION. `BARE` opened in the editor, whose one permitted kind is
// `arm`, with one arm already on the field at `(0, 0)` — put there through the
// surface, so the second placement is the only gesture this check makes. The drag
// runs from entry `0` to `(3, 0)`, three hexes away, so the two anchors differ and
// neither arm's gripper reaches the other.
//
// THE VERDICT. The press opens a place drag for an `arm`, and the release leaves
// TWO arms on the field: the one that was already there, and a new one anchored on
// `(3, 0)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { hexCenter, traySlot } from "../field";
import { BARE, EAST, ORIGIN } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  partsOfKind,
  placePart,
  pressAt,
  releasePointer,
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

it("places a second arm from the same entry the first arm's kind came from", async () => {
  await openChallengeDocument(h, BARE);
  const first = await placePart(h, "arm", ORIGIN);

  await pressAt(h, centerOf(traySlot(ARM_SLOT)));
  const opened = (await h.snapshot()).editor.drag;
  await moveTo(h, hexCenter(EAST));
  await releasePointer(h);

  await h.advance(1);
  await captureStill(h, "second");

  assertNotNull(
    opened,
    `a press on entry ${ARM_SLOT} opens a drag even with an arm already on the field`,
  );
  assertEqual(
    opened?.kind === "place" ? opened.part : null,
    "arm",
    "the drag it opens places an arm",
  );

  const arms = partsOfKind(await h.snapshot(), "arm");
  assertEqual(
    arms.length,
    2,
    "the release adds a second arm: only rise and set entries are ever spent",
  );
  assertEqual(
    arms.filter((part) => part.id === first).length,
    1,
    "the arm that was already on the field is still there",
  );
  const added = arms.find((part) => part.id !== first) ?? null;
  assertNotNull(added, "and a second, different arm stands beside it");
  assertEqual(
    `${added?.q},${added?.r}`,
    `${EAST.q},${EAST.r}`,
    "the new arm is anchored on the hex the drag was released over",
  );
});
