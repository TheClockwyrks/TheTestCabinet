// Automated validation for the Modes sub-item `hundred`.
//
// The Hundred starts with its own economy and runs a single 100-unit onslaught rather
// than a scaling wave schedule (specs/modes.md — 600 money, 20 lives, one wave). We
// start it, read the economy, and release the onslaught.

import { newGame, TICK } from "../_helpers.mjs";

export default function item() {
  let s;
  let r;

  return {
    id: "modes.hundred",

    // The mode's own opening economy is read before anything is posed over it, then
    // lives are raised so the onslaught cannot end the run under the check.
    async arrange(api) {
      s = await newGame(api, "hundred");
      await api.call("setLives", 1000000);
      await api.call("startWave");
    },

    // 360 ticks = the old 6s cap; polling every tick catches the onslaught the moment
    // it starts releasing surge.
    async act(api) {
      r = await api.until((t) => t.phase === "wave" && t.surge.length > 0, {
        max: 360,
        poll: TICK,
      });
    },

    async assert(api, check) {
      check.expectEq("The Hundred starts with 600 money", s.money, 600);
      check.expectEq("The Hundred starts with 20 lives", s.lives, 20);
      check.expectEq("The Hundred is a single wave", s.waveCount, 1);
      check.expectEq("its mode reads as The Hundred", s.mode, "hundred");
      check.expectOk("the onslaught releases surge", r.hit);
    },
  };
}
