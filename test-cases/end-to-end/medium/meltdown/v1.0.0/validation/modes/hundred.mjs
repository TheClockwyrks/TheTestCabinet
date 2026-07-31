// Automated validation for the Modes sub-item `hundred`.
//
// The Hundred starts with its own economy and runs a single 100-unit onslaught rather
// than a scaling wave schedule (specs/modes.md — 600 money, 20 lives, one wave). We
// start it, read the economy, and release the onslaught.

import { newGame, TICK, actTail } from "../_helpers.mjs";

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
    // The sweep normally returns on its very first sample: `arrange` has already sent
    // the wave, so the phase is right and the first units are on the floor before any
    // time is asked for. That left the item filming nothing — the recording was over
    // before the build's first paint, and the clip was a second of the browser's blank
    // white page. The beat afterwards is what gives the Hundred's wave frames to be
    // seen in.
    async act(api) {
      r = await api.until((t) => t.phase === "wave" && t.surge.length > 0, {
        max: 360,
        poll: TICK,
      });
      await actTail(api, 180); // 3 s of the wave this mode opens with
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
