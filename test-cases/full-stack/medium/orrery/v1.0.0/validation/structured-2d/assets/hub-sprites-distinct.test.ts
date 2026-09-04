// assets/hub-sprites-distinct — the piston hub differs from the arm hub.
//
// THE RULE, from the art bar of `specs/assets.md`: "The piston hub reads apart from
// the arm hub." The Arm hubs row names the two files for that reason — "the arm hub
// carried by `arm`, `biarm`, `triarm`, and `hexarm`, the piston hub by `piston`" —
// and a piston and an arm behave differently enough that a player has to tell one
// from the other on the field: an arm rotates about its anchor, a piston extends
// along its spoke.
//
// WHAT IT READS. The two files differ on at least `DIFFER_MIN_SHARE` of the canvas
// they share. One file shipped under both names differs by exactly nothing, since a
// PNG carries its pixels losslessly, so the floor is one hundredth — the smallest
// share worth calling measurable. Two clear pixels count as the same pixel whatever
// bytes sit under them, because a straight-alpha canvas leaves those bytes
// undefined and a player sees nothing either way.
//
// WHAT IT DOES NOT DECIDE. Whether the piston hub READS APART at a glance is the
// art bar itself, and the reviewer's judgement. This point decides that two hubs
// were drawn rather than one shipped twice.
//
// THE EVIDENCE is the two hubs side by side, magnified, so they are compared by eye
// beside the verdict.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { HUB_SPRITES } from "./files";
import {
  DIFFER_MIN_SHARE,
  decodeProduced,
  differingShare,
  showSprites,
} from "./sprites";

it("draws the piston hub as a different picture from the arm hub", async () => {
  await showSprites("hubs", HUB_SPRITES);

  assertLength(
    HUB_SPRITES,
    2,
    "the arm hub and the piston hub, so the comparison below is of two files",
  );
  const readings = await decodeProduced(HUB_SPRITES);
  const [arm, piston] = HUB_SPRITES;
  const readArm = readings[0];
  const readPiston = readings[1];
  if (readArm.sprite === null) fail(`a decoded ${arm.label}`, readArm.reason);
  if (readPiston.sprite === null) {
    fail(`a decoded ${piston.label}`, readPiston.reason);
  }

  assertGreaterThanOrEqual(
    differingShare(readArm.sprite, readPiston.sprite),
    DIFFER_MIN_SHARE,
    "the share of the canvas on which the piston hub differs from the arm hub",
  );
});
