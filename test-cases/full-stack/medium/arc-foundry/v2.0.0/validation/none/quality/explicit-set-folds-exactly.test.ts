// Arc Foundry — `quality.explicit-set-folds-exactly`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/explicit-set-folds-exactly.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With an explicit combine set the combine folds exactly the
// pieces in that set and nothing else, even where the yard holds other pieces
// that would satisfy the same fold.
//
// HOW IT IS DECIDED. Stand three matching pieces, add two of them to the set,
// combine, and read which footprints were consumed. The evidence it hands back
// is `set` (image): the exact pair the explicit set folded.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.explicit-set-folds-exactly", () => {
  it("An explicit combine set folds exactly its members", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.explicit-set-folds-exactly` has not been written yet",
    );
  });
});
