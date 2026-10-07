// presentation/piston-hub-drawn-on-a-piston — a piston carries the other hub.
//
// THE RULE. The Arm hubs row of `specs/assets.md` (The sprites) names two files and
// splits the five kinds between them: "the arm hub carried by `arm`, `biarm`,
// `triarm`, and `hexarm`, the piston hub by `piston`". The art bar says what the
// second file is for: "The piston hub reads apart from the arm hub" — which is
// unreachable unless the piston is the one drawn from `hub-piston.png`.
// `specs/parts.md` gives the reason a player needs to tell them apart: a `piston` is
// "A single-gripper arm whose length changes at run time", so from the outside it is
// an `arm` until it moves.
//
// WHAT SETTLES WHICH SOURCE A DRAW NAMED IS ITS OWN PIXELS, never a path, so the
// source on the piston's anchor is read back through `Harness.imagePixels` and
// compared with both committed hubs.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the completion
// switch held off, a live run, an EMPTY FIELD — with a `piston` at `(-2, 0)` and an
// `arm` at `(2, 0)`, both at rotation `0`, length `1`, with empty tapes, which
// "is a rest on every part ... and never faults" (`specs/simulation.md`). The arm is
// posed because the point is that a piston "is told from an arm on the field"; only
// the piston's own anchor is asserted about, and the two stand four hexes apart so
// neither's hub is within half a hex pitch of the other's anchor. No mote is on the
// field.
//
// THE EVIDENCE is that frame — the piston beside the arm — written before the
// assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { HEX_PITCH, HUB_PATHS } from "../constants";
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
import { HUB_SPRITES, assetFile } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

/** Where the piston stands, and where the arm it is told apart from stands. */
const PISTON = at(-2, 0);
const ARM = at(2, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws hub-piston.png on the piston's anchor rather than the arm hub", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", PISTON.q, PISTON.r, 0, 1, []),
      armPart("arm", ARM.q, ARM.r, 0, 1, []),
    ]),
  });

  const calls = await h.frameCalls();
  await captureStill(h, "piston");

  const readings = await decodeProduced(HUB_SPRITES);
  const hubs = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${HUB_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  const centre = hexCenter(PISTON);
  const on: string[] = [];
  for (const draw of imageDraws(calls)) {
    if (distance({ x: draw.cx, y: draw.cy }, centre) > HEX_PITCH / 2) continue;
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const hub = hubs.find((sprite) => sameAsDrawn(sprite, pixels));
    if (hub !== undefined) on.push(hub.file);
  }
  if (on.length === 0) {
    fail(
      "an image draw of a produced hub on the piston's anchor hex, rather than a shape drawn in code",
      "the frame drew neither hub there",
    );
  }

  assertEqual(
    [...new Set(on)].sort().join(", "),
    assetFile(HUB_PATHS.piston),
    "the produced hubs the frame drew on the piston's anchor hex",
  );
});
