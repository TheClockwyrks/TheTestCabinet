// fog.predators-not-remembered: a predator body shows only while lit, and is dropped
// (not left drawn in memory) once the light moves off it.
//
// The lit pair is posed instantly (`arrange`), including the far tile the forager will
// be moved to — locating it there means both passes use the same tile. Lighting the
// Gloamfin, then taking the light off it, is the real sim running, so it is `act`: the
// clip shows the body drawn and then dropped.
//
// HOW FAR "AWAY" HAS TO BE, AND WHY MANHATTAN WAS NOT IT. Light is not the only thing
// that can legitimately draw a Gloamfin: its detection alert does too, for about half a
// second, whenever it takes a fix (specs/predators.md) — and one of the ways it takes a
// fix is its own ping sweeping over your tile, which reaches nine corridor tiles at this
// depth and is entirely conforming. A forager moved somewhere merely eight tiles away on
// the manhattan grid can still be well inside that flood, so the item could read a
// perfectly correct build mid-alert and call the drawn body a memory of one. Choosing the
// tile by CORRIDOR distance, past the ping's own reach, closes that: nothing but the
// light could have been drawing it, so nothing but memory can still be.
import {
  startPlaying,
  poseSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let far;
  let litWhileLit;
  let litOnceDark;
  let alertAtRead;

  return {
    id: "fog.predators-not-remembered",

    async arrange(api) {
      await startPlaying(api);
      // Forager and Gloamfin three tiles apart with clear line of sight, and a sealed
      // pocket for the forager to move to when the light has to leave the Gloamfin.
      const line = await poseSightLine(api, 3, { refugeGap: 9 });
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
      // Where the forager will be moved to so the light leaves the Gloamfin. The pocket
      // is sealed off from the Gloamfin's corridor, so no corridor route joins the two at
      // all and its own ping — which floods along corridors — can never reach the forager
      // there. That is what the search this replaces was reaching for: somewhere far
      // enough that nothing but the light could still be drawing the body.
      far = line.refuge;
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      litWhileLit = pred(await api.snapshot(), "gloamfin").lit;

      // Move the forager far away and dim so the light leaves the Gloamfin.
      await api.call("setForager", far);
      await api.call("setBrightness", 0);
      // 12 ticks = 0.1 s: enough for the sim to recompute what its light now reaches, and
      // far too little for the Gloamfin's own patrol (116 px/s, so 11 px) to carry it
      // anywhere new.
      await api.advance(12);
      const g = pred(await api.snapshot(), "gloamfin");
      litOnceDark = g.lit;
      alertAtRead = g.alert;

      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectOk(
        "the Gloamfin body is drawn while lit",
        litWhileLit === true,
      );
      // Belt and braces on the geometry above: with the forager beyond the ping's reach
      // there is nothing left for the Gloamfin to have fixed on, so an alert here would
      // mean the read is not measuring what the item claims.
      check.expectOk(
        "nothing else is revealing it at the read (no detection alert firing)",
        alertAtRead === false,
      );
      check.expectOk(
        "the Gloamfin body is dropped once unlit (not remembered)",
        litOnceDark === false,
      );
    },
  };
}
