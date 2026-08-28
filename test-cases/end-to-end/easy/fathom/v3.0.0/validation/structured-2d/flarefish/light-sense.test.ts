// flarefish/light-sense — it senses the forager's light like the Lanternjaw.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A wandering Flarefish with clear line of sight to the forager takes a fix —
// state chase — while the distance between their centers is inside
// detectRange, which is LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G, with no
// flare needed, and holds none while the same pair stands beyond it.

import { it } from "vitest";

it("It senses the forager's light like the Lanternjaw", () => {
  throw new Error(
    "validation/structured-2d/flarefish/light-sense.test.ts: not implemented",
  );
});
