// presentation/open-gripper-drawn-from-its-produced-file — a gripper holding
// nothing is the open sprite.
//
// THE RULE. The Grippers row of `specs/assets.md` (The sprites) names the two files
// and which one is shown when: "`assets/sprites/parts/gripper-open.png`,
// `gripper-closed.png`", `32 x 32`, "centered on each gripper's live position and
// turned to that spoke's live angle, the closed sprite while the gripper holds a
// mote and the open one whenever it holds none, so that whether a gripper is
// holding reads off the field as `specs/parts.md` asks". `specs/parts.md`'s
// Presentation is the ask: "An arm's spokes, its length, and whether each gripper
// is holding are visible." Genuinely produced makes it a picture rather than a
// shape: "Every mote, filament, glyph, hub, gripper, mount, and aperture on screen
// is a produced sprite."
//
// WHAT SETTLES WHICH SOURCE A DRAW NAMED IS ITS OWN PIXELS, never a path, so the
// source on the gripper's hex is read back through `Harness.imagePixels` and
// compared with both committed grippers.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the completion
// switch held off, a live run, an EMPTY FIELD — with one `arm` at `(0, 0)`,
// rotation `0`, length `1`, and an empty tape, which "is a rest on every part ...
// and never faults" (`specs/simulation.md`). No `grab` is ever fetched and no mote
// is on the field at all, so the gripper holds nothing by construction rather than
// by a rule holding. Its live position is `base + length * DIRS[0]`, which is hex
// `(1, 0)` (`specs/parts.md`), a whole hex pitch from the hub on the anchor.
//
// WHAT IT DOES NOT DECIDE. What a HOLDING gripper is drawn with, and the angle a
// gripper is turned to, are their own points. This one decides that an empty
// gripper is painted from `gripper-open.png`.
//
// THE EVIDENCE is the frame the reading was taken off, written before the
// assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { GRIPPER_PATHS, HEX_PITCH } from "../constants";
import { at, distance, hexCenter } from "../field";
import { BARE } from "../fixtures";
import { armPart, solution } from "../formats";
import {
  captureStill,
  createHarness,
  imageDraws,
  openBareRun,
  type Harness,
} from "../harness";
import { GRIPPER_SPRITES, assetFile } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

/** Where the arm stands, and the hex its one gripper stands on at length 1. */
const ANCHOR = at(0, 0);
const GRIPPER = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws gripper-open.png on the gripper of an arm holding nothing", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ANCHOR.q, ANCHOR.r, 0, 1, [])]),
  });

  const calls = await h.frameCalls();
  await captureStill(h, "open");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.grips ?? [],
    0,
    "the grips the run reports, so the gripper read below is holding nothing",
  );
  assertLength(
    snapshot.sim?.motes ?? [],
    0,
    "the motes on the field, so there is nothing for the gripper to have taken",
  );

  const readings = await decodeProduced(GRIPPER_SPRITES);
  const grippers = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${GRIPPER_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  const centre = hexCenter(GRIPPER);
  const on: string[] = [];
  for (const draw of imageDraws(calls)) {
    if (distance({ x: draw.cx, y: draw.cy }, centre) > HEX_PITCH / 2) continue;
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const gripper = grippers.find((sprite) => sameAsDrawn(sprite, pixels));
    if (gripper !== undefined) on.push(gripper.file);
  }
  if (on.length === 0) {
    fail(
      "an image draw of a produced gripper on the gripper's hex, rather than a shape drawn in code",
      "the frame drew neither gripper there",
    );
  }

  assertEqual(
    [...new Set(on)].sort().join(", "),
    assetFile(GRIPPER_PATHS.open),
    "the produced grippers the frame drew on the gripper's hex",
  );
});
