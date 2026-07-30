// Automated validation for the Audio item `leak-alarm`: a distinct cue plays when a
// unit reaches the collector and leaks (specs/assets.md: "the alarm on a leak"). Audio
// is read from the Web Audio sources the build starts (see `api.audio`). Audio is
// armed with a real gesture first, then a real unit is posed just short of the
// collector — the same set-up `maps.leak-at-collector` uses — and the sim runs on
// until it reaches the collector and is removed. The audio log must grow across the
// leak.

import {
  startRun,
  pathGeom,
  spawnAt,
  unitById,
  armAudio,
  audioCount,
  audioCountAbove,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let before;
  let after;
  let leaked;

  return {
    id: "audio.leak-alarm",

    async arrange(api) {
      const snap = await startRun(api, MAP.single, { integrity: 100000 });
      const g = pathGeom(snap.paths[0]);
      id = await spawnAt(api, {
        type: "atom",
        electrons: 3,
        pathId: 0,
        s: g.length - 25,
      });
      await armAudio(api);
    },

    // The unit covering the last stretch and leaking at the collector.
    async act(api) {
      before = await audioCount(api);
      // 240 ticks = the maps.leak-at-collector cap; poll 6 = its 0.1 s chunk.
      const r = await api.until((s) => unitById(s, id) === null, {
        max: 240,
        poll: 6,
      });
      after = await audioCountAbove(api, before);
      leaked = r.hit;
      await api.advance(30); // a short tail so the clip shows the leak
    },

    async assert(api, check) {
      check.expectOk("the unit reaches the collector and is removed", leaked);
      check.expectGt(
        "an alarm cue plays on the leak (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
