// assets/wheel-pieces-distinct — the fixture mount differs from the wheel hub.
//
// THE RULE, from the art bar of `specs/assets.md`: "A fixture reads as mounted on
// its wheel rather than as resting loose." The sprite table names two files on one
// canvas for that reason: the Wheel hub is drawn "centered on the wheel's anchor
// hex and turned to the wheel's live rotation", the Fixture mount "centered on each
// fixture's hex, beneath its mote sprite" — the hub is the center a wheel turns
// about and the mount is the cradle out on its ring, and both appear on the same
// wheel at once. One picture shipped under both names puts a hub under every mote.
//
// WHAT IT READS. The two files differ on at least `DIFFER_MIN_SHARE` of the
// `48 x 48` canvas they share. One file shipped twice differs by exactly nothing,
// since a PNG carries its pixels losslessly, so the floor is one hundredth — the
// smallest share worth calling measurable. Two clear pixels count as the same pixel
// whatever bytes sit under them, because a straight-alpha canvas leaves those bytes
// undefined and a player sees nothing either way.
//
// WHAT IT DOES NOT DECIDE. Whether a fixture READS AS MOUNTED is the art bar itself,
// and the reviewer's judgement. This point decides that two pieces were drawn rather
// than one shipped twice.
//
// THE EVIDENCE is the hub and the mount side by side, magnified, so the two are
// compared by eye beside the verdict.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { FIXTURE_MOUNT_PATH, WHEEL_HUB_PATH } from "../constants";
import { WHEEL_SPRITES, assetFile } from "./files";
import {
  DIFFER_MIN_SHARE,
  decodeProduced,
  differingShare,
  showSprites,
} from "./sprites";

const HUB = WHEEL_SPRITES.filter(
  (row) => row.file === assetFile(WHEEL_HUB_PATH),
);
const MOUNT = WHEEL_SPRITES.filter(
  (row) => row.file === assetFile(FIXTURE_MOUNT_PATH),
);

it("draws the fixture mount as a different picture from the wheel hub", async () => {
  await showSprites("wheel", [...HUB, ...MOUNT]);

  assertLength(HUB, 1, "the wheel hub's row of the produced table");
  assertLength(MOUNT, 1, "the fixture mount's row of the produced table");
  const [readHub] = await decodeProduced(HUB);
  const [readMount] = await decodeProduced(MOUNT);
  if (readHub.sprite === null)
    fail(`a decoded ${HUB[0].label}`, readHub.reason);
  if (readMount.sprite === null) {
    fail(`a decoded ${MOUNT[0].label}`, readMount.reason);
  }

  assertGreaterThanOrEqual(
    differingShare(readHub.sprite, readMount.sprite),
    DIFFER_MIN_SHARE,
    "the share of the canvas on which the fixture mount differs from the wheel hub",
  );
});
