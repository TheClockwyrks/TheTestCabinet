// gloamfin.ping-floor: it never fires two pings closer than ~3 s apart.
//
// Posing a lone wandering Gloamfin is instant (`arrange`); the long watch that collects
// enough pings to measure the gap between them is `act`, and the clip opens on it.
import {
  GLOAMFIN_PING_MIN_GAP,
  actGloamPings,
  denAllExcept,
  findFarTile,
  quietBoard,
  startPlaying,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  let pings;

  return {
    id: "gloamfin.ping-floor",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      const far = findFarTile(snap, snap.forager, 8);
      await api.call("setPredator", "gloamfin", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
    },

    async act(api) {
      // 1440 ticks = the old collectGloamPings(api, 12): a 12 s watch.
      pings = await actGloamPings(api, ticksFor(12));
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectGt("several pings are observed", pings.length, 1);
      let minGap = Infinity;
      for (let i = 1; i < pings.length; i++) {
        minGap = Math.min(minGap, pings[i].t - pings[i - 1].t);
      }
      check.expectGt(
        "no two pings fire closer than the ~3 s floor",
        minGap,
        GLOAMFIN_PING_MIN_GAP - 0.2,
      );
    },
  };
}
