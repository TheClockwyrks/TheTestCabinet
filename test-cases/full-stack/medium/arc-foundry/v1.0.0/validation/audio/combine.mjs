// Automated validation for the Audio item `combine`: a combine chime plays when two
// matching pieces fold into one a tier higher (the same cue the recipe-assemble and the
// UPGRADE QUALITY / combo-upgrade paths reuse). Audio is read from the Web Audio sources
// the build starts (see `api.audio`). Two same-type, same-quality candidates are placed and
// named as the combine set; audio is armed, and the real fold is driven through the debug
// API's `combine` op — the audio log must grow across it.

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
  let climbed;
  let aId;

  return {
    id: "audio.combine",

    async arrange(api) {
      await startBuild(api);
      const a = await placeCandidate(api, "capacitor", 1, 6, 7);
      const b = await placeCandidate(api, "capacitor", 1, 10, 7);
      aId = a.id;
      await api.call("setCombineSet", [a.id, b.id]);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("combine", aId);
      await api.settle(AUDIO_SETTLE_MS);
      after = await audioCount(api);
      const at = towerAt(await api.snapshot(), 6, 7);
      climbed = Boolean(at && at.kind === "component" && at.quality === 2);
    },

    async assert(api, check) {
      check.expectOk(
        "the fold produced a tier-2 component at the initiator's footprint",
        climbed,
      );
      check.expectGt(
        "a combine chime plays on the fold (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
