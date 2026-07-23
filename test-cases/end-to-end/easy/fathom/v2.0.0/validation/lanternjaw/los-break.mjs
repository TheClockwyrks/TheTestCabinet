// lanternjaw.los-break: a wall breaks its sense — it does not fix on a forager around
// a blind corner even within range.
//
// The blind pair is posed instantly (`arrange`); the stretch that proves nothing happens
// — no fix — is the real sim, so it is `act`.
import {
  startPlaying,
  findOccludedPair,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let p;

  return {
    id: "lanternjaw.los-break",

    async arrange(api) {
      const snap = await startPlaying(api);
      const bp = findOccludedPair(snap); // within the R=320 range, LOS blocked by rock
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setForager", { tx: bp.forager.tx, ty: bp.forager.ty });
      await api.call("setPredator", "lanternjaw", {
        tx: bp.pred.tx,
        ty: bp.pred.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
      await api.call("setBrightness", 1); // R = 320 px, so only the wall can block the sense
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      p = pred(await api.snapshot(), "lanternjaw");
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "a wall breaks the Lanternjaw's sense (still wandering behind the wall)",
        p.state,
        "wander",
      );
    },
  };
}
