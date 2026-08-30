// audio/music-stops-when-the-round-ends — the bed is not playing once the round
// it was under has ended.
//
// WHAT THE SPECIFICATION FIXES. `specs/ui.md`, of the `music` bed: it "loops
// under the round it began with... Once the round has ended the bed is not
// playing, so a player who dies, clears the board, or leaves the round for the
// title hears no bed on the screen they land on". `specs/movement.md` ends a
// round when the head enters a fatal cell, and `specs/ui.md` makes `gameover`
// the screen that ending reaches.
//
// WHY THE ROUND IS BEGUN AND ENDED FOR REAL. Both halves of this scenario are
// things `specs/instrumentation.md` says a pose is NOT. A round only begins when
// a menu accepts its entry, so the bed only gets under a round that way; and a
// posed `gameover` screen is not a round that ended, so a build that stops the
// bed at the ending itself rather than reconciling the screen every frame would
// be failed by a posed ending for a design the specification never ruled out.
// The round is therefore started from the title and killed by letting the chain
// run into the wall it already faces.
//
// WHAT IS ASSERTED, IN ONE DIRECTION. That no `music` loop is sounding once the
// round has ended. That the bed sounds under a round at all belongs to
// `music-cue-plays`, and that it sounds again for each fresh round to the two
// `music-restarts-on-*` points; a build with no music whatever loses those and
// passes this, which is what one requirement per point means. The bed under a
// PAUSE is the same rule's other side and is not read here, since a pause has
// not ended the round.
//
// THE TOLERANCE. A few ticks are driven past the ending before the reading is
// taken, so a build that retires the bed on the frame after the one the ending
// landed on is not failed for a difference no player can hear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  startRoundWithKeys,
  type Harness,
} from "../harness";

/** Ticks of the round driven before the ending, so the bed is under real play. */
const ROUND_TICKS = 8;

/** How far the round is driven looking for the wall the chain is heading into. */
const DEATH_TICKS = 60;

/** Ticks driven on the ended round, past any one-frame lag in retiring the bed. */
const SETTLE_TICKS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves no music playing once the round has ended", async () => {
  await startRoundWithKeys(h);
  await h.tick(ROUND_TICKS);

  const ended = await captureReplay(h, "ended", async () => {
    // The starting chain faces `right`, so it reaches the right-hand wall on its
    // own: nothing is steered and nothing is posed, and the ending is the build's.
    const dead = await h.until((s) => s.screen === "gameover", {
      maxTicks: DEATH_TICKS,
    });
    await h.tick(SETTLE_TICKS);
    return dead;
  });

  assertEqual(ended.hit, true, "a round driven into the wall reached gameover");
  assertEqual(
    h.looping(CUES.music),
    false,
    `whether the music bed was still looping ${SETTLE_TICKS} ticks after the round ended`,
  );
});
