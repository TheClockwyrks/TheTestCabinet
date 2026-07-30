// Automated validation for the Surface-cooling sub-item `boxed-bakes`.
//
// A firing emitter boxed in on every face cannot shed its heat and bakes itself to
// the trip (specs/heat.md). We box an Arc with a Forge on each of its four faces
// (the Forge and Sink have no heat and do not conduct, so a boxing mover seals the
// surface off without becoming a drain), give it a real Core target, and pose it near
// its redline; with zero air-facing edges and no conduction drain, its own firing
// carries it to 100 and the real trip system takes it offline.
//
// The emitter has to be able to REACH the surge, and no placement beside the vent can
// promise that on its own: the left vent's four rows are all equally short routes to
// the right exhaust, and so is a diagonal climb to the top of the floor and back down,
// so which one the surge walks is the build's own tie-break (see the note above
// `buildVentCorridor` in `_helpers`). An Arc that never acquires a target never fires,
// its heat sits exactly where it was posed, and this item reports "did not trip" — a
// cooling failure that is really an out-of-range emitter.
//
// So the surge is routed rather than guessed at: the corridor's roof funnels every
// left-vent unit along rows 18-19, and the box goes directly underneath it, close
// enough that the corridor sits well inside the Arc's 6-tile range. The box's own N
// Forge is what separates the two, so the corridor's standard floor is not used here —
// only its roof — and engagement is still asserted below, so this can never again be
// diagnosed as a heat bug.
//
// Engagement is read from `damageDealt`, not from `firing`. `firing` is true only on
// the step a shot actually goes out, and a boxed Arc posed at 95 trips on its FIRST
// shot (10.3 heat per shot carries it straight past 100), so the tick that would report
// `firing` is the tick it goes offline — and a tripped tower is not firing. The
// lifetime damage tally is the durable evidence that it had something to shoot at.

import {
  newGame,
  build,
  spawn,
  tower,
  actTail,
  buildCorridorWalls,
  CORRIDOR_COL,
  CORRIDOR_ROW,
  CORRIDOR_ROOF_WALLS,
  TICK,
} from "../_helpers.mjs";

// Box `col,row` (a 2x2 emitter) with a Forge on N, S, W, and E. Returns the emitter's
// id and how many of the four movers actually went down — a refused placement leaves
// that face open to the air, which is the one thing this scenario must not allow, and
// `build` reports a refusal by returning null rather than throwing.
async function boxWithForges(api, type, col, row) {
  const id = await build(api, type, col, row);
  const faces = [
    [col, row - 2], // N
    [col, row + 2], // S
    [col - 2, row], // W
    [col + 2, row], // E
  ];
  let boxed = 0;
  for (const [c, r] of faces) {
    if ((await build(api, "forge", c, r)) !== null) boxed += 1;
  }
  return { id, boxed };
}

// The box sits two rows below the corridor floor, so its N Forge lines the corridor and
// the Arc itself is the next tower down — inside its own 6-tile range of both corridor
// rows.
const BOX_COL = CORRIDOR_COL;
const BOX_ROW = CORRIDOR_ROW + 2;

export default function item() {
  let towerId;
  let boxedFaces;
  let walls;
  let r;
  let t;
  let engaged = false;

  return {
    id: "cooling.boxed-bakes",

    // Boxing the emitter is instant and the bake to the trip is a few seconds of real
    // heat. Anything past this is a build whose target dawdles into range, which is a
    // pathing item's business, not this one's. See CLIP_HEADROOM_MS in _helpers.
    clipMs: 5000,

    // A boxed-in Arc with two real Cores to fire at, posed at 95 — with no open face
    // and no conduction drain, its own firing can only carry it up.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      walls = await buildCorridorWalls(api);
      ({ id: towerId, boxed: boxedFaces } = await boxWithForges(
        api,
        "arc",
        BOX_COL,
        BOX_ROW,
      ));
      await spawn(api, "core", "left");
      await spawn(api, "core", "left");
      await api.call("setHeat", towerId, 95); // near the redline; boxed, it can only rise
    },

    // Let the real firing/heat systems bake it to the trip. 600 ticks = the old 10s
    // cap; polling every tick catches the exact step it goes offline. The sweep also
    // notes whether the emitter ever engaged a target, so a scenario that failed to
    // give it one is reported as that rather than as a cooling fault.
    async act(api) {
      r = await api.until(
        (s) => {
          const t2 = s.towers.find((x) => x.id === towerId);
          if (t2 && (t2.firing || t2.damageDealt > 0)) engaged = true;
          return !!t2 && t2.tripped;
        },
        { max: 600, poll: TICK },
      );
      t = await tower(api, towerId);
      // The corridor puts the surge in front of the Arc immediately and a boxed Arc
      // posed at 95 trips on its first shot, so the sweep stops within a beat of the
      // drive starting. Hold on the baked-out tower rather than cutting on it.
      await actTail(api);
    },

    async assert(api, check) {
      check.expectEq(
        "the corridor routing the surge past it was built",
        walls,
        CORRIDOR_ROOF_WALLS,
      );
      check.expectEq("all four faces were boxed in", boxedFaces, 4);
      check.expectOk("the boxed-in emitter had a target to fire at", engaged);
      check.expectOk("the boxed-in emitter baked to the trip", r.hit);
      check.expectEq("it is tripped", t.tripped, true);
    },
  };
}
