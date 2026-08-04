// Automated validation for the Bays item `layout`.
//
// There are five bays, each enterable at its own far-shore column, with solid shore
// between them that cannot be entered. Each bay is confirmed by a real hop up from a
// floe below its column filling that bay; a solid-shore column refuses the same hop.
// See validation/_helpers.mjs.
//
// EACH BAY IS PROBED AT THE COLUMN THE SPECIFICATION NAMES. specs/playfield.md puts the
// five two-tile openings "centered near columns 4, 12, 20, 28, and 36", which leaves the
// pair itself one tile ambiguous — `[3, 4]` and `[4, 5]` are both centered near column
// 4 — and this item used to require the LEFT column of one of those two readings, so a
// build that read it the other way had all five of its bays reported unenterable when
// every one of them was open one tile over. The named column is the one both readings
// contain (see `BAY_COL`), so it is what a bay is probed at; that there are five of
// them, each in its own place with impassable shore between, is what this item is for.
//
// THE FIVE HOPS ARE FILMED, because they are what the item checks. A still of the far
// shore shows five warm openings and says nothing about whether any of them can be
// entered — and "enterable at its own column" is the whole assertion. The clip walks
// the bays left to right, each one taken by a real hop from the water below it, and
// closes on the same hop being refused by the shore between two of them.
//
// AND EACH BAY GETS A CLEAN BOARD. Every fill ends a crossing, and what a build does
// next is its own business: it starts a fresh one, and it may lose it. One build
// audited against this case emerges a bear on the fresh critter's own spawn tile and
// catches it there, so by the third bay the run was over and the remaining bays read as
// closed — a verdict about this item's own subject, decided entirely by a defect
// belonging to `hunter.fair-reset-bay` (which does fail it). So each pass re-poses the
// board rather than assuming the last one left it playable: lives are topped back up,
// the run is restarted if the build ended it, and the loop waits out a death pause
// before posing the next bay. None of that can manufacture a fill — the hop still has
// to be accepted by the build's own far shore.

import {
  actPose,
  startCrossing,
  BAY_COL,
  ROW_BAYS,
  SHORE_COL,
  WATER_TOP,
} from "../_helpers.mjs";

// Lives topped back up before each pass, so a crossing lost between bays cannot end the
// run part-way through the walk.
const LIVES = 3;

// The beats around each hop: a moment on the posed bay, then the hop itself.
const LEAD_TICKS = 30; // 0.25 s under each bay
const HOP_TICKS = 18; // 0.15 s, just past the hop cooldown

// How long to wait for a live crossing before posing a bay. A death pause is about a
// second (specs/gameplay.md), so this covers one with room to spare.
const READY_TICKS = 240; // 2 s

/**
 * Put the board in a state where a posed hop can be driven at all: a live crossing,
 * with lives to spare. Returns nothing — every assertion is read from the hop itself.
 */
async function readyCrossing(api) {
  const s = await api.snapshot();
  // A build that has ended the run cannot be hopped at all; start another so the walk
  // can carry on. `reset` is not used: the runtime hands the clock back after it, but a
  // fresh title screen mid-clip is a worse thing for a reviewer to watch than a fresh
  // run.
  // Through `actPose`, so a build that switches itself to manual stepping when a run
  // begins does not leave the rest of the walk filming a frozen board.
  if (s.screen !== "playing") await actPose(api, "startGame");
  await api.call("setLives", LIVES);
  await api.until((s2) => s2.screen === "playing" && s2.phase === "crossing", {
    max: READY_TICKS,
    poll: 6,
  });
}

export default function item() {
  // Whether each bay filled, and the critter's row after the solid-shore hop.
  let filled;
  let shoreRow;

  return {
    id: "bays.layout",

    // One fresh crossing is all `arrange` needs. Every bay in turn is re-posed inside
    // `act` with control ops alone (`setBays` / `setLane` / `placeCritter`), which set
    // the board without the reset `startCrossing` performs — a reset in `act` would hand
    // the build back its manual clock and silently freeze the recording.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
    },

    // Walk the five bay columns, hopping up into each from a floe below it, then the
    // solid shore between two of them. Each pose is instant, so the clip is the five
    // fills and the one refusal, back to back.
    async act(api) {
      filled = [];
      for (let i = 0; i < BAY_COL.length; i += 1) {
        const col = BAY_COL[i];
        await readyCrossing(api);
        await api.call("setBays", [false, false, false, false, false]);
        await api.call("setLane", WATER_TOP, { cols: [col], speed: 0 });
        await api.call("placeCritter", col, WATER_TOP);
        await api.advance(LEAD_TICKS);
        await api.call("press", "ArrowUp");
        await api.advance(HOP_TICKS);
        filled.push((await api.snapshot()).bays[i] === true);
      }

      // A solid-shore column between bays refuses the hop.
      await readyCrossing(api);
      await api.call("setBays", [false, false, false, false, false]);
      await api.call("setLane", WATER_TOP, { cols: [SHORE_COL], speed: 0 });
      await api.call("placeCritter", SHORE_COL, WATER_TOP);
      await api.advance(LEAD_TICKS);
      await api.call("press", "ArrowUp");
      await api.advance(HOP_TICKS);
      shoreRow = (await api.snapshot()).critter.row;
      await api.advance(LEAD_TICKS); // camera only: the critter still below the wall
    },

    async assert(api, check) {
      for (let i = 0; i < BAY_COL.length; i += 1) {
        check.expectEq(
          `bay ${i} is enterable at column ${BAY_COL[i]}`,
          filled[i],
          true,
        );
      }
      check.expectNe(
        "the solid shore between bays cannot be entered",
        shoreRow,
        ROW_BAYS,
      );
      check.expectEq(
        "and the refused hop leaves the critter where it was",
        shoreRow,
        WATER_TOP,
      );
    },
  };
}
