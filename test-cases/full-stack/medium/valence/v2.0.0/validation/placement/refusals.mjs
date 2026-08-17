// Automated validation for the Placement sub-item `refusals`.
//
// An illegal placement is refused with the correct reason. The check drives the real
// placement path at points chosen to trip each rule: exactly ON a path (reason
// `path`), out of bounds (`bounds`), over an existing tower (`overlap`), and — with the
// bank emptied — unaffordable (`cost`). Each refusal must name its own reason.
//
// The verdict comes from those four reason codes. The STILL comes from somewhere else —
// a held tower whose ghost is sitting on an illegal spot — because a refused `placeTower`
// changes nothing on screen and a picture of an unchanged board is not evidence of a
// refusal. See the note in `act`.

import {
  startRun,
  pathGeom,
  MAP,
  HUGE_ENERGY,
  STAGE_W,
  STAGE_H,
} from "../_helpers.mjs";

// The shop hotkey that holds an Emitter for placement. specs/controls.md binds "`1`–`7`
// for the seven towers in shop order" and specs/towers.md lists that order — the five
// damage towers, Emitter first, then the two support auras — so `Digit1` is the Emitter
// this item has been refusing all along.
const EMITTER_HOTKEY = "Digit1";

export default function item() {
  let onPath;
  let nx;
  let ny;
  let legal;
  let rPath;
  let rBounds;
  let rFirst;
  let rOverlap;
  let rCost;

  return {
    id: "placement.refusals",

    // Only the board and the four points are set up here; every attempt is the behavior.
    async arrange(api) {
      const snap = await startRun(api, MAP.single, { energy: HUGE_ENERGY });
      const g = pathGeom(snap.paths[0]);
      onPath = g.pointAt(g.length * 0.2);
      nx = -Math.sin(onPath.ang);
      ny = Math.cos(onPath.ang);
      legal = { x: onPath.x + nx * 48, y: onPath.y + ny * 48 };
    },

    // The four attempts, in the order that makes each rule the one that trips. They are
    // control ops, so no simulation time passes — the clip is the board being tried and
    // refused, ending on the state the last refusal left.
    async act(api) {
      // On a path -> refused with reason "path".
      rPath = await api.call("placeTower", "emitter", onPath.x, onPath.y);

      // Out of bounds -> refused with reason "bounds".
      rBounds = await api.call("placeTower", "emitter", 3, 3);

      // A first legal tower succeeds; a second at the same spot overlaps it.
      rFirst = await api.call("placeTower", "emitter", legal.x, legal.y);
      rOverlap = await api.call("placeTower", "emitter", legal.x, legal.y);

      // Unaffordable -> refused with reason "cost".
      await api.call("setEnergy", 0);
      rCost = await api.call(
        "placeTower",
        "emitter",
        onPath.x - nx * 64,
        onPath.y - ny * 64,
      );

      // ---- The evidence -------------------------------------------------------
      //
      // Everything above is control ops, which draw nothing: a refused `placeTower` leaves
      // the board exactly as it found it. So a still taken here used to show one legal
      // tower sitting on an ordinary board — a picture of a placement that WORKED, backing
      // an item about placements that do not.
      //
      // What a player actually sees when a spot is illegal is the held tower's ghost:
      // specs/board.md — "While a tower is held for placement, its ghost follows the
      // pointer, its range is previewed as a ring, and an illegal spot ... is clearly
      // refused" — and specs/controls.md, "the cursor then shows the held tower following
      // the pointer and its range ring, cued for whether the spot under the pointer is
      // legal". That cue is a POINTER state, so it is reached by holding a tower and
      // putting the pointer somewhere illegal, not by any control op.
      //
      // The bank is refilled first, so the spot under the pointer is refused for being ON
      // THE PATH — the rule this still is meant to illustrate — rather than for costing
      // more than the 0 the affordability probe left behind.
      await api.call("setEnergy", HUGE_ENERGY);
      await api.call("press", EMITTER_HOTKEY);

      // `userDoubleClick` is the only pointer primitive that lands on an exact board
      // point (it takes fractions of the game canvas, as `pixel` does; `userClick` takes
      // viewport pixels and is for arming audio in a corner). Its two presses are two more
      // attempts on the same illegal spot, both refused for the same reason as `rPath`
      // above, and specs/controls.md keeps build mode active through them — "Build mode
      // stays active so you can place several of a type in a row". What it leaves behind
      // is the pointer parked on the path with the tower still held: the refusal cue, on
      // screen, which is the picture this item wanted.
      await api.userDoubleClick(onPath.x / STAGE_W, onPath.y / STAGE_H);

      await api.settle(250);
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectOk("placing on a path is refused", rPath.ok === false);
      check.expectEq("...with reason 'path'", rPath.reason, "path");

      check.expectOk("placing out of bounds is refused", rBounds.ok === false);
      check.expectEq("...with reason 'bounds'", rBounds.reason, "bounds");

      check.expectOk("a legal off-path spot is accepted", rFirst.ok === true);
      check.expectOk("placing over a tower is refused", rOverlap.ok === false);
      check.expectEq("...with reason 'overlap'", rOverlap.reason, "overlap");

      check.expectOk(
        "an unaffordable placement is refused",
        rCost.ok === false,
      );
      check.expectEq("...with reason 'cost'", rCost.reason, "cost");
    },
  };
}
