// editor/releasing-off-every-hex-places-nothing — a place drag released while the
// pointer is over no hex at all adds nothing to the machine.
//
// THE RULE. "A release while no hex is targeted commits no move and leaves the
// part in place, selected. A TRAY DRAG RELEASED THE SAME WAY PLACES NOTHING"
// (`specs/editor.md`, Dragging), which is the same sentence's other half as
// "releasing anywhere else places nothing". "A drag ends at its release", so
// `editor.drag` is `null` afterwards however the release went.
//
// WHEN NO HEX IS TARGETED. `specs/field.md`: "The pointer targets the field hex
// whose center is nearest to the pointer position, PROVIDED THAT DISTANCE IS AT
// MOST `HEX_HIT_R` (`26`)". The field spans stage `x` `376` to `856` centre to
// centre, so a pointer at `(940, 304)` is `84` from the nearest centre and targets
// nothing — the field oracle says so before the gesture, and the point is still
// inside the field region, so the release is not a press on some other region
// standing in for the rule.
//
// THE CONFIGURATION. `BARE` opened in the editor on the empty machine
// `loadChallenge` leaves. One gesture: a press in the middle of tray entry `0`, a
// move onto `ORIGIN` — where the drag is live and TARGETING, which is what makes
// the next reading a change rather than a drag that never worked — a move out to
// `(940, 304)`, and a release there.
//
// THE VERDICT. `editor.drag.at` reads `null` at the moment of the release, the
// machine is still empty afterwards, and `editor.drag` is `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { hexCenter, targetHex, traySlot, type StagePoint } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  partIds,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const ARM_SLOT = 0;

/** A point inside the field region and more than `HEX_HIT_R` from every centre. */
const OFF_EVERY_HEX: StagePoint = { x: 940, y: 304 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places nothing and ends the drag", async () => {
  assertNull(
    targetHex(OFF_EVERY_HEX.x, OFF_EVERY_HEX.y),
    "no field hex centre lies within HEX_HIT_R of the release point",
  );

  await openChallengeDocument(h, BARE);
  const before = await partIds(h);
  assertEqual(before.length, 0, "the challenge opens on an empty machine");

  await pressAt(h, centerOf(traySlot(ARM_SLOT)));
  await moveTo(h, hexCenter(ORIGIN));
  const targeting = (await h.snapshot()).editor.drag;
  assertEqual(
    targeting?.kind === "place"
      ? `${targeting.at?.q},${targeting.at?.r}`
      : null,
    `${ORIGIN.q},${ORIGIN.r}`,
    "the drag is live and targeting the origin before the pointer leaves the field",
  );

  await moveTo(h, OFF_EVERY_HEX);
  const released = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  await h.advance(1);
  await captureStill(h, "nothing");

  assertNull(
    released?.kind === "place" ? released.at : "no place drag was live",
    "the drag targets no hex at the moment of the release",
  );
  assertDeepEqual(
    await partIds(h),
    before,
    "the release off every hex placed nothing: the machine is empty still",
  );
  assertNull((await h.snapshot()).editor.drag, "the drag ended at its release");
});
