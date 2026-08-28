// lanternjaw.wander-disguise: undetected it drifts at the drifter's ~64 px/s (reading its
// `wander` state); on a fix it drops the disguise and hunts at ~116 px/s (state `chase`).
//
// THE FIX IS EARNED, NOT POKED IN. An earlier form parked the Lanternjaw in a sealed ring
// nine tiles from a dark forager and then set `mode: "chase"` on it. That asks a build to
// hold a fix on a forager it has no reason to have found — sealed away, unlit, out of
// range — and builds answered differently: one re-read its senses on the next tick, saw
// nothing to chase, and was back to wandering a twentieth of a second later, which this
// item reported as failing to drop its disguise. The other direction failed too: a build
// whose hunter crossed the rock found the forager during the FIRST half and was already
// chasing when the item wanted it disguised. Between them the two halves of one item were
// failing on two different builds for two reasons, neither of which was the disguise.
//
// So the Lanternjaw is given the reason the spec gives it. It hunts light, within a range
// that scales with how bright the forager is — `R = 128 + 192 G`, with line of sight
// (`specs/predators/lanternjaw.md`) — so the forager standing dark at `G = 0` is `224 px`
// away against a reach of `128`, and is not there as far as the Lanternjaw is concerned;
// turning the forager's light up to `G = 1` stretches that reach to `320 px` and the same
// forager, on the same tile, is suddenly in it. Nothing is posed, nothing is poked: the
// build's own sensing makes the fix, which is what the second half of this item is about,
// and the clip shows a drifting amber mote turning into a hunter the moment the light
// comes up.
import {
  DRIFTER_SPEED,
  PREDATOR_SPEED,
  denAllExcept,
  poseSightLine,
  pred,
  quietBoard,
  startPlaying,
  ticksFor,
} from "../_helpers.mjs";

// How far apart the two stand, in tiles. Seven is `224 px`: outside the `128 px` the
// Lanternjaw reaches while the forager is dark, and inside the `320 px` it reaches once
// the forager is fully lit. Both with a margin of a couple of tiles, so neither half of
// the item turns on a distance a build has to match to the pixel.
const GAP_TILES = 7;

export default function item() {
  let w;
  let h;
  let acquired;

  return {
    id: "lanternjaw.wander-disguise",

    async arrange(api) {
      await startPlaying(api);
      // One straight corridor, so the sight line the Lanternjaw needs is unobstructed and
      // the only thing standing between the two halves of this item is brightness.
      const line = await poseSightLine(api, GAP_TILES);
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setPredator", "lanternjaw", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        // Facing away down the corridor: its drift is the thing being timed, and a drift
        // that closes the gap would shorten the range this scenario is built on.
        dir: line.dir,
        mode: "wander",
      });
      // Parks the forager and leaves `G` at the zero this half needs.
      await quietBoard(api, line.forager);
    },

    async act(api) {
      // Half a second of the disguise: long enough to read a settled speed, and long
      // enough for a reviewer to see it drifting before anything happens to it.
      await api.advance(ticksFor(0.5));
      w = pred(await api.snapshot(), "lanternjaw");

      // The light comes up, and the Lanternjaw's own sensing does the rest.
      await api.call("setBrightness", 1);
      acquired = await api.until((s) => pred(s, "lanternjaw").state === "chase", {
        max: ticksFor(1),
        poll: 6,
      });
      // A beat for the hunt speed to be the hunt speed rather than the tick it changed on.
      await api.advance(ticksFor(0.15));
      h = pred(await api.snapshot(), "lanternjaw");

      await api.advance(ticksFor(0.9)); // the charge, for the clip
    },

    async assert(api, check) {
      check.expectEq(
        "undetected it reads as disguised (wandering)",
        w.state,
        "wander",
      );
      check.expectClose(
        "it drifts at the drifter's ~64 px/s",
        w.speed,
        DRIFTER_SPEED,
        6,
      );
      check.expectOk(
        "brightening the forager brings it inside the Lanternjaw's reach, and it takes the fix",
        acquired.hit,
      );
      if (!acquired.hit) return;
      check.expectEq(
        "on a fix it drops the disguise (chasing)",
        h.state,
        "chase",
      );
      check.expectClose("and hunts at ~116 px/s", h.speed, PREDATOR_SPEED, 10);
    },
  };
}
