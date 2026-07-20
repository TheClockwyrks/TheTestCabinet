// lanternjaw.bulb-visible: the Lanternjaw's amber bulb is drawn even when its tile is
// unrevealed fog (its body unlit) — sampled from the rendered canvas.
//
// The blind pair is posed instantly (`arrange`); `act` lets the pose settle, gives the
// build a frame to paint, and reads the amber halo back off the canvas.
import {
  startPlaying,
  findBlindPair,
  denAllExcept,
  pred,
  sampleAmberOrb,
  isAmber,
} from "../_helpers.mjs";

export default function item() {
  let lit;
  let col;

  return {
    id: "lanternjaw.bulb-visible",

    async arrange(api) {
      const snap = await startPlaying(api);
      const bp = findBlindPair(snap, 4); // close enough for the Kindle circle, LOS blocked so unlit
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setForager", { tx: bp.forager.tx, ty: bp.forager.ty });
      await api.call("setPredator", "lanternjaw", {
        tx: bp.pred.tx,
        ty: bp.pred.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      const p = pred(await api.snapshot(), "lanternjaw");
      lit = p.lit;
      // A REAL pause (the old wait(120)) so the bulb has been painted before sampling.
      await api.settle(120);
      col = await sampleAmberOrb(api, p.x, p.y);
      await api.screenshot("bulb");
    },

    async assert(api, check) {
      check.expectOk("the Lanternjaw's tile is unlit fog", lit === false);
      check.expectOk("its amber bulb is still drawn in the dark", isAmber(col));
    },
  };
}
