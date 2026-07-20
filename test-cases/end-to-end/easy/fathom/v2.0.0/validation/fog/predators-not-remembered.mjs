// fog.predators-not-remembered: a predator body shows only while lit, and is dropped
// (not left drawn in memory) once the light moves off it.
//
// The lit pair is posed instantly (`arrange`), including the far tile the forager will
// be moved to — locating it there means both passes use the same tile. Lighting the
// Gloamfin, then taking the light off it, is the real sim running, so it is `act`: the
// clip shows the body drawn and then dropped.
import {
  startPlaying,
  findSightLine,
  openTiles,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

const man = (a, b, c, d) => Math.abs(a - c) + Math.abs(b - d);

export default function item() {
  let far;
  let litWhileLit;
  let litOnceDark;

  return {
    id: "fog.predators-not-remembered",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 3); // forager + gloamfin 3 tiles apart, clear LOS
      await denAllExcept(api, ["gloamfin"]);
      await api.call("setForager", {
        tx: line.forager.tx,
        ty: line.forager.ty,
      });
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await api.call("setBrightness", 1); // widen the light so the Gloamfin's tile is lit
      // Where the forager will be moved to so the light leaves the Gloamfin.
      far = openTiles(snap).find(
        ([c, r]) => man(c, r, line.pred.tx, line.pred.ty) > 8,
      );
      if (!far) throw new Error("no far tile to move the forager to");
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      litWhileLit = pred(await api.snapshot(), "gloamfin").lit;

      // Move the forager far away and dim so the light leaves the Gloamfin.
      await api.call("setForager", { tx: far[0], ty: far[1] });
      await api.call("setBrightness", 0);
      await api.advance(12); // 12 ticks = the old 0.1 s
      litOnceDark = pred(await api.snapshot(), "gloamfin").lit;

      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectOk(
        "the Gloamfin body is drawn while lit",
        litWhileLit === true,
      );
      check.expectOk(
        "the Gloamfin body is dropped once unlit (not remembered)",
        litOnceDark === false,
      );
    },
  };
}
