// Arc Foundry — `effects.build-spark`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/build-spark.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn at the new footprint on the frame a
// rock lands that were not drawn there on the frame before it.
//
// HOW IT IS DECIDED. Sample the footprint on the frame before a drop and on
// the frame of the drop. The evidence it hands back is `spark` (replay): the
// spark at a landing rock.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.build-spark", () => {
  it("A landing rock throws a build spark", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.build-spark` has not been written yet",
    );
  });
});
