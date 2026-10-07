// instrumentation/pointer-up-immediate — a posed release is resolved before the
// call returns.
//
// THE RULE, set in bold by `specs/instrumentation.md` (The editor's hands): "**Each
// of the three pointer operations takes effect immediately, when it is called,
// rather than being sampled once per frame.** The press, the move, or the release
// is resolved before the call returns rather than deferred to the next frame."
//
// SO THE READING IS TAKEN WITH NO FRAME ADVANCED between the release and the
// snapshot. A build that committed the drag on its next update would report a
// machine that had not been built yet, and that is the whole of the failure this
// point catches.
//
// WHAT THE RELEASE IS REQUIRED TO HAVE DONE comes from `specs/editor.md`, of a
// drag out of the tray: "the ghost is a new part at the targeted hex, at rotation
// `0` and length `1`. Releasing on a legal hex places it and selects it." And "A
// drag ends at its release", so the snapshot's `drag`, whose resting value is
// `null`, reports none.
//
// THE HEX IS LEGAL BY THE RULES OF `specs/parts.md`: an arm's only hex is its
// anchor, and the field is empty, so the middle of the field takes it. The tray
// slot is derived from the challenge the way `specs/editor.md` derives it rather
// than counted by hand.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge and an empty machine: the
// part the snapshot reports afterwards can only be the one this drag placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { hexCenter, traySlot } from "../field";
import { derivedTray } from "../formats";
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
import { BARE, ORIGIN } from "../fixtures";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("has placed and selected the part, and ended the drag, before it returns", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const armSlot = derivedTray(BARE).findIndex((entry) => entry.kind === "arm");

  await pressAt(h, centerOf(traySlot(armSlot)));
  await moveTo(h, hexCenter(ORIGIN));
  await releasePointer(h);
  const released = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "released");

  assertLength(
    released.editor.parts,
    1,
    "releasing a tray drag on a legal hex places the part, in the snapshot taken with no frame advanced",
  );
  const placed = released.editor.parts[0];
  assertEqual(
    placed?.kind,
    "arm",
    "the part placed is the kind the tray entry offers",
  );
  assertEqual(placed?.q, ORIGIN.q, "the part is placed at the targeted hex");
  assertEqual(placed?.r, ORIGIN.r, "the part is placed at the targeted hex");
  assertEqual(placed?.rotation, 0, "a tray ghost opens at rotation 0");
  assertEqual(placed?.length, ARM_MIN_LEN, "a tray ghost opens at length 1");
  assertEqual(
    released.editor.selected,
    placed?.id,
    "releasing on a legal hex places the part and selects it",
  );
  assertNull(
    released.editor.drag,
    "a drag ends at its release, in the snapshot taken with no frame advanced",
  );
});
