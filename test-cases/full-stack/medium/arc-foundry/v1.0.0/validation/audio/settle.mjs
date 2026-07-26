// Automated validation for the Audio item `settle`: a rock-settle thunk plays when a
// structure hardens in place — `sim.ts`'s `removeStructure` (a build-phase dismantle, the
// debug API's `dismantle` op) pushes the same cue a level's leftover candidates get when the
// harvest hardens them into blockers. Audio is read from the Web Audio sources the build
// starts (see `api.audio`). A candidate is placed, audio is armed, and the real dismantle is
// driven — the audio log must grow across it.

import {
  startBuild,
  placeCandidate,
  towerAt,
  armAudio,
  audioCount,
  AUDIO_SETTLE_MS,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let removed;
  let candId;

  return {
    id: "audio.settle",

    async arrange(api) {
      await startBuild(api);
      const cand = await placeCandidate(api, "capacitor", 1, 6, 7);
      candId = cand.id;
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("dismantle", candId);
      await api.settle(AUDIO_SETTLE_MS);
      after = await audioCount(api);
      removed = towerAt(await api.snapshot(), 6, 7) == null;
    },

    async assert(api, check) {
      check.expectOk(
        "the candidate's footprint is cleared by the dismantle",
        removed,
      );
      check.expectGt(
        "a rock-settle thunk plays on the dismantle (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
