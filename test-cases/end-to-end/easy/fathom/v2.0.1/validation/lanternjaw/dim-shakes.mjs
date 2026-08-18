// lanternjaw.dim-shakes: going dim shrinks its detection range and shakes its fix.
//
// R = 128 + 192 G (specs/predators.md), so a gap that sits inside the range while the
// forager is bright falls outside it once the forager is dim.
//
// WHY THE FORAGER SLIPS AWAY. An earlier form of this check dimmed and then waited out
// the ~2 s linger with the forager left standing exactly where it had been fixed. No
// conforming build can pass that: while it lingers the Lanternjaw paths to the fix at
// 116 px/s, covering 232 px in the 2 s, so to still be outside the dim R = 128 px when
// the linger expires the forager would have to start more than 128 + 232 = 360 px away —
// yet at G = 1 it can only be SENSED within R = 320 px in the first place. The two bounds
// cannot both hold, so a spec-correct Lanternjaw always walks back into range and
// re-acquires before giving up. (The case's own reference implementation failed it.)
//
// So the scenario runs the counter the spec actually describes — "go dim (stop eating and
// let G decay) to shrink its range and slip out of its sight". The forager dims AND slips
// away; the Lanternjaw paths to the now-stale fix and, with its range collapsed to 128 px,
// cannot re-find the forager, so the fix lapses back to wandering.
//
// AND WHY IT SLIPS ALONG THE CORRIDOR RATHER THAN ANYWHERE ROOMY. The slip tile used to be
// chosen by clearance alone — the open tile furthest from the run the Lanternjaw would walk
// — which in a one-wide maze is almost always around a corner. That made LINE OF SIGHT the
// thing that broke the fix and left the range playing no part at all: a mutant of the
// reference whose detection range never shrank produced a trace identical to the
// reference's, tile for tile and state for state, and passed. The three tiles now sit on
// one straight corridor (`findDimStandoff`), so the hunter can see the slip tile the whole
// time and only the SIZE of its range decides whether it can sense the forager there. A
// build whose range does not shrink re-acquires at once and never gives up.
//
// Posing is instant (`arrange`); the fix, the dimming and the shaken fix are the real sim,
// so they are `act`.
import {
  startPlaying,
  findDimStandoff,
  denAllExcept,
  parkForager,
  pred,
  quietBoard,
  tileGapPx,
  untilGivesUp,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
} from "../_helpers.mjs";

// The dim range (G = 0) and the bright range (G = 1), in px.
const DIM_RANGE = LANTERN_RANGE_BASE; // 128
const BRIGHT_RANGE = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN; // 320

export default function item() {
  let line;
  let fixed;
  let brightRange;
  let lapsed;
  let dimRange;
  let clearance;
  let reachFromStart;
  let gap;

  return {
    id: "lanternjaw.dim-shakes",
    // Room for the walk to the stale fix and the linger it waits out there.
    clipMs: 12000,

    async arrange(api) {
      const snap = await startPlaying(api);
      line = findDimStandoff(snap);
      // What the two clearance assertions are measured from: how far the slip sits from
      // the stale fix the hunter ends up standing on, and how far it sits from where the
      // hunter starts — which is the furthest it ever is from the forager.
      clearance = tileGapPx(snap.grid, line.slip, line.fix);
      reachFromStart = tileGapPx(snap.grid, line.slip, line.pred);
      // The ground it has to cover to the tile the fix goes stale on, covered before its
      // linger can even start running.
      gap = tileGapPx(snap.grid, line.pred, line.fix);
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setPredator", "lanternjaw", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      // Stand the forager on the sight line and PARK it (facing a wall), then strip the
      // field to a single stray plankton it cannot reach. Both halves matter: nothing it
      // passes over may re-brighten G during the measurement, and the clearance figures
      // asserted below are computed from the posed tiles, so they only describe the real
      // scenario if the forager is still standing on them when the linger expires.
      await quietBoard(api, line.fix);
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = 0.05 s: the real light-sense fix at full brightness
      const bright = pred(await api.snapshot(), "lanternjaw");
      fixed = bright.state;
      brightRange = bright.detectRange;
      // Go dim and slip away, together — the spec's counter. The slip is a pose rather than
      // a swim, so the forager never crosses the shrinking range in plain sight on its way
      // out and hands the hunter a fresh fix as it goes.
      await api.call("setBrightness", 0);
      await parkForager(api, line.slip);
      // Long enough for either reading of giving up — the linger counted from the moment it
      // lost the forager, or counted from arriving at the stale fix. A flat wait covered
      // only the first: see `untilGivesUp`.
      lapsed = await untilGivesUp(api, "lanternjaw", { pathPx: gap });
      dimRange = pred(lapsed.snap, "lanternjaw").detectRange;
    },

    async assert(api, check) {
      check.expectEq(
        "the Lanternjaw is fixed on the forager while it is bright",
        fixed,
        "chase",
      );
      check.expectClose(
        "its range while bright reaches the forager (R = 128 + 192 G)",
        brightRange,
        BRIGHT_RANGE,
        16,
      );
      check.expectClose(
        "going dim shrinks its range back to R = 128",
        dimRange,
        DIM_RANGE,
        16,
      );
      // The slip sits on the same open corridor, beyond the shrunk range but inside the
      // bright one — so a range that shrank loses the forager there and a range that did
      // not keeps it, with nothing else about the scenario differing between the two.
      check.expectGt(
        "the forager slipped beyond the shrunk range, measured from the stale fix",
        clearance,
        DIM_RANGE,
      );
      check.expectLe(
        "but never beyond the range the Lanternjaw had while it was bright",
        reachFromStart,
        BRIGHT_RANGE,
      );
      check.expectOk(
        "the shrunk range cannot re-find it, so the fix lapses (back to wandering)",
        lapsed.gaveUp,
      );
    },
  };
}
