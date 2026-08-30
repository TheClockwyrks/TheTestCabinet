// SCAFFOLD PLACEHOLDER — validation/none/cascade/no-flyer-collision.test.ts
//
// The review item `cascade.no-flyer-collision` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Flyers pass through one another
//
//   Two flyers aimed at one point keep their velocities through the crossing.

import { it } from "vitest";

it("cascade.no-flyer-collision — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/cascade/no-flyer-collision.test.ts is a scaffold stub, not a validator",
  );
});
