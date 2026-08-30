// progression/respawn-clears-worms — a lost life sweeps every worm off the board.
//
// specs/progression.md, Losing a life: on a contact with lives to spare, every
// worm, every foe, and every bolt in flight is removed from the board. EVERY
// worm — not merely the one that reached the cursor — so the board is posed with
// two: the one standing on the cursor, and one well away from it, out of the
// player band entirely. A build that removes only what touched it leaves that
// second worm behind and reads `1`.
//
// Both are posed with their step gated off, so neither can wander into or out of
// the scenario while the frame runs: what the roster holds afterwards is decided
// by the respawn alone.
//
// Only the roster is read. Lives, the cursor's placement and the phase timer are
// each their own point, so a build that sweeps the board and mishandles one of
// those is docked on that one.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../../src/constants";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { poseContact } from "./contact";

/**
 * The tile the bystanding worm stands on: mid-board, well above the player band
 * (rows `18` and `19`, specs/board.md), so it is nowhere near the contact and
 * nothing but the respawn can account for its removal.
 */
const AWAY_C = 8;
const AWAY_R = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every worm on the board, not only the one that touched", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  poseContact(h);

  const awayId = poseWorm(h, AWAY_C, AWAY_R);
  h.debug.setWormStepping(awayId, false);

  await h.advance(1);
  captureStill(h, "respawn");

  assertLength(h.snapshot().worms, 0, "worms on the board after the contact");
});
