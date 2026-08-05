// Automated validation for the Surface-cooling sub-item `open-faces-shed`.
//
// A hot tower with faces on open air sheds heat over time (specs/heat.md). A lone
// emitter is posed hot as a precondition, then the real cooling model is run forward
// with no target — its heat must fall.
//
// The heat is posed AGAIN at the top of `act`, for the reason spelled out at length on
// `forge.warms`: nothing sets the build's clock until `arrange` has returned, so on a
// build whose `reset` does not switch to manual stepping the animation loop is free to
// slip a frame into the window between the last pose and the runtime taking over. This
// item is far less exposed than `forge.warms` — a lone Arc at `H = 80` sheds about 15/s,
// so a tick is a quarter of a point against a tolerance of half a point — but it is the
// same defect and the same one-line guard. Re-posing on the runtime's clock makes the
// first reading exact by construction rather than exact if the timing happens to fall the
// right way.
//
// The fall itself was always robust: it compares two readings taken either side of the
// same advance, so a tick of drift before the window moves both. It is the "starts hot"
// precondition that needed pinning.

import { newGame, build, heatOf } from "../_helpers.mjs";

// 120 ticks = 2 s of the real cooling model.
const COOL_TICKS = 120;

const START_HEAT = 80;

export default function item() {
  let towerId;
  let before;
  let after;

  return {
    id: "cooling.open-faces-shed",

    // A lone Arc out in open floor, posed hot. Nothing is spawned, so nothing can
    // heat it back up — the only thing acting on it is surface cooling.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      towerId = await build(api, "arc", 20, 12);
      await api.call("setHeat", towerId, START_HEAT);
    },

    // Re-pose hot on the runtime's clock (see the note above), then let it cool. No
    // target: the tower only cools, and the clip shows its glow dimming as it does.
    async act(api) {
      await api.call("setHeat", towerId, START_HEAT);
      before = await heatOf(api, towerId);
      await api.advance(COOL_TICKS);
      after = await heatOf(api, towerId);
    },

    async assert(api, check) {
      check.expectClose("the emitter starts hot", before, START_HEAT, 0.5);
      check.expectLt(
        `a lone hot emitter sheds heat over time (${before.toFixed(2)} -> ${after.toFixed(2)})`,
        after,
        before,
      );
    },
  };
}
