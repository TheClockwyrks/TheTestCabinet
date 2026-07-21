// Automated validation for the Stock-and-waste sub-item `recycle-unlimited`.
//
// Recycling has no pass limit: the stock can be emptied and recycled again and
// again. A small stock is turned down to empty and recycled three separate times;
// each recycle must restore the full stock. The real stock code runs each pass, and
// the beats between clicks give the video output the visible turning and recycling.
//
// Those beats are `advance`, not `settle`: a stock turn resolves instantly in Cascade
// (the build's `step` is a no-op off a running cascade), so an advance moves no game
// state and is purely clip pacing — a real pause while recording, free while
// validating. Nothing here reads the canvas, so no paint settle is needed.

import { pose, someCards, ticksFor } from "../_helpers.mjs";

// The old clip beats, in ticks. Neither lands on a whole tick at 120 Hz (240 ms is
// 28.8, 320 ms is 38.4), and neither needs to: they pace a video, and the state they
// bracket is already settled when the click returns. `ticksFor` rounds to the nearest
// whole tick, which shifts each beat by under 5 ms.
const TURN_BEAT = ticksFor(240); // 29 ticks
const RECYCLE_BEAT = ticksFor(320); // 38 ticks

export default function item() {
  const count = 3;
  // The stock/waste counts after each pass's recycle, for `assert` to check.
  const passes = [];

  return {
    id: "stock.recycle-unlimited",

    async arrange(api) {
      await pose(api, { stock: someCards(count) }, 1);
    },

    async act(api) {
      for (let pass = 0; pass < 3; pass += 1) {
        // Turn the stock down to empty (one or more clicks, by deal mode).
        let guard = 0;
        while ((await api.snapshot()).stock.length > 0 && guard < 12) {
          await api.call("turnStock");
          await api.advance(TURN_BEAT);
          guard += 1;
        }
        // The empty stock recycles the whole waste back for another pass.
        await api.call("turnStock");
        await api.advance(RECYCLE_BEAT);
        const s = await api.snapshot();
        passes.push({ stock: s.stock.length, waste: s.waste.length });
      }
    },

    async assert(api, check) {
      for (let pass = 0; pass < passes.length; pass += 1) {
        check.expectEq(
          `pass ${pass + 1}: the empty stock recycled the full waste`,
          passes[pass].stock,
          count,
        );
        check.expectEq(
          `pass ${pass + 1}: the waste emptied on recycle`,
          passes[pass].waste,
          0,
        );
      }
    },
  };
}
