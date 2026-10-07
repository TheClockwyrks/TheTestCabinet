// progression/respawn-clears-foes — a lost life sweeps every foe off the board.
//
// specs/progression.md, Losing a life: on a contact with lives to spare, every
// worm, every FOE, and every bolt in flight is removed from the board. The rule
// names no kind, so all three are posed — a glitch, a dropper and a corruptor,
// each on its own tile well above the player band — and a build that sweeps some
// kinds and not others is left holding the ones it kept.
//
// Each foe is posed with BOTH its faculties gated off (specs/instrumentation.md,
// setFoeMind and setFoeTravel), so none of them travels into the cursor, eats a
// node, lays one, or slams one while the frame runs. The only contact on the
// board is the worm segment posed on the cursor, and the only thing that can
// account for an empty foe roster afterwards is the respawn.
//
// Only the foe roster is read. The worms, the cursor and the lives are each
// their own point.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../constants";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseFoe,
  startPlaying,
  type Harness,
  type FoeKind,
} from "../harness";
import { poseContact } from "./contact";

/**
 * One tile per kind, all mid-board and well above the player band (rows `18` and
 * `19`, specs/board.md) so no foe is near the cursor it must not reach.
 */
const PARKED: readonly { kind: FoeKind; c: number; r: number }[] = [
  { kind: "glitch", c: 8, r: 6 },
  { kind: "dropper", c: 16, r: 4 },
  { kind: "corruptor", c: 28, r: 10 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every foe on the board, of every kind", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  poseContact(h);

  for (const { kind, c, r } of PARKED) {
    const foeId = poseFoe(h, kind, c, r);
    h.debug.setFoeMind(foeId, false);
    h.debug.setFoeTravel(foeId, false);
  }

  await h.advance(1);
  captureStill(h, "respawn");

  assertLength(h.snapshot().foes, 0, "foes on the board after the contact");
});
