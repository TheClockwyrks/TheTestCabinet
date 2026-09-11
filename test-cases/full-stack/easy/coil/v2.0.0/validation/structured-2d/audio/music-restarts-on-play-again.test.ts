// audio/music-restarts-on-play-again — the round PLAY AGAIN lays out has the bed
// under it.
//
// WHAT THE SPECIFICATION FIXES. `specs/ui.md` plays `music` when "a round
// begins" and has the bed "loop under the round it began with", and of the
// game-over menu: "`confirm` on `PLAY AGAIN` starts a fresh round in the same
// mode." It names this path outright: "A round laid out by `RESTART` or by
// `PLAY AGAIN` is a round beginning, so the bed sounds under it."
//
// WHY THIS PATH IS ITS OWN POINT. `music-cue-plays` decides the title path only:
// it watches a bed start on the first round of a session. A build can sound the
// bed from the one entry point it wrote and leave every later entry silent, and a
// player who dies and plays again spends the rest of the session with no music.
// That is a different observable behaviour, so it is a different point.
//
// WHY THE DEATH IS DRIVEN FOR REAL. The point is about a round beginning after a
// round ENDED, and a posed `gameover` screen is not a round that ended: the bed
// may never have been running under it. So the first round is begun from the
// title, killed by steering the head into a wall, and the game over is the one
// the build itself reached.
//
// WHAT IS SOUNDING IS READ, NOT WHAT WAS ASKED FOR. `specs/ui.md` has the bed
// stopped once a round has ended, so under a build that obeys it the bed beneath
// the round PLAY AGAIN lays is one that started again. What is read is the bed
// SOUNDING rather than the moment it was asked for, which is the reading
// `music-restarts-on-pause-restart` sets out in full and the one a player has. A
// build that left the old bed running is failing
// `music-stops-when-the-round-ends` and is not charged for it twice here.
//
// WHAT IS ASSERTED. That the fresh round was actually laid — a build that merely
// returned to `playing` has not begun a round and is failing
// `states/gameover-play-again` rather than this — and that the music bed is
// sounding under that round once it has run for a few ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS, CUES, START_CELLS } from "../constants";
import {
  captureReplay,
  createHarness,
  startRoundWithKeys,
  type Harness,
} from "../harness";

/** `PLAY AGAIN` is the first item of `OVER_ITEMS` (specs/ui.md). */
const PLAY_AGAIN_INDEX = 0;

/**
 * Ticks driven after the fresh round begins, so the clip holds play and a
 * build that starts its bed a frame into the round has started it.
 */
const ROUND_TICKS = 8;

/** How far the round is driven looking for the wall the head is steered into. */
const DEATH_TICKS = 60;

/** The first key `specs/controls.md` binds to `confirm`. */
const CONFIRM = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the music bed under the round PLAY AGAIN lays out", async () => {
  await startRoundWithKeys(h);

  // The starting chain faces `right`, so it reaches the right-hand wall on its
  // own: nothing is steered and nothing is posed, and the ending is the build's.
  const dead = await h.until((s) => s.screen === "gameover", {
    maxTicks: DEATH_TICKS,
  });
  assertEqual(dead.hit, true, "a round driven into the wall reached gameover");
  assertEqual(
    dead.snapshot.menuIndex,
    PLAY_AGAIN_INDEX,
    "the item highlighted when the game over arrived",
  );

  const fresh = await captureReplay(h, "again", async () => {
    await h.tap(CONFIRM);
    const begun = h.snapshot();
    await h.tick(ROUND_TICKS);
    return begun;
  });

  assertEqual(fresh.screen, "playing", "the screen PLAY AGAIN opened");
  assertDeepEqual(
    fresh.snake,
    START_CELLS,
    "the chain the fresh round opens on",
  );
  assertEqual(
    h.looping(CUES.music),
    true,
    `whether the bed was sounding ${ROUND_TICKS} ticks into the fresh round`,
  );
});
