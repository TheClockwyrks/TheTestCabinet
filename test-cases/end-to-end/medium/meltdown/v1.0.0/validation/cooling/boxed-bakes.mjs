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
// `buildGate` in `_helpers`). An Arc that never acquires a target never fires,
// its heat sits exactly where it was posed, and this item reports "did not trip" — a
// cooling failure that is really an out-of-range emitter.
//
// So the surge is routed rather than guessed at: the gate walls the floor from top to
// bottom with a two-row gap in it, and the box goes just short of that gap, close
// enough that every unit filing through sits well inside the Arc's 6-tile range. The
// box needs the whole cell the gate's own emitter would stand in, so only the WALL half
// of the gate is used here — and engagement is still asserted below, so this can never
// again be diagnosed as a heat bug.
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
  buildGateWall,
  gateCell,
  GATE_WALLS,
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

// The box is centred on the gate's own emitter cell, shifted two columns left so its
// east Forge lands where that emitter would have stood — the Arc at the middle of the
// plus is then under four tiles from the gap, well inside its 6-tile range, and the
// whole box stays a clear column short of the wall so no Sink ever touches it.
const BOX_COL = gateCell("arc").col - 2;
const BOX_ROW = gateCell("arc").row;

export default function item() {
  let towerId;
  let boxedFaces;
  let walls;
  let r;
  let online;
  let t;
  let engaged = false;

  return {
    id: "cooling.boxed-bakes",

    // Boxing the emitter is instant; the clip is the beat before the surge arrives, the
    // bake, and the beat after it. Anything past this is a build whose target dawdles
    // into range, which is a pathing item's business, not this one's. See
    // CLIP_HEADROOM_MS in _helpers.
    clipMs: 8000,

    // A boxed-in Arc posed at 95 — with no open face and no conduction drain, its own
    // firing can only carry it up. Nothing is spawned here: the surge is released in
    // `act`, so the clip opens on the tower hot and still ONLINE (see there).
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      walls = await buildGateWall(api);
      ({ id: towerId, boxed: boxedFaces } = await boxWithForges(
        api,
        "arc",
        BOX_COL,
        BOX_ROW,
      ));
      await api.call("setHeat", towerId, 95); // near the redline; boxed, it can only rise
    },

    // A beat on the loaded scenario, then the surge, then the bake.
    //
    // The lead-in is the point of the retiming. A boxed Arc posed at 95 with its targets
    // already walking trips on its first shot, within a frame or two of the recording
    // starting — so the old clip was a tower that had ALWAYS been red, and a reviewer
    // had no way to tell a tower that baked from one that was posed broken. Holding for
    // a second first establishes the before state: hot, near the redline, unmistakably
    // still running. The surge is then released on screen and the tower cooks itself off
    // in front of it. `setHeat` and `spawnUnit` are control ops and consume no time, so
    // the second costs the verdict nothing.
    //
    // Then the real firing/heat systems are left to bake it to the trip. 600 ticks = a
    // 10 s cap; polling every tick catches the exact step it goes offline. The sweep
    // also notes whether the emitter ever engaged a target, so a scenario that failed to
    // give it one is reported as that rather than as a cooling fault.
    async act(api) {
      await api.advance(60); // 1 s of the boxed Arc hot at 95 and still online
      online = await tower(api, towerId);

      await spawn(api, "core", "left");
      await spawn(api, "core", "left");

      r = await api.until(
        (s) => {
          const t2 = s.towers.find((x) => x.id === towerId);
          if (t2 && (t2.firing || t2.damageDealt > 0)) engaged = true;
          return !!t2 && t2.tripped;
        },
        { max: 600, poll: TICK },
      );
      t = await tower(api, towerId);
      // Hold on the baked-out tower rather than cutting on the frame it trips.
      await actTail(api);
    },

    async assert(api, check) {
      check.expectEq(
        "the gate routing the surge past it was built",
        walls,
        GATE_WALLS,
      );
      check.expectEq("all four faces were boxed in", boxedFaces, 4);
      // The before state, which the clip now opens on: boxed and hot is not the same
      // thing as tripped, and a build that posed the tower offline at 95 would make
      // everything below true without any baking having happened.
      check.expectEq(
        "it is still online before the surge arrives",
        online.tripped,
        false,
      );
      check.expectOk("the boxed-in emitter had a target to fire at", engaged);
      check.expectOk("the boxed-in emitter baked to the trip", r.hit);
      check.expectEq("it is tripped", t.tripped, true);
    },
  };
}
