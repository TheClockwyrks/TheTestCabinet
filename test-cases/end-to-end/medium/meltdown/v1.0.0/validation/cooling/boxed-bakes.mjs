// Automated validation for the Surface-cooling sub-item `boxed-bakes`.
//
// A firing emitter boxed in on every face cannot shed its heat and bakes itself to
// the trip (specs/heat.md). We box an Arc with a Forge on each of its four faces
// (the Forge and Sink have no heat and do not conduct, so a boxing mover seals the
// surface off without becoming a drain), give it a real Core target, and pose it near
// its redline; with zero air-facing edges and no conduction drain, its own firing
// carries it to 100 and the real trip system takes it offline.
//
// The emitter has to be able to REACH the lane, which is what makes the row below a
// load-bearing choice rather than an arbitrary one. The left vent's rows 16..19 are
// all equally short routes to the right exhaust, so which of them the surge actually
// walks is the build's own tie-break, and a build that hugs row 16 leaves anything
// below row 21 outside an Arc's 6-tile range. Boxed at row 22 the Arc never acquires
// a target, so it never fires, its heat sits exactly where it was posed, and the item
// reports "did not trip" — a cooling failure that is really an out-of-range emitter.
// Row 20 is within range of every row the vent can choose, and engagement is asserted
// below so this can never again be diagnosed as a heat bug.
//
// Engagement is read from `damageDealt`, not from `firing`. `firing` is true only on
// the step a shot actually goes out, and a boxed Arc posed at 95 trips on its FIRST
// shot (10.3 heat per shot carries it straight past 100), so the tick that would report
// `firing` is the tick it goes offline — and a tripped tower is not firing. The
// lifetime damage tally is the durable evidence that it had something to shoot at.

import { newGame, build, spawn, tower, TICK } from "../_helpers.mjs";

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

export default function item() {
  let towerId;
  let boxedFaces;
  let r;
  let t;
  let engaged = false;

  return {
    id: "cooling.boxed-bakes",

    // A boxed-in Arc with two real Cores to fire at, posed at 95 — with no open face
    // and no conduction drain, its own firing can only carry it up.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      ({ id: towerId, boxed: boxedFaces } = await boxWithForges(
        api,
        "arc",
        8,
        20,
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
    },

    async assert(api, check) {
      check.expectEq("all four faces were boxed in", boxedFaces, 4);
      check.expectOk("the boxed-in emitter had a target to fire at", engaged);
      check.expectOk("the boxed-in emitter baked to the trip", r.hit);
      check.expectEq("it is tripped", t.tripped, true);
    },
  };
}
