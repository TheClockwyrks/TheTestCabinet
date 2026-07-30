// lanternjaw.bulb-visible: the Lanternjaw's amber bulb is drawn even when its tile is
// unrevealed fog (its body unlit) — sampled from the rendered canvas.
//
// The blind pair is posed instantly (`arrange`); `act` lets the pose settle, gives the
// build a frame to paint, and reads the amber halo back off the canvas.
import {
  amberInProfile,
  denAllExcept,
  findOccludedPair,
  pred,
  quietBoard,
  sampleMoteProfile,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let lit;
  let profile;

  return {
    id: "lanternjaw.bulb-visible",

    async arrange(api) {
      const snap = await startPlaying(api);
      const bp = findOccludedPair(snap); // close enough for the Kindle circle, LOS blocked so unlit
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setPredator", "lanternjaw", {
        tx: bp.pred.tx,
        ty: bp.pred.ty,
        mode: "wander",
      });
      await quietBoard(api, bp.forager);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      const p = pred(await api.snapshot(), "lanternjaw");
      lit = p.lit;
      // A REAL pause (the old wait(120)) so the bulb has been painted before sampling.
      await api.settle(120);
      // The bulb read across its whole profile rather than at one fixed ring: the spec
      // fixes the amber, not the size of the glow it is painted in (see `MOTE_RADII`).
      profile = await sampleMoteProfile(api, p.x, p.y);
      await api.screenshot("bulb");
    },

    async assert(api, check) {
      check.expectOk("the Lanternjaw's tile is unlit fog", lit === false);
      check.expectOk(
        "its amber bulb is still drawn in the dark",
        Boolean(amberInProfile(profile)),
      );
    },
  };
}
