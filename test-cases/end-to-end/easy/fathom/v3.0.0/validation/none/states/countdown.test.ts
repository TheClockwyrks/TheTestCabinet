// states/countdown — a dive opens on the countdown.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// DIVE confirmed sets screen to countdown with the maze and the HUD drawn
// behind it, the countdown holds for at least 1 s and at most 3 s of simulated
// time before screen becomes playing, and nothing but the countdown's own time
// and the forager's light advances while it runs.

import { it } from "vitest";

it("A dive opens on the countdown", () => {
  throw new Error("validation/none/states/countdown.test.ts: not implemented");
});
