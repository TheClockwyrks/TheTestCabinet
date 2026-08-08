// Automated validation for quality.plain-combine-midwave: a plain COMBINE of only standing
// towers is allowed during a live wave, climbs their quality, and does NOT restart the wave.
//
// Two standing capacitors are built over two levels; the second keep launches Wave 2 (live).
// During that live wave the two standing towers are combined — the phase stays "wave", the
// result climbs a tier, and the partner hardens into a blocker.
//
// WHERE THE CLIP'S TIME WENT. Reaching a LIVE Wave 2 means Wave 1 has to end, and that clear used
// to run inside the act on `actClearWave` — real time in the record pass. A wave takes most of a
// minute to walk itself out and the recording budget is eight seconds, so the clip was almost
// entirely Wave 1 clearing, the fold landed in its closing instant, and the two seconds meant to
// show the wave carrying on afterwards were never filmed at all. A reviewer saw the setup and not
// the behavior.
//
// Wave 1 is the journey to the evidence rather than the evidence, so it moves to `arrange` on
// `skipClearWave` — the same simulation, instant in both passes, filming nothing — and so does
// Level 2's build, which only exists to put Wave 2 on the floor. The act is then all three parts
// of the claim, in proportion: a live wave running, the two standing towers folding into one, and
// the wave visibly carrying on past it.

import { startBuild, placeCandidate, towerAt, snap, skipClearWave, SECOND } from "../_helpers.mjs";

// A beat on the live wave BEFORE the fold, so the two standing towers and the running Load are on
// screen as the state the fold happens during.
const LEAD_TICKS = 2 * SECOND;
// After the fold, long enough for the still-live wave to visibly keep running — that is what
// "without restarting the wave" looks like on screen. This is the half of the clip the item is
// actually about, so it gets the larger share.
const CLIP_TICKS = 4 * SECOND;

export default function item() {
  // The initiator, the board when Wave 2 went live, and the board after the mid-wave fold.
  let aId;
  let bId;
  let live;
  let s;

  return {
    id: "quality.plain-combine-midwave",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);

      const a = await placeCandidate(api, "capacitor", 3, 2, 7);
      aId = a.id;
      await api.call("keep", a.id); // Wave 1
      await skipClearWave(api, { maxTicks: 300 * SECOND }); // instant in both passes, films nothing

      const b = await placeCandidate(api, "capacitor", 3, 6, 7);
      bId = b.id;
      await api.call("keep", b.id); // Wave 2 — now LIVE
      live = await snap(api);
    },

    async act(api) {
      await api.advance(LEAD_TICKS); // the live wave running, with both towers standing

      // Combine the two STANDING towers during the live wave.
      await api.call("setCombineSet", [aId, bId]);
      await api.call("combine", aId);
      s = await snap(api);

      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectEq("a wave is live", live.phase, "wave");
      check.expectEq("the standing combine produced a higher tier", towerAt(s, 2, 7).quality, 4);
      check.expectEq("...without restarting the wave (still live)", s.phase, "wave");
      check.expectEq("the partner hardened into a blocker", towerAt(s, 6, 7).kind, "blocker");
    },
  };
}
