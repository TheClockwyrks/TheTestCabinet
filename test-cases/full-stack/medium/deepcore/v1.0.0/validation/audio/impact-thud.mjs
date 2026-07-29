// Automated validation for audio.impact-thud: an impact thud plays via Web Audio on an impact
// event. Audio is read from the Web Audio sources the build starts (see `api.audio`).
//
// The trigger driven here is a HARD LANDING, because that is the one the seeded specification
// names: specs/assets.md lists the cue as "an impact thud (hard landing)". This item used to drive
// a jettison instead — picked because it is a single instant control op and so the cleanest thing
// to measure — but a jettison is nowhere in the spec's description of the cue. A build that plays
// the thud on a hard landing and only on a hard landing has done exactly what it was told, and was
// being failed for it. The model can only implement the spec it was given, so the check has to ask
// for what the spec asks for.
//
// The landing is arranged the way hazards.fall-impact arranges its slam: a long open shaft with a
// floor at the bottom and hull enough to survive it, so the real fall/impact path produces the
// event rather than anything faking it.

import {
  teleportInto,
  newRun,
  openColumn,
  solid,
  SPAWN_COL,
  TOPSOIL_ROW,
  armAudio,
  audioCount,
  awaitCue,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let before;
  let after;
  let hull0;
  let r;

  return {
    id: "audio.impact-thud",

    // Poised at the top of a long open plunge, hulled up so the slam is survivable.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await openColumn(api, col, row + 1, row + 12); // a long open plunge
      await solid(api, col, row + 13);
      await api.call("grantGear", { hull: 5 }); // survive the slam
      hull0 = (await api.snapshot()).miner.hull;
      await armAudio(api);
    },

    // The plunge and the landing it ends in are the event under test, and the clip shows exactly
    // that: the miner falling, then hitting the floor hard enough to cost hull.
    async act(api) {
      before = await audioCount(api);
      // 180 ticks = 3 s cap; poll 3 keeps the sweep fine enough to stop ON the landing rather than
      // well after it.
      r = await api.until((s) => s.miner.grounded && s.miner.row > row + 5, {
        max: 180,
        poll: 3,
      });
      after = await awaitCue(api, before, { max: 1000 });
    },

    async assert(api, check) {
      check.expectOk("the miner landed after the plunge", r.hit);
      check.expectGt(
        "the landing was hard enough to be an impact",
        hull0 - r.snap.miner.hull,
        10,
      );
      check.expectGt(
        "an impact-thud cue plays on the hard landing (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
