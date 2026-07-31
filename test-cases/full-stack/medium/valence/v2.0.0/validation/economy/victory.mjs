// Automated validation for the Economy sub-item `victory`.
//
// Clearing the final round of the campaign with integrity intact wins the game
// (specs/gameplay.md: "Clearing the final round (Round 40) with integrity remaining wins the
// game"). The check opens a run on round 40 — the lone Macromass — holds the conduit with a
// line of tier-III Impactor Cleavers so the boss and its fission chain are actually cracked
// down, starts the real round, and lets it play out to the campaign's own resolution.
//
// The whole round is travelled with `api.skipUntil`, which runs the same real simulation but
// steps it instantly in BOTH passes. That matters twice over. Round 40 is one unit at 28 px/s
// plus everything it sheds, so it is a long round however it is defended, and this item's
// only declared output is a STILL of the victory screen — there is no clip to pace, so
// nothing is gained by living through the round in real time, and the capture can never be
// what decides whether the screen was reached. The previous shape did live through it: it
// crammed 24 towers into the opening 22% of the conduit to crack the boss at the inlet and
// then raced the round at 3x against the record pass's filming budget. Twenty-four towers
// cannot be placed in that little conduit — a tower has a real footprint and has to sit clear
// of the path and of its neighbours (specs/board.md) — so on a conformant board the battery
// ran out of legal spots and the item reported "precondition not satisfiable" instead of a
// verdict. The line below is spread along the whole conduit, which is the same arrangement
// the boss items use, and integrity stays huge throughout so nothing here can resolve to
// anything but the win.

import {
  startRun,
  pathGeom,
  battery,
  MAP,
  HUGE_ENERGY,
  HUGE_INTEGRITY,
  TOTAL_ROUNDS,
} from "../_helpers.mjs";

const TOWERS = 6; // an Impactor line along the conduit, spread so every one has a legal spot
const FROM = 0.08; // the stretch it holds, as a fraction of the conduit's length
const TO = 0.92;
// Generous game time for the boss, its 55-step fission chain, and every fragment to resolve.
const MAX_ROUND_TICKS = 36000;

export default function item() {
  let snap;

  return {
    id: "economy.victory",

    async arrange(api) {
      const run = await startRun(api, MAP.single, {
        round: TOTAL_ROUNDS,
        energy: HUGE_ENERGY,
        integrity: HUGE_INTEGRITY,
      });
      const g = pathGeom(run.paths[0]);
      const placed = await battery(
        api,
        "cleaver",
        g,
        g.length * FROM,
        g.length * TO,
        TOWERS,
      );
      for (const t of placed) {
        await api.call("upgradeTower", t.id); // -> tier II
        await api.call("upgradeTower", t.id, "B"); // -> tier III IMPACTOR (heavy specialist)
      }
      await api.call("startRound");

      // The final round playing itself out on the real systems, stepped instantly. poll 60
      // = one second of game time, coarse because nothing read at the resolution changes
      // between the boss being cracked and the round ending.
      await api.skipUntil(
        (s) => s.phase === "build" || s.screen !== "playing",
        { max: MAX_ROUND_TICKS, poll: 60 },
      );
    },

    // The campaign's resolution, which is the whole of what this item shows. `settle` is a
    // real repaint pause in both passes, so the victory screen has actually PAINTED before
    // it is read and captured.
    async act(api) {
      await api.settle(200);
      snap = await api.snapshot();
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectEq(
        "the final round resolved (the campaign is over)",
        snap.result,
        "victory",
      );
      check.expectEq(
        "clearing the final round wins the game",
        snap.screen,
        "victory",
      );
      check.expectGt("...with integrity remaining", snap.integrity, 0);
    },
  };
}
