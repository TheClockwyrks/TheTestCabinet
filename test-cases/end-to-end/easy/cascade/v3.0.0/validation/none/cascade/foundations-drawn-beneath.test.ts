// SCAFFOLD PLACEHOLDER — validation/none/cascade/foundations-drawn-beneath.test.ts
//
// The review item `cascade.foundations-drawn-beneath` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Unlaunched cards stay drawn in place
//
//   The cards still on the foundations are drawn at their anchors while the cascade runs above them, so a build does not stop drawing the unlaunched foundations once the cascade starts. Painting stays off, per the group rule: the trail is not needed to decide this and posing it would entangle two requirements.

import { it } from "vitest";

it("cascade.foundations-drawn-beneath — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/cascade/foundations-drawn-beneath.test.ts is a scaffold stub, not a validator",
  );
});
