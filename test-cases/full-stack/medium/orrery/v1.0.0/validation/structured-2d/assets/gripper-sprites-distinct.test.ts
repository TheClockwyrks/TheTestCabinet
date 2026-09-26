// assets/gripper-sprites-distinct — the closed gripper differs from the open one.
//
// THE RULE, from the art bar of `specs/assets.md`: "A closed gripper reads as
// closed at any of the six spoke angles." The Grippers row names the two files for
// that reason — "the closed sprite while the gripper holds a mote and the open one
// whenever it holds none, so that whether a gripper is holding reads off the field
// as `specs/parts.md` asks" — so the two pictures are the whole of how a hold is
// shown, and one picture under both names shows nothing.
//
// WHAT IT READS. The two files differ somewhere on the canvas they share. One
// file shipped twice differs by exactly nothing, since a PNG carries its pixels
// losslessly, so any pixel of difference is the whole of the reading. Two clear
// pixels count as the same pixel whatever bytes sit under them, because a
// straight-alpha canvas leaves those bytes undefined and a player sees nothing
// either way.
//
// WHAT IT DOES NOT DECIDE. Whether the closed gripper reads AS CLOSED at any of the
// six spoke angles is the art bar itself, and the reviewer's judgement. This point
// decides that two grippers were drawn rather than one shipped twice.
//
// THE EVIDENCE is the two grippers side by side, magnified, so the two states are
// compared by eye beside the verdict.

import { it } from "vitest";
import { assertGreaterThan, assertLength, fail } from "../assert";
import { GRIPPER_SPRITES } from "./files";
import { decodeProduced, differingShare, showSprites } from "./sprites";

it("draws the closed gripper as a different picture from the open one", async () => {
  await showSprites("grippers", GRIPPER_SPRITES);

  assertLength(
    GRIPPER_SPRITES,
    2,
    "the open gripper and the closed one, so the comparison below is of two files",
  );
  const readings = await decodeProduced(GRIPPER_SPRITES);
  const [open, closed] = GRIPPER_SPRITES;
  const readOpen = readings[0];
  const readClosed = readings[1];
  if (readOpen.sprite === null)
    fail(`a decoded ${open.label}`, readOpen.reason);
  if (readClosed.sprite === null) {
    fail(`a decoded ${closed.label}`, readClosed.reason);
  }

  assertGreaterThan(
    differingShare(readOpen.sprite, readClosed.sprite),
    0,
    "the share of the canvas on which the closed gripper differs from the open one",
  );
});
