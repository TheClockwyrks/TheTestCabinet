// gloamfin.lost-you-orange: reaching where it last heard you and finding you gone, it
// fires a guaranteed orange "lost you" ping (distinct from its usual violet) — and, like
// every ping it casts, one that does not draw the Gloamfin itself.
//
// The self-drawing half is the same requirement `gloamfin/ping-reveals-nothing` reads off
// the ordinary violet ping, checked here on the orange one because the spec states it of
// the WAVEFRONT rather than of one tint: the "lost you" ping is "the same procedural
// wavefront, only tinted orange" (specs/predators/gloamfin.md), and what the ping must not
// do is give you "a clean fix on where the source is". A build can easily satisfy that for
// its routine ping and give itself away on the guaranteed one, since that is the ping it
// fires from a standstill while casting about; nothing but a check distinguishes them.
//
// The whole trick — fix the Gloamfin on the forager's tile, then move the forager away —
// is control ops, so it is `arrange`. Watching the Gloamfin swim to the empty fix and give
// up is `act`, and is exactly what the clip shows.
import {
  actGloamPings,
  denAllExcept,
  poseSightLine,
  requirePredatorMotion,
  quietBoard,
  startPlaying,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  let pings;

  return {
    id: "gloamfin.lost-you-orange",

    async arrange(api) {
      await startPlaying(api);
      // The corridor the chase runs down, plus a sealed pocket well clear of it for the
      // forager to slip away to.
      const line = await poseSightLine(api, 3, { refugeGap: 9 });
      await denAllExcept(api, ["gloamfin"]);
      await api.call("setForager", {
        tx: line.forager.tx,
        ty: line.forager.ty,
      });
      // Chase fixes on the forager's current tile (line.forager).
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "chase",
      });
      // Now move the forager far away, so when the Gloamfin reaches the fix it is empty —
      // and park it there, so it cannot drift back into hearing range mid-watch.
      await quietBoard(api, line.refuge);
    },

    async act(api) {
      const opening = await api.snapshot();
      // 720 ticks = the old collectGloamPings(api, 6): a 6 s watch.
      pings = await actGloamPings(api, ticksFor(6));
      await api.advance(96); // 96 ticks = the old 800 ms live tail
      // The orange ping is what a Gloamfin fires having ARRIVED at the tile the fix named
      // and found nobody — "when the Gloamfin reaches that tile and you are not there"
      // (specs/predators/gloamfin.md). A hunter that never left its own tile never reaches
      // it, so there is no lost-you moment to have missed.
      if (!pings.some((p) => p.tint === "orange")) {
        requirePredatorMotion(
          opening,
          await api.snapshot(),
          "gloamfin",
          "reach the tile its fix named and find it empty",
        );
      }
    },

    async assert(api, check) {
      const orange = pings.find((p) => p.tint === "orange");
      check.expectOk(
        "it fires a distinct orange 'lost you' ping after reaching the empty fix",
        Boolean(orange),
      );
      if (!orange) return;
      // The forager is parked nine tiles off with `G` at 0, so its light reaches nowhere
      // near the Gloamfin, and the ping is read as it leaves the source — long before its
      // front could reach the forager and fire the alert that legitimately does draw it.
      // Anything lit here is the ping drawing its own caster.
      check.expectOk(
        "the 'lost you' ping does not draw the Gloamfin itself",
        orange.lit === false,
      );
    },
  };
}
