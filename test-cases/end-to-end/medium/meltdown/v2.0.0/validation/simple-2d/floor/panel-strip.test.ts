// Meltdown — floor/panel-strip: the build panel occupies the right strip.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   The panel is drawn across x in [986, 1280] for the full height, and no
//   tower, unit or floor chrome is drawn there.

import { it } from "vitest";

it("The build panel occupies the right strip", () => {
  throw new Error(
    "Meltdown: validation/floor/panel-strip.test.ts is not implemented yet",
  );
});
