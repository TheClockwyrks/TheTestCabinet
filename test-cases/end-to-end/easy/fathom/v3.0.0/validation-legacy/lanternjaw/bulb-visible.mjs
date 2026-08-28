// lanternjaw.bulb-visible: the Lanternjaw's amber bulb is drawn even when its tile is
// unrevealed fog (its body unlit) — sampled from the rendered canvas.
//
// The blind pair is posed instantly (`arrange`); `act` lets the pose settle, gives the
// build a frame to paint, and reads the amber halo back off the canvas.
import {
  amberInProfile,
  denAllExcept,
  poseOccludedPair,
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
      await startPlaying(api);
      // FIVE TILES APART — `160 px` — and the distance is the whole point.
      //
      // This item reads a bulb "in the dark", and it used to get its darkness from
      // occlusion alone, standing the pair two tiles apart with rock between. Two tiles is
      // `64 px`, well inside the forager's own light pocket (`V = 96 + 64 G`, so `96 px`
      // while it is dim), and a build is entitled to paint that pocket as a soft glow
      // rather than a hard disc. One does: its glow washed over the bulb and the sample
      // came back green (`191,220,145`) instead of amber, so a build drawing the bulb at
      // the palette's exact `#ffd166` was failed for it. The tile was unlit — the rock did
      // its job — but the trench around it was not dark.
      //
      // `160 px` is past the light pocket under any brightness this scenario uses, and
      // still inside the `192 px` Kindle vision circle, so the bulb is drawn in both dives
      // and read over ground nothing else is lighting. `amber/lookalikes` has always
      // measured its lights from that same band.
      const bp = await poseOccludedPair(api, { tiles: 5 });
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
