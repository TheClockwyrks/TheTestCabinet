// Automated validation for the Audio item `settle`: a rock-settle thunk plays when a structure
// hardens in place. Audio is read from the Web Audio sources the build starts (see `api.audio`).
//
// WHAT DRIVES THE CUE. `specs/assets.md` names exactly one occasion for this sound: "a
// rock-settle thunk (unkept rocks hardening into blockers)" — the harvest, when every candidate
// the player did not keep turns into an inert wall. This script used to drive it with a
// build-phase DISMANTLE instead, which is a different event that the seeded specification never
// attaches this cue to. It worked against the reference build only because that build happens
// to route its dismantle through the same code path that hardens leftovers, which is an
// implementation detail and not something a conformant build owes.
//
// So the cue is driven the way the spec describes it: three candidates are placed, one is kept,
// and the other two harden. The audio log must grow across that harvest.

import {
  startBuild,
  placeCandidate,
  towerAt,
  armAudio,
  audioCount,
  waitForAudio,
  SECOND,
} from "../_helpers.mjs";

// A beat after the harvest so the hardening is watchable rather than a single frame.
const WATCH_TICKS = 2 * SECOND;

export default function item() {
  let before;
  let after;
  let keptId;
  let hardened;

  return {
    id: "audio.settle",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);
      const kept = await placeCandidate(api, "capacitor", 1, 12, 7);
      await placeCandidate(api, "capacitor", 1, 16, 7);
      await placeCandidate(api, "capacitor", 1, 20, 7);
      keptId = kept.id;
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);

      // The harvest: the kept candidate becomes a firing component and every other candidate
      // hardens into a blocker (`specs/build.md`).
      await api.call("keep", keptId);
      after = await waitForAudio(api, before);

      const s = await api.snapshot();
      hardened =
        towerAt(s, 16, 7)?.kind === "blocker" && towerAt(s, 20, 7)?.kind === "blocker";

      await api.advance(WATCH_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the unkept candidates hardened into blockers", hardened);
      check.expectGt(
        "a rock-settle thunk plays as they harden (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
