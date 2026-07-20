// Automated validation for the Victory-cascade sub-item `you-win`.
//
// The cascade ends with a YOU WIN prompt, and a click starts a fresh game (specs/
// victory.md, specs/states.md). The cascade is run to completion, the win prompt state
// is read back, and then a real click (injected pointer input) is confirmed to deal a
// new game. The advances between those steps hold the video output on the prompt and
// then on the new deal.
//
// UNITS: those holds are clip pacing, in ticks — 1400 ms is 168 ticks and 700 ms is 84,
// both exact at 120 Hz. They are `advance` rather than `settle` because nothing here
// reads the canvas; on the won screen an advance also keeps the cascade's own clock
// moving, which is what the prompt is drawn over.
//
// The full cascade is longer than the 8 s filming budget, so the record pass is cut
// short during it and never reaches the click — expected, and correct: the verdict
// comes from the uncapped validate pass, and the opening of the cascade is what the
// clip is for. No image output is declared here, so nothing is lost.

import { actRunCascadeToDone, ticksFor, winBoard } from "../_helpers.mjs";

const PROMPT_HOLD = ticksFor(1400); // 168 ticks — hold on the YOU WIN prompt
const DEAL_HOLD = ticksFor(700); // 84 ticks — hold on the fresh deal

export default function item() {
  // The completed cascade, and the board after the click that restarts.
  let done;
  let after;

  return {
    id: "cascade.you-win",

    async arrange(api) {
      await winBoard(api, 13);
    },

    async act(api) {
      done = await actRunCascadeToDone(api); // run the whole cascade to completion

      await api.advance(PROMPT_HOLD);

      // A click starts a fresh game.
      await api.call("click", 640, 360);
      after = await api.snapshot();

      await api.advance(DEAL_HOLD);
    },

    async assert(api, check) {
      check.expectEq("the cascade completed", done.cascade.done, true);
      check.expectEq(
        "the YOU WIN prompt is showing",
        done.cascade.youWin,
        true,
      );
      check.expectEq("still on the won screen", done.screen, "won");

      check.expectEq("a click starts a new game", after.screen, "playing");
      check.expectEq(
        "a fresh game is dealt (24 in the stock)",
        after.stock.length,
        24,
      );
    },
  };
}
