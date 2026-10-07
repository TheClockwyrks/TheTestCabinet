// editor/a-place-drag-reports-no-hex-off-the-field — a place drag whose pointer
// stands off every hex reports no target, and stays live.
//
// THE RULE, in two halves. The target: `specs/field.md` gives the pointer a hex
// only "provided that distance is at most `HEX_HIT_R` (`26`)", and
// `specs/instrumentation.md` writes down what the drag reports when it has none —
// `at: { q, r } | null, // the targeted hex, NULL OFF EVERY HEX`. And the drag's
// life: "a press begins it, each pointer move retargets it, AND THE RELEASE
// COMMITS OR CANCELS IT" (`specs/editor.md`, Dragging), restated as "A drag ends
// at its release." A move is a retarget, never an end — so a move off every hex
// leaves the drag standing with nothing targeted, and a later move retargets it
// like any other.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine empty, and one drag
// opened by a press on tray entry `0`, the arm. The pointer then visits three
// positions in turn:
//
//   1. the centre of `(0, 0)`, so the drag is seen targeting a hex at all;
//   2. `(232, 304)` — inside the FIELD region, whose extent `specs/editor.md`
//      fixes as `x` `224` to `1008` and `y` `48` to `560`, and `144` units from
//      the nearest hex centre, far outside `HEX_HIT_R` (`26`). The case's own
//      targeting oracle is asserted on it first, so the point really is off every
//      hex by `specs/field.md`'s rule rather than by this check's arithmetic;
//   3. the centre of `(3, 0)`, back on a hex, where the release places the arm.
//
// THE VERDICT. At the second position the drag is still there, still a `place`
// drag, and its `at` is `null`; at the third it names `(3, 0)` again, and the
// release places one arm anchored there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { hexCenter, targetHex, traySlot, type StagePoint } from "../field";
import { BARE, EAST, ORIGIN } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** `BARE`'s tray: the one permitted kind, `arm`, then its rise and its set. */
const ARM_SLOT = 0;

/** A point inside the field region and 144 units from the nearest hex centre. */
const OFF_EVERY_HEX: StagePoint = { x: 232, y: 304 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a null target off every hex, stays live, and still places on the way back", async () => {
  assertNull(
    targetHex(OFF_EVERY_HEX.x, OFF_EVERY_HEX.y),
    "the point the pointer visits is off every hex by the targeting rule of specs/field.md",
  );

  await openChallengeDocument(h, BARE);

  await pressAt(h, centerOf(traySlot(ARM_SLOT)));
  await moveTo(h, hexCenter(ORIGIN));
  const onHex = (await h.snapshot()).editor.drag;

  await moveTo(h, OFF_EVERY_HEX);
  await h.advance(1);
  await captureStill(h, "untargeted");
  const untargeted = (await h.snapshot()).editor.drag;

  assertEqual(
    onHex?.kind === "place" && onHex.at !== null
      ? `${onHex.at.q},${onHex.at.r}`
      : null,
    `${ORIGIN.q},${ORIGIN.r}`,
    "the drag targets (0, 0) while the pointer stands on its centre",
  );
  assertNotNull(
    untargeted,
    "the drag is still live off every hex: a drag ends at its release, and a move is a retarget",
  );
  assertEqual(
    untargeted?.kind,
    "place",
    "and it is still the place drag the tray press opened",
  );
  assertNull(
    untargeted?.kind === "place" ? untargeted.at : undefined,
    "with no hex targeted, the drag reports at as null",
  );

  await moveTo(h, hexCenter(EAST));
  const back = (await h.snapshot()).editor.drag;
  assertEqual(
    back?.kind === "place" && back.at !== null
      ? `${back.at.q},${back.at.r}`
      : null,
    `${EAST.q},${EAST.r}`,
    "a later move retargets the drag, so it was still live to retarget",
  );

  await releasePointer(h);
  const parts = (await h.snapshot()).editor.parts;
  assertEqual(parts.length, 1, "and the release can still place");
  assertEqual(
    `${parts[0]?.kind}@${parts[0]?.q},${parts[0]?.r}`,
    `arm@${EAST.q},${EAST.r}`,
    "one arm, anchored on the hex the drag was released over",
  );
});
