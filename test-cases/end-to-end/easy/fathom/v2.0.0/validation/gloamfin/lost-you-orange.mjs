// gloamfin.lost-you-orange: reaching where it last heard you and finding you gone, it
// fires a guaranteed orange "lost you" ping (distinct from its usual violet).
//
// The whole trick — fix the Gloamfin on the forager's tile, then move the forager away —
// is control ops, so it is `arrange`. Watching the Gloamfin swim to the empty fix and give
// up is `act`, and is exactly what the clip shows.
import {
  actGloamPings,
  denAllExcept,
  findFarTile,
  findSightLine,
  quietBoard,
  startPlaying,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  let pings;

  return {
    id: "gloamfin.lost-you-orange",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 3);
      await denAllExcept(api, ["gloamfin"]);
      await api.call("setForager", {
        tx: line.forager.tx,
        ty: line.forager.ty,
      });
      // Chase fixes on the forager's current tile (line.forager).
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "chase",
      });
      // Now move the forager far away, so when the Gloamfin reaches the fix it is empty —
      // and park it there, so it cannot drift back into hearing range mid-watch.
      const far = findFarTile(snap, line.forager, 9);
      await quietBoard(api, far);
    },

    async act(api) {
      // 720 ticks = the old collectGloamPings(api, 6): a 6 s watch.
      pings = await actGloamPings(api, ticksFor(6));
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectOk(
        "it fires a distinct orange 'lost you' ping after reaching the empty fix",
        pings.some((p) => p.tint === "orange"),
      );
    },
  };
}
