// Automated validation for the Forge sub-item `warms`.
//
// A Forge touching a cold emitter warms it up over time (specs/heat.md). A cold Arc
// is placed against a Forge and the real heat model is run forward with no target —
// its heat must rise from cold.
//
// WHY THE HEAT IS POSED AGAIN AT THE TOP OF `act`.
//
// The pose in `arrange` is what the scenario needs; the pose here is what makes the
// FIRST READING trustworthy, and the two are not the same thing.
//
// Nothing sets the build's clock until `arrange` has returned — `runPass` calls
// `setAutoStep` on the arrange/act boundary (see
// `packages/browser-driver/validation.mjs`) — so which clock is running during `arrange`
// is whatever the build was left on. `specs/instrumentation.md` says `reset` "switches
// the game to manual stepping", and a build that honours that is still and exact from
// `newGame` onwards; a build that only switches on `step` still has its animation loop
// running, and its simulation advances in real time through every round trip `arrange`
// makes. Both play identically for a person. The difference shows up only in the window
// between the last pose in `arrange` and the runtime taking the clock, where the second
// kind of build can slip in a frame.
//
// One frame is nothing to most scenarios and a great deal to this one. A level-I Forge
// adds `0.9 * sharedEdgeTiles * (setpoint - H)` per second, which across the Arc's
// two-tile south face at `H = 0` is 129.6/s — so a single 60 Hz tick is 2.16 heat,
// against a tolerance of 0.01. The check read that as "the emitter did not start cold"
// and failed a build whose Forge works perfectly, intermittently, depending on whether a
// frame happened to land in a window a few milliseconds wide.
//
// Re-posing after the handover closes the window instead of widening a tolerance to
// admit it. By then the clock is the runtime's, `advance` is an exact `step`, and
// `setHeat` consumes no time — so `before` is 0 by construction on every build, however
// it handles `reset`. (The clock contract is a real claim and this is not a defence of
// ignoring it; it simply is not what a review point about the Forge should score, and no
// tolerance on this reading can tell the two builds apart without also blinding the
// check to a Forge that starts its neighbour warm.)
//
// The assertions then read the RISE rather than the endpoint, which is what "a Forge
// warms a cold gun" actually claims, with a coarse bound on the start that rules out a
// vacuous pass — a build that posed the Arc hot and left it there would satisfy any
// bare "it ended up warm" check.

import { newGame, build, heatOf } from "../_helpers.mjs";

// 120 ticks = 2 s of the real heat model.
const WARM_TICKS = 120;

// How cold "cold" has to be for the rise below to mean anything. Deliberately coarse and
// far under the level-I setpoint of 72 (specs/towers.md): its job is to catch an Arc that
// arrived warm, not to re-measure `setHeat`, which is its own contract.
const COLD_ENOUGH = 10;

// The rise that counts as warming. The same bound the endpoint check used to carry —
// with the start pinned at 0 the two are equivalent — so this is no weaker, just stated
// as the difference it was always about. A conformant Forge clears it many times over
// (all four builds checked here reach ~66 in this window); one that does nothing sits at
// a rise of 0.
const MIN_RISE = 5;

export default function item() {
  let arcId;
  let before;
  let after;

  return {
    id: "forge.warms",

    // A cold Arc with a Forge on its south face. Nothing is spawned, so the Forge is
    // the only thing that can move its heat.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      arcId = await build(api, "arc", 12, 12);
      await build(api, "forge", 12, 14); // touching the Arc's south face
      await api.call("setHeat", arcId, 0);
    },

    // Re-pose cold on the runtime's clock (see the note above), then let the real heat
    // model run. No target, so only the Forge acts, and the clip shows the Arc's glow
    // coming up from cold.
    async act(api) {
      await api.call("setHeat", arcId, 0);
      before = await heatOf(api, arcId);
      await api.advance(WARM_TICKS);
      after = await heatOf(api, arcId);
    },

    async assert(api, check) {
      check.expectLt("the emitter starts cold", before, COLD_ENOUGH);
      check.expectGt(
        `a Forge warms a cold gun (${before.toFixed(2)} -> ${after.toFixed(2)})`,
        after - before,
        MIN_RISE,
      );
    },
  };
}
