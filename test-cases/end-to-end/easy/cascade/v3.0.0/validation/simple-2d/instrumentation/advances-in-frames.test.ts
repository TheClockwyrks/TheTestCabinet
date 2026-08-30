// SCAFFOLD PLACEHOLDER — validation/simple-2d/instrumentation/advances-in-frames.test.ts
//
// The review item `instrumentation.advances-in-frames` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The simulation advances on elapsed time alone
//
//   With setLaunching(false) and one flyer posed clear of the floor and of both side edges, one second of game time covered as one frame and as sixty frames adds 1.0 to simTime either way and leaves the flyer's x the same within 0.5 units, so the simulation reads nothing from the renderer.

import { it } from "vitest";

it("instrumentation.advances-in-frames — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/instrumentation/advances-in-frames.test.ts is a scaffold stub, not a validator",
  );
});
