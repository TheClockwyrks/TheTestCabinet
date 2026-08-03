// fog.light-line-of-sight: passive light does not bend around corners — a predator
// behind rock is not lit even though it is well within light range.
//
// The occluded pair and the widened light are posed instantly (`arrange`); `act` watches
// the predator for as long as the rock is actually between them, which is both the
// measurement and the clip.
//
// TWO THINGS THIS ITEM HAS TO GET RIGHT, neither of which is the assertion.
//
// The pair must be SOLIDLY occluded. `findOccludedPair` now requires a full tile of rock
// on the sight line (see there): a pair whose line merely clips a wall corner is one
// conforming builds can honestly disagree about, and scoring a build on which side of
// that hair it lands is not a test of anything.
//
// And the predator must be watched only while the wall is still doing the work. It is
// posed to `wander`, so it patrols — through the real AI, which is the point — and a
// patrol eventually rounds the corner into the open, where being lit is correct. So the
// sweep stops the moment the sight line clears, and the verdict is "it was never lit
// while the rock was between us". Posing its heading AWAY from the junction (`dir` is
// part of `setPredator`) buys that window: without it the predator is posed carrying
// whatever facing it had, which may point straight at the corner, and it can be standing
// in plain sight a tenth of a second later — with the captured still showing exactly
// that, the opposite of what the item says.
import {
  startPlaying,
  findOccludedPair,
  denAllExcept,
  losClear,
  openNeighborDirs,
  pred,
  stepTile,
  quietBoard,
} from "../_helpers.mjs";

/** The open direction out of `tile` that leads furthest from `away` (a tile). */
function facingAwayFrom(snap, tile, away) {
  let best = null;
  let bestD = -Infinity;
  for (const d of openNeighborDirs(snap, tile.tx, tile.ty)) {
    const [nc, nr] = stepTile(snap, tile.tx, tile.ty, d);
    const dd = Math.abs(nc - away.tx) + Math.abs(nr - away.ty);
    if (dd > bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best;
}

export default function item() {
  let litWhileBlind = false;
  let samples = 0;

  return {
    id: "fog.light-line-of-sight",

    async arrange(api) {
      const snap = await startPlaying(api);
      // A Gloamfin senses nothing by light, but it HEARS within 64 px, so the occluded
      // pair is kept beyond that (minDist 70) to isolate line-of-sight as the only cause,
      // and within the widened light (maxDist 150 < V = 160 px) so the light would reach
      // it but for the wall.
      const bp = findOccludedPair(snap, { minDist: 70, maxDist: 150 });
      await denAllExcept(api, ["gloamfin"]);
      const facing = facingAwayFrom(snap, bp.pred, bp.forager);
      await api.call("setPredator", "gloamfin", {
        tx: bp.pred.tx,
        ty: bp.pred.ty,
        ...(facing ? { dir: facing } : {}),
        mode: "wander",
      });
      // The forager is a bystander here: park it (facing a wall, so it cannot drift into
      // the pair's geometry) and quiet the board so it cannot graze its way past the
      // `G = 1` this poses.
      await quietBoard(api, bp.forager);
      await api.call("setBrightness", 1); // V = 160 px, well past the gap to the pair
    },

    async act(api) {
      // The still is taken FIRST, while the rock is still between them — that instant is
      // what the item is about. Taking it at the end instead would frame whatever the
      // sweep stopped on, which is by definition the moment the predator stepped OUT of
      // cover and became lit, so the evidence would show the opposite of the verdict.
      await api.settle(120); // a REAL pause so the posed scene is painted
      await api.screenshot("los");

      // Sample every 6 ticks (0.05 s) for up to 1.5 s, stopping when the predator's own
      // patrol brings it out from behind the rock.
      for (let i = 0; i < 30; i++) {
        const s = await api.snapshot();
        const g = pred(s, "gloamfin");
        if (losClear(s, s.forager.tx, s.forager.ty, g.tx, g.ty)) break;
        samples++;
        if (g.lit) litWhileBlind = true;
        await api.advance(6);
      }
    },

    async assert(api, check) {
      check.expectGt(
        "the predator stayed behind the rock long enough to read",
        samples,
        0,
      );
      check.expectOk(
        "a predator behind rock is never lit by the light, however close",
        litWhileBlind === false,
      );
    },
  };
}
