// Meltdown — movers/forge-does-not-fire: the Forge never fires.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With units of every type in range, a Forge reports firing false, targeting
//   null, and 0 kills and 0 damage dealt.

import { it } from "vitest";

it("The Forge never fires", () => {
  throw new Error(
    "Meltdown: validation/movers/forge-does-not-fire.test.ts is not implemented yet",
  );
});
