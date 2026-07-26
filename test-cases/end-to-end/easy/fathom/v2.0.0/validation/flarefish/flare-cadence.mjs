// flarefish.flare-cadence: while wandering it flares about every 7 s (a short charge
// then a bloom).
//
// Posing the Flarefish far from the forager is instant (`arrange`); waiting out its ~7 s
// cadence is the check itself, so it is `act` and the clip opens on that wait (the record
// pass films the beginning of it and stops on its budget — the verdict is already made).
import { startPlaying, denAllExcept, findFarTile, pred } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "flarefish.flare-cadence",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["flarefish"]);
      const far = findFarTile(snap, snap.forager, 8); // far, so it flares harmlessly
      await api.call("setPredator", "flarefish", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      // 1140 ticks = the old 9.5 s cap; poll 12 = the old 0.1 s chunk.
      r = await api.until((s) => pred(s, "flarefish").flaring === true, {
        max: 1140,
        poll: 12,
      });
      await api.advance(120); // 120 ticks = the old 1000 ms live tail
    },

    async assert(api, check) {
      check.expectOk("the Flarefish flares while wandering", r.hit);
      const p = pred(r.snap, "flarefish");
      check.expectGt("the bloom has a positive radius", p.flareRadius, 0);
      check.expectClose(
        "the first flare comes on its ~7 s cadence",
        r.snap.simTime,
        7.7,
        1.6,
      );
    },
  };
}
