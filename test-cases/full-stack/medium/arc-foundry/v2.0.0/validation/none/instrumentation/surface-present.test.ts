// Arc Foundry — `instrumentation.surface-present`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `instrumentation/surface-present.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Every operation specs/instrumentation.md names is present
// as a function on the surface — reached on the page as window.__foundry in an
// engineless build and off engine.debug in an engine build — and the surface
// is live: placeComponent stands a Capacitor on the yard, snapshot reports it
// in structures, and the rendered frame changes.
//
// HOW IT IS DECIDED. Reflect that every required operation is installed as a
// function (the clock and input operations under `none` alone), then prove
// liveness by standing a structure up, reading it back off the snapshot, and
// reading the canvas. The evidence it hands back is `posed` (image): the posed
// yard the surface stood a structure on.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("instrumentation.surface-present", () => {
  it("The debug and automation surface is present", () => {
    fail(
      "a validator deciding this point",
      "the suite for `instrumentation.surface-present` has not been written yet",
    );
  });
});
