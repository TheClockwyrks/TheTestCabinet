// presentation/stage-fits-a-tall-window — over a surface taller than 16:9 the
// whole stage is on screen at its own ratio, centred, with the leftover split into
// two bars.
//
// THE RULE. "`STAGE_W x STAGE_H` is the game's logical design size. Fitting it to
// the browser window is the runtime's: the uniform scale that preserves the aspect
// ratio, the letterboxed centering, and the device pixel ratio. The complete stage
// is therefore on screen at every window size, on load and at any pixel density"
// (`specs/overview.md`, Coordinate system and presentation).
//
// THE SURFACE. `1280 x 1000` — taller than the stage's `1280 x 720`, so the fit is
// bound by the width: the uniform scale is `1`, the stage is `720` tall on a
// `1000`-tall surface, and the `280` left over is split into a `140` bar above and
// below.
//
// HOW THE FIT IS READ WITHOUT ASKING THE BUILD FOR IT. `viewport.ts` computes what
// `specs/overview.md` requires — one uniform scale, centred — and every pixel
// reading below is addressed in the stage's own logical units and mapped through
// it. So the question the readings put to the build is: is what you drew where the
// specification says it goes? Four motes are spawned on the four hexes furthest
// out on the field's axes — `(-5, 0)`, `(5, 0)`, `(0, -5)`, `(0, 5)`, whose
// centres `specs/field.md` fixes at the corners of the span `x` `376` to `856` and
// `y` `96.15` to `511.85` — and each is looked for at its own logical hex centre.
// A build that fitted to the height instead, that stretched the stage to the
// surface, or that left it against an edge rather than centring it puts every one
// of them somewhere else, and the square where the specification says it should be
// is drawn as the bare field left it.
//
// FOUR LANDMARKS RATHER THAN ONE, because one landmark cannot tell a wrong scale
// from a wrong offset, and two on one axis cannot tell a uniform scale from a
// stretch. Two apart in `x` and two apart in `y`, read against one fit, can.
//
// AND THE WHOLE STAGE IS THERE. The four corners of the stage are read as pixels,
// which they only are when the fitted stage lies inside the surface the build
// sized, and a point in each bar beyond the stage is read too, which is only there
// when the stage was inset rather than filling the surface.
//
// THE VERDICT. All four landmarks are drawn at their logical hex centres, all four
// stage corners are on the surface, and both bars are.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { at, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  differingShare,
  openBareRun,
  spawnMote,
  type Harness,
  type PixelRect,
} from "../harness";

/** The surface the stage is fitted into: taller than `STAGE_W / STAGE_H`. */
const CSS_WIDTH = 1280;
const CSS_HEIGHT = 1000;

/** The four hexes furthest out on the field's axes (`specs/field.md`, `FIELD_R`). */
const LANDMARKS: readonly Hex[] = [at(-5, 0), at(5, 0), at(0, -5), at(0, 5)];

/** Half the side of the square a landmark is read over; inside its own hex. */
const HALF = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ cssWidth: CSS_WIDTH, cssHeight: CSS_HEIGHT });
});

afterEach(async () => {
  await h.dispose();
});

function square(hex: Hex): Promise<PixelRect> {
  const centre = hexCenter(hex);
  return h.pixelRect(centre.x - HALF, centre.y - HALF, 2 * HALF, 2 * HALF);
}

it("draws the complete stage at its own ratio, centred, with even bars above and below", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  await h.advance(1);

  const bare: PixelRect[] = [];
  for (const hex of LANDMARKS) bare.push(await square(hex));

  for (const hex of LANDMARKS) await spawnMote(h, hex, "sol");
  await h.advance(1);
  await captureStill(h, "tall");

  for (const [index, hex] of LANDMARKS.entries()) {
    assertGreaterThan(
      differingShare(bare[index] as PixelRect, await square(hex)),
      0,
      `the mote on hex (${hex.q}, ${hex.r}) is drawn at that hex's own stage position on a ${CSS_WIDTH} x ${CSS_HEIGHT} surface, so the stage was fitted at one uniform scale and centred`,
    );
  }

  const corners = await h.pixels([
    { x: 1, y: 1 },
    { x: STAGE_W - 1, y: 1 },
    { x: 1, y: STAGE_H - 1 },
    { x: STAGE_W - 1, y: STAGE_H - 1 },
  ]);
  assertLength(
    corners,
    4,
    "all four corners of the 1280 x 720 stage fall on the surface, so the complete stage is on screen",
  );

  const bars = await h.pixels([
    { x: STAGE_W / 2, y: -CSS_HEIGHT / 16 },
    { x: STAGE_W / 2, y: STAGE_H + CSS_HEIGHT / 16 },
  ]);
  assertLength(
    bars,
    2,
    `the ${CSS_HEIGHT - STAGE_H} units of surface the stage does not cover lie beyond both its top and its bottom edge, so the bars are even rather than the stage sitting against one side`,
  );
});
