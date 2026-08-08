// Automated validation for core-run.detonation-death.
//
// If the countdown reaches zero while carrying the Sample it detonates, killing the miner. We
// extract the Sample and run the real sim past the 90-second timer, confirming the core-detonation
// Game Over.

import { newRun } from "../_helpers.mjs";

/**
 * How much of the 90-second countdown to skip past before filming, in ticks.
 *
 * `specs/hazards.md` fixes the destabilization timer at `90` seconds, so 5280 ticks (88 s) is an
 * exact landing two seconds short of zero — no sweeping required.
 *
 * It matters that this is ONE call and not a polled `skipUntil`. The record pass films the whole
 * pass, `arrange` included (the driver opens a fresh browser context per pass and the recording is
 * scoped to it), and while a skip costs no SIMULATION time it still costs a driver round trip per
 * step. Sweeping the countdown down in half-second polls is ~180 of those, and the build renders
 * throughout, so the clip opens with several seconds of the timer visibly racing from 1:30 — the
 * fast-forward this was meant to avoid. One exact skip is one round trip and shows none of it.
 */
const SKIP_TICKS = 5280;

export default function item() {
  let snap;

  return {
    id: "core-run.detonation-death",

    // Extract the Sample, then SKIP the countdown down to its last couple of seconds.
    //
    // `skipUntil` runs the same real simulation, but instantly in both passes, so the run reaches
    // the brink of the detonation with nothing filmed on the way. That is what makes a clip of this
    // item possible at all — see the note on `act`.
    async arrange(api) {
      await newRun(api);
      await api.call("spawnCoreSample");
      await api.skip(SKIP_TICKS);
    },

    // Film only the end of the countdown and the detonation it ends in.
    //
    // This used to be a single `api.advance(5520)` — 92 s — and that produced a BLANK clip, not a
    // long one. The record pass charges a call against its filming budget BEFORE it waits, so a
    // single request for 92 s of real time overruns the 8 s budget on the spot and unwinds out of
    // `act` without ever pausing: nothing was filmed, and the committed baseline was 0.96 s of the
    // browser's opening white frames. A long `advance` is not "a clip that gets truncated", it is
    // no clip at all. The countdown is skipped in `arrange` instead, and what runs here is the last
    // couple of seconds — the timer visibly reaching zero, the detonation, and the Game Over it
    // ends at, which is the whole of what this item claims.
    async act(api) {
      // 600 ticks = 10 s, generous room for the last seconds of the countdown plus whatever death
      // animation a build plays; `specs/hazards.md` bounds neither.
      const r = await api.until((s) => s.screen === "game-over", {
        max: 600,
        poll: 6,
      });
      snap = r.snap;
      await api.advance(90); // 90 ticks = 1.5 s resting on the Game Over screen and its summary
    },

    async assert(api, check) {
      check.expectEq("the timer expiry ends the run", snap.screen, "game-over");
      check.expectEq(
        "the death cause is a core detonation",
        snap.summary ? snap.summary.deathCause : null,
        "core-detonation",
      );
    },
  };
}
