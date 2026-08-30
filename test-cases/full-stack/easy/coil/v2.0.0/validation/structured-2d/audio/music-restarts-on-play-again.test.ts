// audio/music-restarts-on-play-again — PLAY AGAIN from the game over starts the
// bed again.
//
// specs/ui.md fixes the event: `music` plays when "a round begins. It loops under
// the game until the round ends." And of the game-over menu: "`confirm` on `PLAY
// AGAIN` starts a fresh round in the same mode." A fresh round beginning is a
// round beginning, so the bed sounds for it.
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
// WHAT IS ASSERTED. That the fresh round was actually laid — a build that merely
// returned to `playing` has not begun a round and is failing
// `states/gameover-play-again` rather than this — and that a `music` cue was
// asked for from the moment PLAY AGAIN was confirmed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { BINDINGS, CUES, START_CELLS } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  cuesNamed,
  startRoundWithKeys,
  watchCues,
  type Harness,
} from "../harness";

/** `PLAY AGAIN` is the first item of `OVER_ITEMS` (specs/ui.md). */
const PLAY_AGAIN_INDEX = 0;

/** Ticks driven after the fresh round begins, so the clip holds play. */
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

it("asks for the music cue again on the round PLAY AGAIN lays out", async () => {
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

  // Opened after the ending, so what it holds is the fresh round's own cues.
  const cues = watchCues(h);

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
  assertGreaterThanOrEqual(
    cuesNamed(cues, CUES.music).length,
    1,
    "music cues sounded from PLAY AGAIN onward",
  );
});
