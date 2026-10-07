// editor/releasing-a-move-off-every-hex-commits-nothing — a move drag released
// while the pointer targets no hex leaves the part where it stands.
//
// THE RULE. "A RELEASE WHILE NO HEX IS TARGETED COMMITS NO MOVE AND LEAVES THE
// PART IN PLACE, selected" (`specs/editor.md`, Dragging), and "A drag ends at its
// release", so `editor.drag` is `null` afterwards.
//
// WHEN NO HEX IS TARGETED. `specs/field.md`: "The pointer targets the field hex
// whose center is nearest to the pointer position, PROVIDED THAT DISTANCE IS AT
// MOST `HEX_HIT_R` (`26`)". The field spans stage `x` `376` to `856` centre to
// centre, so a pointer at `(940, 304)` is `84` from the nearest centre and targets
// nothing — the field oracle says so before the gesture, and the point is still
// inside the field region, so the release is not a press on some other region
// standing in for the rule.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm anchored on
// `ORIGIN`. The gesture presses `ORIGIN`, moves onto `EAST` — where the drag is
// live and RETARGETED, so the reading that follows is a drag that stopped
// targeting rather than one that never targeted anything — then out to
// `(940, 304)`, and releases there.
//
// THE VERDICT. `editor.drag.at` reads `null` at the moment of the release, the arm
// is still anchored on `ORIGIN` afterwards, and `editor.drag` is `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { hexCenter, targetHex, type StagePoint } from "../field";
import { BARE, EAST, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  moveTo,
  openChallengeDocument,
  partById,
  pressAt,
  placePart,
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

it("leaves the part on its anchor and ends the drag", async () => {
  assertNull(
    targetHex(OFF_EVERY_HEX.x, OFF_EVERY_HEX.y),
    "no field hex centre lies within HEX_HIT_R of the release point",
  );

  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);

  await pressAt(h, hexCenter(ORIGIN));
  await moveTo(h, hexCenter(EAST));
  const targeting = (await h.snapshot()).editor.drag;
  assertEqual(
    targeting?.kind === "move" ? `${targeting.at?.q},${targeting.at?.r}` : null,
    `${EAST.q},${EAST.r}`,
    "the move drag is live and targeting EAST before the pointer leaves the field",
  );

  await moveTo(h, OFF_EVERY_HEX);
  const released = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  await h.advance(1);
  await captureStill(h, "still");

  assertNull(
    released?.kind === "move" ? released.at : "no move drag was live",
    "the drag targets no hex at the moment of the release",
  );
  const snapshot = await h.snapshot();
  assertEqual(
    `${partById(snapshot, arm)?.q},${partById(snapshot, arm)?.r}`,
    `${ORIGIN.q},${ORIGIN.r}`,
    "the release off every hex committed no move: the arm is on the anchor it stood on",
  );
  assertNull(snapshot.editor.drag, "the drag ended at its release");
});
