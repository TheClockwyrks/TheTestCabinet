// Automated validation for the Audio item `build`: a distinct cue plays when a tower
// is placed (specs/assets.md: "the build cue on a placed tower"). Audio is read from
// the Web Audio sources the build starts (see `api.audio`). Audio is armed with a
// real gesture first, then a real tower is placed beside a lane through the real
// placement path (the same `placeCovering` helper `placement.free` uses). The audio
// log must grow across the placement.

import {
  startRun,
  pathGeom,
  placeCovering,
  towerById,
  armAudio,
  audioCount,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let g;
  let before;
  let after;
  let t;
  let snap;

  return {
    id: "audio.build",

    async arrange(api) {
      const s = await startRun(api, MAP.single);
      g = pathGeom(s.paths[0]);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      t = await placeCovering(api, "emitter", g, g.length * 0.18);
      // The build cue is queued the instant placement succeeds, but it is only
      // PLAYED (and so only shows up in `api.audio`) once a real animation frame
      // drains the queue (main.ts's `frame`, not the manual sim clock) — unlike the
      // other cue checks, placement itself consumes no simulation time, so nothing
      // else here guarantees a frame has landed yet. A short real settle does.
      await api.settle(100);
      after = await audioCount(api);
      snap = await api.snapshot();
      await api.advance(30); // a short tail so the clip shows the placement
    },

    async assert(api, check) {
      check.expectOk(
        "the placed tower exists in the game state",
        towerById(snap, t.id) !== null,
      );
      check.expectGt(
        "a build cue plays on placement (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
