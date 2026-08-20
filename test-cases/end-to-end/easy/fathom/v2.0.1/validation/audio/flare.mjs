// Automated validation for the Audio item `flare`: a cue plays when the Flarefish emits
// its flare (its only tell, specs/predators.md). Audio is read from the Web Audio
// sources the build starts (see `api.audio`). Every other predator is denned so only the
// Flarefish is active, and it is placed far from the forager (see
// flarefish/flare-cadence.mjs) so it wanders and flares harmlessly on its own ~7 s
// cadence; audio is armed with a real gesture, and the log must grow the instant the
// bloom begins.

import {
  FLARE_RADIUS,
  armAudio,
  audioCount,
  denAllExcept,
  poseApart,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let flared;

  return {
    id: "audio.flare",

    async arrange(api) {
      await startPlaying(api);
      // A posed board: the forager's corridor and, 8 tiles off across solid rock, a
      // sealed ring for the Flarefish to patrol. On a posed straight line the tile gap
      // IS the euclidean gap, so 8 tiles is 256 px — clear of the bloom's 192 px
      // radius without having to hunt for a tile that is far by both measures at once.
      const far = (await poseApart(api, 8)).far;
      await denAllExcept(api, ["flarefish"]);
      await api.call("setPredator", "flarefish", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      // 1140 ticks = the flare-cadence check's own budget: past its ~7 s cadence.
      const r = await api.until((s) => pred(s, "flarefish").flaring === true, {
        max: 1140,
        poll: 12,
      });
      after = await audioCount(api);
      flared = r.hit;
      await api.advance(30); // a short tail so the clip shows the bloom
    },

    async assert(api, check) {
      check.expectOk("the Flarefish flares while wandering", flared);
      check.expectGt(
        "a flare cue plays on the Flarefish's bloom (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
