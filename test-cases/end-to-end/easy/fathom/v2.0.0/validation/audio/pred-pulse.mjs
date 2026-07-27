// Automated validation for the Audio item `pred-pulse`: a cue plays when the Gloamfin
// emits its own periodic sonar ping (its tell, specs/predators.md). Audio is read from
// the Web Audio sources the build starts (see `api.audio`). Every other predator is
// denned so only the Gloamfin is active, and it is placed far from the forager
// (see gloamfin/ping-cadence.mjs) so it wanders and self-pings on its own ~4 s cadence
// rather than holding a continuous close-range hearing lock; audio is armed with a real
// gesture, and the log must grow across the ping.

import {
  actGloamPings,
  armAudio,
  audioCount,
  denAllExcept,
  findFarTile,
  quietBoard,
  startPlaying,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let pinged;

  return {
    id: "audio.pred-pulse",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      const far = findFarTile(snap, snap.forager, 10); // far, so it wanders and self-pings
      await api.call("setPredator", "gloamfin", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      // 1080 ticks = a 9 s watch, comfortably past the ~4 s ping cadence.
      const pings = await actGloamPings(api, ticksFor(9));
      after = await audioCount(api);
      pinged = pings.some((p) => p.tint === "violet");
      await api.advance(30); // a short tail so the clip shows the ping's aftermath
    },

    async assert(api, check) {
      check.expectOk("the Gloamfin emits its own periodic ping", pinged);
      check.expectGt(
        "a pulse cue plays on the Gloamfin's ping (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
