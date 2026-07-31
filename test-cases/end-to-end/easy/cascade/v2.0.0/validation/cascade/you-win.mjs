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
// WHERE THE CLIP STARTS. This item is about how the cascade ENDS, but the cascade runs
// some twelve seconds before it gets there — 52 cards launch on a 0.18 s cadence, and
// the last of them has to fall and retire. Filming from the first launch spends the
// whole clip budget on the middle of the cascade and stops well short of the prompt,
// so the one thing the item exists to show never appears. The body of the cascade is
// the journey to the evidence, not the evidence.
//
// So `arrange` SKIPS it. `api.skip`/`api.skipUntil` run the same real simulation by
// exact stepping in BOTH passes — no wall clock, no filming budget, no footage — so
// the record pass reaches `act` with all 52 cards already launched and only the last
// few still in the air. `act` then films the tail in real time: the final cards
// falling and retiring, the YOU WIN prompt appearing over the painted table, and the
// click that deals a fresh game. The verdict is untouched by this — the validate pass
// was always instant, and it still runs the cascade to `done` and reads the same
// facts; skipping only decides what the clip contains.
//
// The predicate stops at a landmark the snapshot defines (`launched >= total`) rather
// than at a tick count guessed from one build's timings, so a build whose cascade is
// paced differently still lands at the same point in its own run. Should a build never
// reach it, `skipUntil` gives up at `CASCADE_DONE_MAX` having stepped the cascade out,
// and `act` still checks and films the prompt and the click — a shorter clip, never a
// wrong verdict.

import {
  actRunCascadeToDone,
  CASCADE_DONE_MAX,
  SECOND,
  ticksFor,
  winBoard,
} from "../_helpers.mjs";

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
      // Skip the body of the cascade — instantly, in both passes — so the clip opens
      // on its last moments rather than its first. Polled a tenth of a second at a
      // time: `launched` climbs on a 0.18 s cadence, so nothing finer is needed to
      // stop on the launch of the 52nd card.
      await api.skipUntil(
        (s) => Boolean(s.cascade) && s.cascade.launched >= s.cascade.total,
        { max: CASCADE_DONE_MAX, poll: SECOND / 10 },
      );
    },

    async act(api) {
      // The tail of the cascade: the last cards fall and retire, and the prompt lands.
      done = await actRunCascadeToDone(api);

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
