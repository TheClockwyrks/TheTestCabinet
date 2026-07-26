// gloamfin.ping-cadence: while wandering it emits its own violet ping ~every 4 s.
//
// Posing a lone wandering Gloamfin far from the forager is instant (`arrange`); the watch
// that collects its pings is the measurement, so it is `act` and is what the clip opens
// on (the record pass films the start of the watch and stops on its budget).
import {
  startPlaying,
  denAllExcept,
  findFarTile,
  actGloamPings,
  ticksFor,
  GLOAMFIN_PING_INTERVAL,
} from "../_helpers.mjs";

export default function item() {
  let pings;

  return {
    id: "gloamfin.ping-cadence",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      const far = findFarTile(snap, snap.forager, 10); // far, so it wanders and self-pings
      await api.call("setPredator", "gloamfin", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      // 1080 ticks = the old collectGloamPings(api, 9): a 9 s watch.
      pings = await actGloamPings(api, ticksFor(9));
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      const violet = pings.filter((p) => p.tint === "violet");
      check.expectGt(
        "the Gloamfin emits its own violet pings",
        violet.length,
        0,
      );
      if (violet.length >= 2) {
        const gap = violet[1].t - violet[0].t;
        check.expectClose(
          "its ping cadence is ~4 s",
          gap,
          GLOAMFIN_PING_INTERVAL,
          1.5,
        );
      }
    },
  };
}
