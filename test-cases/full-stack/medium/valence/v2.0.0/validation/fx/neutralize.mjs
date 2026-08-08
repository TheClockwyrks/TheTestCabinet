// Automated validation for the FX sub-item `neutralize`.
//
// A produced particle burst fires when a unit is neutralized. The check poses a
// 1-electron atom under an Emitter (one hit neutralizes it) and runs on until a
// "neutralize" burst appears in the live effects list.

import {
  coverAndPassThrough,
  clipBudget,
  LEAD_TICKS,
  TICK,
} from "../_helpers.mjs";

// The clip used to cut on the frame the burst first appeared, which shows a burst starting
// and never playing. A produced particle system is SIMULATED (specs/assets.md), so a reviewer
// judging it needs to watch it play out on the now-empty conduit.
//
// FOUR ELECTRONS, NOT ONE. The atom used to be a single-shell one, which an Emitter destroys
// with its first shot — so the neutralize burst happened within half a second of the clip
// opening, before a reviewer had registered what they were looking at. Four shells is four
// shots: the recording shows the atom visibly worn down and THEN destroyed, which is both a
// better before and a fairer test, since the burst has to fire on the shot that empties the
// unit rather than on any hit.
//
// Not six, which is as many as an atom can carry. Six shots at 1.8/s is 3.3 s and a single
// Emitter's coverage window is under three, so a six-shell atom is stripped to its LAST
// shell and then walks out of range alive — the item would be waiting for a kill that
// conformant fire never delivers.
const TAIL_TICKS = 120;
// The atom starts outside the tower's reach and walks in, so the lead-in does not eat the
// coverage window the burst has to happen inside of.
const APPROACH_PX = 90;
const MAX_BURST_TICKS = 300; // 5 s — four Emitter shots at 1.8/s, with room to spare

export default function item() {
  let r;

  return {
    id: "fx.neutralize",

    clipMs: clipBudget(LEAD_TICKS + MAX_BURST_TICKS + TAIL_TICKS),

    async arrange(api) {
      await coverAndPassThrough(api, {
        kind: "emitter",
        type: "atom",
        electrons: 4,
        approachPx: APPROACH_PX,
      });
    },

    // The single shot that neutralizes the atom, and the burst it fires.
    async act(api) {
      // The unit travelling in, before anything has hit it. Posed at the tower's own
      // covering point the first shot landed almost on the opening frame, so the burst this
      // item exists to show had already happened by the time the recording began — "the
      // event is happening before playback starts". From the upstream edge of the tower's
      // range there is a run-up to watch first.
      await api.advance(LEAD_TICKS);
      // 180 ticks = the old 3 s cap. The old poll of 0.02 s is 1.2 ticks, which the
      // contract refuses; it meant "sample as finely as possible", and one TICK is the
      // finest there is — a burst is short-lived and must not be polled past.
      r = await api.until(
        (s) => s.effects.some((e) => e.kind === "neutralize"),
        {
          max: MAX_BURST_TICKS,
          poll: TICK,
        },
      );
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a neutralize burst fires when a unit is killed", r.hit);
    },
  };
}
