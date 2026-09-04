// editor/a-place-drag-opens-at-rotation-zero-length-one — the ghost a tray press
// opens always starts at rotation `0` and length `1`.
//
// THE RULE. "From the tray: the ghost is a new part at the targeted hex, AT
// ROTATION `0` AND LENGTH `1`" (`specs/editor.md`, Dragging). It is stated of the
// drag itself, without exception, so it holds however the drag before it was left:
// a fresh ghost is a fresh part. `specs/instrumentation.md` reports the two
// figures on the drag: `{ kind: "place", part, index, rotation, length, at }`.
//
// WHAT COULD GO WRONG, and what this poses against, is a build that remembers the
// pose the player last turned a ghost to and opens the next drag at it. So the
// FIRST drag is deliberately left at another pose: while it is live, "`part-cw`,
// `part-ccw`, `part-grow`, and `part-shrink` act on the ghost" (`specs/editor.md`,
// Dragging), so two `part-cw` presses and two `part-grow` presses carry the ghost
// to rotation `2` and length `3` — `ARM_MAX_LEN`, which the second `part-grow`
// reaches — before that drag is released and places its arm.
//
// THE CONFIGURATION. `BARE` opened in the editor, whose one permitted kind is
// `arm`, so tray entry `0` is the arm. The machine is empty as `loadChallenge`
// leaves it. The first drag runs from entry `0` to `(-3, 0)`, an anchor a
// three-length arm stands on legally, since `specs/parts.md`'s rule 1 asks only
// that an arm's anchor is on the field. The second press is on entry `0` again and
// the pointer is not moved, so that drag targets no hex and its release "places
// nothing".
//
// The turned ghost's own pose is READ BACK before the release, because a build
// that ignored the four ghost verbs would open every drag at rotation `0` and
// length `1` for the wrong reason: with nothing ever carried over, there would be
// nothing to carry.
//
// THE VERDICT. The second press opens a drag reporting rotation `0` and length
// `1`, though the drag before it was released at rotation `2` and length `3`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { hexCenter, traySlot } from "../field";
import { BARE, WEST } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  pressAction,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** `BARE`'s tray: the one permitted kind, `arm`, then its rise and its set. */
const ARM_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a fresh ghost at rotation 0 and length 1 after a drag left at another pose", async () => {
  await openChallengeDocument(h, BARE);

  await pressAt(h, centerOf(traySlot(ARM_SLOT)));
  await moveTo(h, hexCenter(WEST));
  await pressAction(h, "part-cw");
  await pressAction(h, "part-cw");
  await pressAction(h, "part-grow");
  await pressAction(h, "part-grow");
  const turned = (await h.snapshot()).editor.drag;
  await releasePointer(h);

  await pressAt(h, centerOf(traySlot(ARM_SLOT)));
  await h.advance(1);
  await captureStill(h, "ghost");
  const opened = (await h.snapshot()).editor.drag;
  await releasePointer(h);

  assertNotNull(
    turned,
    "the first drag is still live while its ghost is turned and grown",
  );
  assertEqual(
    turned?.kind === "place" ? turned.rotation : null,
    2,
    "two part-cw presses leave that ghost at rotation 2, so there is a pose to carry over",
  );
  assertEqual(
    turned?.kind === "place" ? turned.length : null,
    ARM_MAX_LEN,
    `two part-grow presses leave that ghost at ARM_MAX_LEN (${ARM_MAX_LEN}), so there is a length to carry over`,
  );

  assertNotNull(opened, "the second press on the tray entry opens a drag");
  assertEqual(opened?.kind, "place", "and that drag is a place drag");
  assertEqual(
    opened?.kind === "place" ? opened.rotation : null,
    0,
    "the ghost a tray press opens starts at rotation 0, whatever the last part placed was left at",
  );
  assertEqual(
    opened?.kind === "place" ? opened.length : null,
    1,
    "and at length 1",
  );
});
