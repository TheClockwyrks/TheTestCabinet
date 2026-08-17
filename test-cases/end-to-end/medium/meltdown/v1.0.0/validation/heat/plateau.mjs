// Automated validation for the Heat sub-item `plateau`.
//
// From the redline up to the 100 trip the heat multiplier holds flat at 3.5x
// (specs/heat.md) — going past the redline adds trip risk, not more damage. Heat is
// posed at the redline, between it and 100, and just below 100, and the real damage
// curve's multiplier is read back — all ~3.5. The Arc's redline is 80.
//
// A CLIP, WITH THE TOWER SELECTED, RATHER THAN A STILL.
//
// The claim is that one number CHANGES while another HOLDS, and a still cannot make it:
// a screenshot of an Arc reading `x3.5` at heat 90 is equally a screenshot of a build
// that reports 3.5 at every heat, and the value it has to be compared against is in a
// frame the reviewer does not have. So the drive walks the heat up the plateau on
// screen, holding a beat at each stop, and the reviewer watches the heat bar climb from
// the redline toward the trip while the multiplier sits still.
//
// The Arc is SELECTED throughout, because the multiplier is an inspector read: "the
// inspector's damage read shows the tower's current per-shot damage together with its
// heat damage multiplier" (specs/controls.md), and "this readout, not just the emitter's
// glow, is where the player watches heat turn into power and sees the damage plateau
// directly". Without the selection the clip shows a tower glowing slightly differently
// and none of the numbers the item is about. `selectTower` is a control op and consumes
// no time, so it belongs in the pose.
//
// The heat is posed rather than fired up to, and there is no target on the floor, so
// nothing but `setHeat` moves it — which is what makes each stop an exact reading of the
// curve at that heat rather than wherever a firing tower happened to be.

import { newGame, build, tower, actTail } from "../_helpers.mjs";

// The plateau, sampled at its bottom (the Arc's redline), its middle, and just under the
// trip. All three must read the same 3.5x.
const POINTS = [80, 90, 99];

// The beat held at each stop, so the pair of numbers is legible before the next one.
// 72 ticks is 1.2 s; three of them plus the tail is a clip of about five seconds.
const HOLD = 72;

export default function item() {
  let towerId;
  const mults = [];

  return {
    id: "heat.plateau",

    clipMs: 8000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      towerId = await build(api, "arc", 6, 20);
      // The plateau is read in the inspector, so the inspector has to be open on it.
      await api.call("selectTower", towerId);
    },

    // Walk up the plateau, holding at each stop so the climbing heat and the flat
    // multiplier are both readable on screen.
    async act(api) {
      for (const h of POINTS) {
        await api.call("setHeat", towerId, h);
        mults.push((await tower(api, towerId)).heatMult);
        await api.advance(HOLD);
      }
      // End just under the trip, where the plateau is at its most counter-intuitive: as
      // hot as a tower can get and no harder-hitting than it was at the redline.
      await actTail(api, 120);
    },

    async assert(api, check) {
      POINTS.forEach((h, i) => {
        check.expectClose(
          `multiplier at heat ${h} holds at 3.5x`,
          mults[i],
          3.5,
          0.02,
        );
      });
    },
  };
}
