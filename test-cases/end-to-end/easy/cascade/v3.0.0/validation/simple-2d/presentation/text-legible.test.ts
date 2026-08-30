// SCAFFOLD PLACEHOLDER — validation/simple-2d/presentation/text-legible.test.ts
//
// The review item `presentation.text-legible` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Text reads against what it sits on
//
//   Every string drawn on the title screen, and every HUD label, differs from the background immediately behind it by at least 60 of 441 in RGB distance. This is the legibility table's Text row, which no other item carried. Which strings are drawn is the screens group's question and is not decided again here.

import { it } from "vitest";

it("presentation.text-legible — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/presentation/text-legible.test.ts is a scaffold stub, not a validator",
  );
});
