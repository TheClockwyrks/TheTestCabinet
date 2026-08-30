// Arc Foundry — animation/load-cycles-present: every Load type ships a four-frame
// idle cycle, at the size `specs/assets.md` fixes for it.
//
// THE REQUIREMENT, from the animation table of `specs/assets.md`: "Load idle —
// `load/<type>/0.png` .. `3.png` — the unit seething with charge as it travels, at
// `20 x 20`, and `32 x 32` for the Slug, the Dynamo, and the Overload Dynamo. One
// cycle per Load type, seven in all counting the Overload Dynamo." So there are
// twenty-eight files, and each one's dimensions are stated exactly.
//
// WHAT IS ASSERTED, AND WITH WHAT TOLERANCE. That every one of the twenty-eight is
// on disk, decodes as an image, and carries exactly the stated dimensions. There
// is no tolerance: `20 x 20` and `32 x 32` are figures the specification fixes
// rather than bounds, and a sprite drawn at another size is a different sprite —
// `draw-sheet` rasterizes a fixed-size canvas, so producing the stated size is
// what the tool was told to do.
//
// WHY ALL TWENTY-EIGHT AT ONCE RATHER THAN ONE POINT EACH. The point is one
// requirement in one direction — the Load's cycles were produced — and a build
// that shipped the Mote's and skipped the Dynamo's has missed that requirement
// once. Every miss is named in the failure, so a reviewer reads which file is
// gone rather than only that one is.

import { afterEach, beforeEach, it } from "vitest";

import { assertDeepEqual } from "../assert";
import {
  SPAWN_TYPES,
  createHarness,
  openYard,
  releaseUnit,
  type Harness,
} from "../harness";
import { cycleFrames, decodeAll, evidence, missing } from "./images";
import { serveProducedAssets } from "./produced";

/** The three identifiers `specs/assets.md` draws at `32 x 32`. */
const LARGE = new Set(["slug", "dynamo", "overload"]);

/** The size the specification fixes for each Load type's frames. */
function sizeOf(type: string): number {
  return LARGE.has(type) ? 32 : 20;
}

const FRAMES = SPAWN_TYPES.flatMap((type) => cycleFrames(`load/${type}`));

let h: Harness;

beforeEach(async () => {
  serveProducedAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces a four-frame cycle at the stated size for all seven Load types", async () => {
  await evidence(h, "load", async () => {
    openYard(h);
    // A unit of each type on the yard, held where it stands, so the still shows
    // the sprites the frames below are being read for.
    for (const [index, type] of SPAWN_TYPES.entries()) {
      releaseUnit(h, type, {
        tile: { col: 6 + index * 6, row: 16 },
        frozen: true,
      });
    }
    await h.advance(1);
  });

  assertDeepEqual(
    missing(FRAMES),
    [],
    "every Load cycle frame on disk under assets/ (specs/assets.md)",
  );

  const wrong: string[] = [];
  for (const type of SPAWN_TYPES) {
    const want = sizeOf(type);
    for (const frame of await decodeAll(cycleFrames(`load/${type}`))) {
      if (frame.width !== want || frame.height !== want) {
        wrong.push(
          `${frame.at} is ${frame.width}x${frame.height}, not ${want}x${want}`,
        );
      }
    }
  }
  assertDeepEqual(
    wrong,
    [],
    "each Load frame at 20x20, and 32x32 for the Slug, the Dynamo and the " +
      "Overload Dynamo (specs/assets.md)",
  );
});
