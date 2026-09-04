// presentation/arm-hub-drawn-on-every-arm-kind — all four arm kinds carry the same
// produced hub.
//
// THE RULE. The Arm hubs row of `specs/assets.md` (The sprites) names the file and
// says which kinds carry it: "`assets/sprites/parts/hub-arm.png`, `hub-piston.png`",
// `40 x 40`, "centered on the part's anchor hex and turned to its first spoke; the
// arm hub carried by `arm`, `biarm`, `triarm`, and `hexarm`, the piston hub by
// `piston`." Genuinely produced makes it a picture rather than a shape: "Every mote,
// filament, glyph, hub, gripper, mount, and aperture on screen is a produced
// sprite." `specs/parts.md` puts the four kinds under one anatomy — "`arm`, `biarm`,
// `triarm`, `hexarm`, and `piston` share one anatomy: a base fixed on the anchor
// hex" — and only the piston is excepted from this file.
//
// WHAT SETTLES WHICH SOURCE A DRAW NAMED IS ITS OWN PIXELS, never a path, so each
// source is read back through `Harness.imagePixels` and compared with the committed
// `hub-arm.png`.
//
// WHAT IT READS. One of each of the four kinds is posed, and each must have a draw
// of `hub-arm.png` on its anchor hex — within half a hex pitch of that hex's centre,
// which is nearer to it than to any other hex on the field. Where exactly the hub
// lands is `hub-placed-on-its-anchor`, and what a piston carries instead is
// `piston-hub-drawn-on-a-piston`.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the completion
// switch held off, a live run, an EMPTY FIELD — with an `arm`, a `biarm`, a
// `triarm` and a `hexarm`, each at rotation `0`, length `1`, with an empty tape,
// which "is a rest on every part ... and never faults" (`specs/simulation.md`). The
// four anchors are three hexes apart, so no arm's grippers reach another's anchor,
// and no two arms share an anchor as `specs/parts.md` requires. No mote is on the
// field, so no gripper is holding anything.
//
// THE EVIDENCE is the frame holding all four, written before the assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { HEX_PITCH, HUB_PATHS } from "../constants";
import { at, distance, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import { armPart, solution } from "../formats";
import {
  captureStill,
  createHarness,
  imageDraws,
  openBareRun,
  type Harness,
} from "../harness";
import { HUB_SPRITES, assetFile } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

/** The four kinds that carry the arm hub, and where each one stands. */
const ARMS: readonly {
  kind: "arm" | "biarm" | "triarm" | "hexarm";
  anchor: Hex;
}[] = [
  { kind: "arm", anchor: at(-3, 0) },
  { kind: "biarm", anchor: at(3, 0) },
  { kind: "triarm", anchor: at(0, -3) },
  { kind: "hexarm", anchor: at(0, 3) },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws hub-arm.png on the anchor of an arm, a biarm, a triarm and a hexarm", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      ARMS.map((entry) =>
        armPart(entry.kind, entry.anchor.q, entry.anchor.r, 0, 1, []),
      ),
    ),
  });

  const calls = await h.frameCalls();
  await captureStill(h, "hubs");

  assertLength(
    (await h.snapshot()).editor.parts,
    ARMS.length,
    "the parts the machine holds, so the reading below is about four posed arms",
  );

  const readings = await decodeProduced(HUB_SPRITES);
  const hubs = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${HUB_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  // Every hub the frame drew, and where: read once, then matched to the anchors.
  const drawn: { x: number; y: number; file: string }[] = [];
  for (const draw of imageDraws(calls)) {
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const hub = hubs.find((sprite) => sameAsDrawn(sprite, pixels));
    if (hub === undefined) continue;
    drawn.push({ x: draw.cx, y: draw.cy, file: hub.file });
  }

  for (const entry of ARMS) {
    const centre = hexCenter(entry.anchor);
    const on = drawn.filter(
      (hub) => distance({ x: hub.x, y: hub.y }, centre) <= HEX_PITCH / 2,
    );
    if (on.length === 0) {
      fail(
        `${entry.kind}: an image draw of a produced hub on its anchor hex, rather than a shape drawn in code`,
        "the frame drew neither hub there",
      );
    }
    assertEqual(
      on.some((hub) => hub.file === assetFile(HUB_PATHS.arm))
        ? assetFile(HUB_PATHS.arm)
        : on.map((hub) => hub.file).join(", "),
      assetFile(HUB_PATHS.arm),
      `${entry.kind}: the produced hub the frame drew on its anchor hex`,
    );
  }
});
