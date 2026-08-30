// Arc Foundry — `press.cancel-is-free`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/cancel-is-free.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Putting a held rock away spends no stamp and places
// nothing, because the roll happens only on a successful drop.
//
// HOW IT IS DECIDED. Arm a rock, put it away, and read stampsLeft and the
// structure count back. The evidence it hands back is `cancel` (image): the
// yard after a cancelled rock.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.cancel-is-free", () => {
  it("Putting a held rock away is free", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.cancel-is-free` has not been written yet",
    );
  });
});
