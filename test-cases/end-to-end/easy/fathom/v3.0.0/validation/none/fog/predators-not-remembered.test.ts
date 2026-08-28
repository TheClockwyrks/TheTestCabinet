// fog/predators-not-remembered — predator bodies are not remembered.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A predator lit by the forager's light reports lit true while the light holds
// it and lit false once the forager has swum out of range, with nothing of the
// body left drawn on the tile it stood on, sampled against the same tile
// before it arrived.

import { it } from "vitest";

it("Predator bodies are not remembered", () => {
  throw new Error(
    "validation/none/fog/predators-not-remembered.test.ts: not implemented",
  );
});
