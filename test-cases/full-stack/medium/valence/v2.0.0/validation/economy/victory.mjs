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

import { BOSS_BATTERY } from "../boss/_boss.mjs";
import {
  startRun,
  pathGeom,
  battery,
  clipBudget,
  TAIL_TICKS,
  MAP,
  HUGE_ENERGY,
  HUGE_INTEGRITY,
  TOTAL_ROUNDS,
} from "../_helpers.mjs";

// The same Impactor line the boss items use, and for the same reason: six towers is about
// 360 damage against a boss that is 312 before a single fragment of its 55-step fission
// chain is counted, so the margin was never there. See the arithmetic in `boss/_boss.mjs`.
// Sharing the constant keeps this item and the boss items from drifting apart.
const FROM = 0.08; // the stretch it holds, as a fraction of the conduit's length
const TO = 0.92;
// Generous game time for the boss, its 55-step fission chain, and every fragment to resolve.
const MAX_ROUND_TICKS = 36000;
// WHERE THE INSTANT SKIP STOPS, so the recording picks up the end of the campaign rather
// than the middle of it.
//
// A unit COUNT cannot say where the end is on this round, and two different attempts to
// make it say so both failed. Round 40 is a single Macromass (specs/matter.md), so the
// board holds exactly one unit from the moment the round starts and any small-count test is
// satisfied on its very first sample. Requiring the board to have "peaked" above a
// threshold first does not fix it either: the boss sheds its 55-step fission chain a step at
// a time, so between one shed and the next the board legitimately falls back to two units —
// and the skip stopped there, mid-fight, with the boss still on 87 of its 132 shells.
//
// What actually marks the end is the BOSS being gone. The round is the boss and everything
// it sheds, so once the Macromass itself is off the board the only thing left is the tail of
// its chain being cleaned up — which is the part worth filming.
const NEARLY_CLEAR = 3;
// Game time allowed for those last fragments and the round's resolution. Generous, because
// it decides the VERDICT; how much of it reaches the recording is capped separately by
// `clipMs`, and the validate pass has no filming budget at all.
const RESOLVE_TICKS = 2400;
// How much of that resolution is actually filmed.
const FILMED_TICKS = 600;

export default function item() {
  let snap;

  return {
    id: "economy.victory",

    clipMs: clipBudget(FILMED_TICKS + TAIL_TICKS),

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
        BOSS_BATTERY,
      );
      for (const t of placed) {
        await api.call("upgradeTower", t.id); // -> tier II
        await api.call("upgradeTower", t.id, "B"); // -> tier III IMPACTOR (heavy specialist)
      }
      await api.call("startRound");

      // The final round playing itself out on the real systems, stepped instantly — but
      // stopped SHORT of the resolution, when the board is nearly clear. What is skipped is
      // the long grind; what is left for `act` to film is the end of the campaign.
      //
      // poll 60 = one second of game time, coarse because nothing read here changes between
      // the boss being cracked and the last fragments falling.
      let sawBoss = false;
      await api.skipUntil(
        (s) => {
          const boss = s.matter.some((u) => u.type === "macromass");
          if (boss) sawBoss = true;
          if (s.phase === "build" || s.screen !== "playing") return true;
          // The boss cracked all the way down, and its chain nearly cleaned up.
          return sawBoss && !boss && s.matter.length <= NEARLY_CLEAR;
        },
        { max: MAX_ROUND_TICKS, poll: 60 },
      );
    },

    // The campaign's resolution, which is the whole of what this item shows — now as a
    // PLAYBACK. A still of the victory screen is a picture of a screen; it says nothing
    // about the round that earned it. This films the last of the board being cleared, the
    // round resolving, and the win screen arriving.
    async act(api) {
      const resolved = await api.until(
        (s) => s.phase === "build" || s.screen !== "playing",
        { max: RESOLVE_TICKS, poll: 30 },
      );
      // `settle` is a real repaint pause in both passes, so the victory screen has actually
      // PAINTED before it is read.
      await api.settle(200);
      snap = resolved.hit ? await api.snapshot() : resolved.snap;
      // Held on the win.
      await api.advance(TAIL_TICKS);
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
