// Arc Foundry — animation/component-fire-cycles-present: every base component
// ships a four-frame cycle under `components/<type>/fire/`.
//
// THE REQUIREMENT, from the animation table of `specs/assets.md`: "Component
// firing — `components/<type>/fire/0.png` .. `3.png` — the head's
// charge-and-discharge, played once per shot. One cycle per firing base type,
// seven in all", and, on the row below it, "Regulator idle —
// `components/regulator/fire/0.png` .. `3.png` — the Regulator's slow aura pulse,
// played as a loop rather than on a shot, since it never fires". So all eight
// base types of `specs/components.md` carry a cycle at that path, the Regulator
// included, and there are thirty-two files.
//
// WHAT IS ASSERTED. That every one of the thirty-two is on disk and decodes as an
// image. No size is asserted, because `specs/assets.md` fixes a size for the Load
// cycles and deliberately fixes none for these: a head is drawn on the mount it
// turns on, and how large the build draws its charge-and-discharge is the build's.
// Whether the four differ is `animation/component-fire-frames-distinct`, and
// whether the cycle is played on the shot is
// `animation/fire-cycle-plays-on-a-shot`; this point decides only that the files
// were produced.

import { afterEach, beforeEach, it } from "vitest";
import { COMPONENT_TYPES } from "../constants";
import { assertDeepEqual } from "../assert";
import {
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { cycleFrames, decodeAll, evidence, missing } from "./images";

const FRAMES = COMPONENT_TYPES.flatMap((type) =>
  cycleFrames(`components/${type}/fire`),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces a four-frame firing cycle for all eight base types", async () => {
  await evidence(h, "fire", async () => {
    openYard(h);
    // One of each type standing on the yard, so the still shows the heads whose
    // cycles are being read for.
    const anchors = [6, 11, 16, 21, 26, 31, 41, 46];
    for (const [index, type] of COMPONENT_TYPES.entries()) {
      standComponent(h, type, 1, anchors[index]!, 15);
    }
    await h.advance(1);
  });

  assertDeepEqual(
    missing(FRAMES),
    [],
    "a four-frame cycle under assets/components/<type>/fire/ for each of the " +
      "eight base types, the Regulator's aura pulse included (specs/assets.md)",
  );
  // Decoding is the rest of the requirement: a file that is present and is not an
  // image is a frame the game cannot draw. `decode` fails naming the path.
  await decodeAll(FRAMES);
});
