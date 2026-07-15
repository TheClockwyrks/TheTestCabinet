// Locomotivation — scripted competent routes, one per campaign level (specs/levels.md).
//
// A route is the "competent play" the beatability invariant is measured against: an ordered
// list of actions a skilled courier performs — fetch a package, haul it across the live
// corridors reading the deterministic train schedules, deliver it, and return — until the
// required quota is met. The RouteController (sim/strategies.ts) EXECUTES a route against the
// pure core: it drives the worker along each `dash`'s waypoints, but before committing a dash
// that enters a lethal train band it GATES on the schedule (waits on the safe tile until the
// crossing is clear for the whole predicted traversal). So the routes here encode *where* a
// competent player goes; the controller supplies *when* it is safe to move.
//
// Authoring rules (kept invariant so the controller's gating is exact):
//   • Every `dash` starts and ends on a SAFE tile (Ground/Refuge, off every train band) so the
//     worker can wait there. Only the transient middle of a committed dash is ever in a band.
//   • Each dash contains AT MOST ONE crossing event (one contiguous danger region) with safe
//     tiles either side, so independent crossings gate — and wait — independently.
//   • Every leg between consecutive waypoints is a single axis (same col OR same row), so the
//     driven path matches the sampled path the gate predicts.
//   • Pick-ups happen with the worker standing on (or one tile from) the source; deliveries are
//     automatic on entering a color-matched drop zone, so a dash that ends on a zone delivers.

import type { TileCoord } from "../src/types";

/** One step of a scripted route. */
export type RouteAction =
  | { k: "dash"; to: TileCoord[] } // atomic gated move through waypoints (from the current tile)
  | { k: "grab"; count?: number } // pick up `count` (default 1) at the current spot, waiting out refills
  | { k: "lever"; id: string; thrown?: boolean } // toggle a junction lever to `thrown` (default true)
  | { k: "idle"; sec: number }; // stand safely in place for `sec` seconds

export interface Route {
  actions: RouteAction[];
}

// ─── Tiny builders ────────────────────────────────────────────────────────────────────

/** A dash through the given (col,row) waypoints, in order, from wherever the worker is. */
function dash(...pts: [number, number][]): RouteAction {
  return { k: "dash", to: pts.map(([col, row]) => ({ col, row })) };
}
const grab: RouteAction = { k: "grab" };
/** Batch-fetch `n` light packages from a dispenser in one stop (competent parcel play). */
function grabN(n: number): RouteAction {
  return { k: "grab", count: n };
}

/** Climb/descend a single column through a fixed row sequence (one dash per step). */
function ladder(col: number, rows: number[]): RouteAction[] {
  return rows.map((r) => dash([col, r]));
}

// ─── Level 1 — "First Shift" ────────────────────────────────────────────────────────────
// One commuter on row 8. Fetch a Red parcel at the depot (3,13), carry it up over the lane to
// the yard office (4,2), deliver, return. Three light parcels, one at a time (stay sprint-able).

function routeL1(): Route {
  // Three light parcels batch into one haul (90 units = 0.75 cap: still sprint-able), so this is
  // a single up-and-over trip. Learning to read the one commuter is the whole lesson.
  return {
    actions: [
      dash([3, 13]),
      grabN(3),
      dash([4, 13], [4, 2]), // right to col 4, up across row 8 → deliver all three
    ],
  };
}

// ─── Level 2 — "The Yard" ───────────────────────────────────────────────────────────────
// Two lanes (commuter row 7 east, freight row 9 west) with a safe gap (row 8) between. Red and
// Blue depots/zones sit on opposite corners — every haul is a diagonal criss-cross that crosses
// BOTH lanes. Reds from the left, then blues from the right. Cross both lanes in one dash (they
// are one contiguous corridor, so one clear window serves both).

function routeL2(): Route {
  const actions: RouteAction[] = [];
  // Batch all 3 Red parcels in one stop, one diagonal haul to the far corner (30,1). The corridor
  // is two lanes (commuter row 7, freight row 9) with a safe gap (row 8) — hop to the gap, wait,
  // hop off, exactly as the schedules allow.
  actions.push(dash([3, 13]));
  actions.push(grabN(3));
  actions.push(dash([3, 8])); // up col 3, CROSS the freight lane (row 9) → safe gap (row 8)
  actions.push(dash([3, 2])); // CROSS the commuter lane (row 7) → safe top
  actions.push(dash([30, 2])); // traverse the safe top east
  actions.push(dash([30, 1])); // up to the Red zone → deliver 3
  // Return empty, then batch 3 Blue from (24,13) to (1,1).
  actions.push(dash([30, 2]));
  actions.push(dash([24, 2]));
  actions.push(dash([24, 8])); // CROSS row 7 down → gap
  actions.push(dash([24, 13])); // CROSS row 9 down → the Blue depot
  actions.push(grabN(3));
  actions.push(dash([24, 8])); // CROSS row 9 up → gap
  actions.push(dash([24, 2])); // CROSS row 7 up → safe top
  actions.push(dash([1, 2])); // traverse the safe top west
  actions.push(dash([1, 1])); // up to the Blue zone → deliver 3
  actions.push(dash([1, 3])); // park clear
  return { actions };
}

// ─── Level 3 — "Trestle" ────────────────────────────────────────────────────────────────
// A full-height river gap (cols 12–19) splits the yard; the upper COMMUTER bridge (row 4) is the
// crossing the competent courier favors (a shorter, more frequent gap than the lower freight
// trestle). Fetch Blue crates bottom-left (3,13), carry over the bridge to the top-right zone
// (28,1). Then the Red UNIQUE (a Load) bottom-right (28,13) back over the bridge to (3,1).
// The lower freight lane (row 11) carries the last train — the worker parks clear of it after
// the quota is met and lets the shift's final seconds play out.

// The commuter runs the FULL width of row 4, so the whole row is lethal when a train is on it —
// the "ground" tiles flanking the bridge deck are still in the lane. The courier therefore WAITS
// off the lane, on row 5 (below) at the banks, and crosses bank-to-bank in one gated sprint,
// entering at col 11 and leaving at col 20 (the gap forbids ducking off mid-span except at the
// refuges, which the tuned commuter period makes unnecessary).
const L3_ROW = 4; // commuter bridge lane
const L3_W = 11; // west bank column (on-lane at row 4; wait one row off, at (11,5))
const L3_E = 20; // east bank column

const crossE = dash([L3_W, L3_ROW], [L3_E, L3_ROW], [L3_E, 5]); // from (11,5): up onto the lane, east, down off
const crossW = dash([L3_E, L3_ROW], [L3_W, L3_ROW], [L3_W, 5]); // from (20,5): up onto the lane, west, down off

function routeL3(): Route {
  const actions: RouteAction[] = [];
  // 3 Blue crates: depot (3,13) → zone (28,1), over the commuter bridge.
  actions.push(dash([3, 13]));
  for (let i = 0; i < 3; i++) {
    actions.push(grab);
    actions.push(dash([3, 5])); // up the safe west bank
    actions.push(dash([L3_W, 5])); // to the west approach (wait tile, off the lane)
    actions.push(crossE); // CROSS to the east bank
    actions.push(dash([28, 5])); // east bank to col 28
    actions.push(dash([28, 1])); // up to the Blue zone → deliver
    actions.push(dash([28, 5])); // back down to row 5
    actions.push(dash([L3_E, 5])); // to the east approach
    actions.push(crossW); // CROSS back to the west bank
    actions.push(dash([3, 5], [3, 13])); // down the west bank to the depot
  }
  // Red UNIQUE (Load): fetch (28,13) across the gap, carry back to (3,1).
  actions.push(dash([3, 5]));
  actions.push(dash([L3_W, 5]));
  actions.push(crossE);
  actions.push(dash([28, 5], [28, 13])); // down the east bank to the unique
  actions.push(grab);
  actions.push(dash([28, 5])); // back up to row 5
  actions.push(dash([L3_E, 5]));
  actions.push(crossW);
  actions.push(dash([3, 5], [3, 1])); // west bank up to the Red zone → deliver
  // Quota met; park clear of every lane (the freight last train runs on row 11).
  actions.push(dash([3, 7]));
  return { actions };
}

// ─── Level 4 — "Interchange" ────────────────────────────────────────────────────────────
// Upper commuter (row 3) + bullet (row 5) corridor, lower freight (row 10). Fetch/deliver run
// full height, crossing rows 10, 5, 3 one band at a time. Blue quota from the far-left depot to
// the far-right zone; two uniques (Red crate, Green load). The lever is optional texture — the
// competent courier simply reads the bullet's schedule rather than diverting it.

// Full-height ladder for L4: safe stops with a single band between consecutive stops.
//   from row 12/13 up: 11→9 crosses row10, 6→4 crosses row5, 4→2 crosses row3, 2→1 tops out.

function routeL4(): Route {
  const actions: RouteAction[] = [];
  // 3 Blue crates: depot (3,12) → zone (27,1). Traverse the safe bottom to the destination
  // column, then climb it (crossing rows 10, 5, 3 one band at a time).
  actions.push(dash([3, 12]));
  for (let i = 0; i < 3; i++) {
    actions.push(grab);
    actions.push(dash([27, 12])); // traverse the safe bottom to the destination column
    actions.push(dash([27, 11]));
    actions.push(...ladder(27, [9, 6, 4, 2, 1])); // climb, crossing rows 10,5,3
    // (27,1) is the Blue zone → deliver
    actions.push(...ladder(27, [2, 4, 6, 9, 11])); // descend back
    actions.push(dash([27, 12]));
    actions.push(dash([3, 12])); // traverse back to the depot
  }
  // Red UNIQUE (crate) at (11,12) → Red zone (1,1).
  actions.push(dash([11, 12]));
  actions.push(grab);
  actions.push(dash([11, 11]));
  actions.push(...ladder(11, [9, 6, 4, 2])); // climb to the safe top row
  actions.push(dash([1, 2])); // traverse the top to col 1
  actions.push(dash([1, 1])); // deliver Red
  // Green UNIQUE (load) at (22,12) → Green zone (12,1).
  actions.push(dash([1, 2]));
  actions.push(dash([22, 2]));
  actions.push(...ladder(22, [4, 6, 9, 11, 12])); // descend to the unique row
  actions.push(dash([22, 12]));
  actions.push(grab);
  actions.push(dash([22, 11]));
  actions.push(...ladder(22, [9, 6, 4, 2])); // climb
  actions.push(dash([12, 2])); // traverse to the Green zone column
  actions.push(dash([12, 1])); // deliver Green
  // Quota met; park clear of the freight last-train lane (row 10).
  actions.push(dash([12, 2]));
  return { actions };
}

// ─── Level 5 — "Rush Hour" ──────────────────────────────────────────────────────────────
// Four lanes: commuter row 2 (E), freight row 4 (W), bullet row 7 (E), commuter row 11 (W, the
// last-train lane). Blue is a short LOW haul (depot (3,13) → zone (2,9), crossing only row 11).
// Green (2 crates + a Load unique) and the Red Load unique are the full-height hauls to the top,
// crossing all four bands. This is the hard shift.

// bands rows 2,4,7,11. safe rows: 1,3,5,6,8,9,10,12,13. Ladder up a column bottom→top:
//   13→12(safe) 12→10(CROSS row11) 10→8(safe) 8→6(CROSS row7) 6→5(safe) 5→3(CROSS row4) 3→1(CROSS row2)
const L5_CLIMB = [12, 10, 8, 6, 5, 3, 1];
const L5_DESC = [3, 5, 6, 8, 10, 12, 13];

function routeL5(): Route {
  const actions: RouteAction[] = [];
  // 3 Blue parcels batch into one short LOW haul: (3,13) → (2,9), crossing only row 11.
  actions.push(dash([3, 13]));
  actions.push(grabN(3));
  actions.push(dash([3, 12]));
  actions.push(dash([3, 10])); // CROSS row 11
  actions.push(dash([2, 10]));
  actions.push(dash([2, 9])); // deliver 3 Blue
  actions.push(dash([2, 10]));
  actions.push(dash([3, 10])); // CROSS row 11 back
  actions.push(dash([3, 12]));
  // 2 Green crates: depot (9,13) → zone (22,1) top-right.
  actions.push(dash([9, 13]));
  for (let i = 0; i < 2; i++) {
    actions.push(grab);
    actions.push(...ladder(9, L5_CLIMB.slice(1))); // 12→…→1 (start already at row 13)
    actions.push(dash([22, 1])); // traverse the top to the Green zone → deliver
    actions.push(dash([9, 1]));
    actions.push(...ladder(9, L5_DESC));
  }
  // Green UNIQUE (Load) at (23,13) → (22,1).
  actions.push(dash([23, 13]));
  actions.push(grab);
  actions.push(...ladder(23, L5_CLIMB.slice(1)));
  actions.push(dash([22, 1])); // deliver Green unique
  // Red UNIQUE (Load) at (15,13) → (1,1).
  actions.push(dash([15, 1]));
  actions.push(...ladder(15, L5_DESC));
  actions.push(dash([15, 13]));
  actions.push(grab);
  actions.push(...ladder(15, L5_CLIMB.slice(1)));
  actions.push(dash([1, 1])); // deliver Red unique
  // Quota met; park clear of the row-11 commuter last-train lane.
  actions.push(dash([1, 3]));
  return { actions };
}

// ─── Level 6 — "Last Train Out" (finale) ────────────────────────────────────────────────
// Bullet row 2 (E, cols 0–29), commuter row 5 (W), freight row 10 (E, the bridged last-train
// lane). A lower gap zone forces the low hauls along the all-ground bottom row (13). All Blue
// (2 parcels + a crate unique) go to the LOW-LEFT zone (2,12) — a cheap bottom shuffle. The
// heavy top hauls are Green (a crate + a Load unique) to (10,1) and the Red Load unique to
// (1,1), climbing the safe LEFT corridor (col 8) across rows 10, 5, 2.

// Left-corridor ladder for L6. bands rows 2,5,10. safe rows: 1,3,4,6,7,8,9,11,12,13.
//   13→11(safe) 11→9(CROSS row10) 9→6(safe) 6→4(CROSS row5) 4→3(safe) 3→1(CROSS row2)
const L6_CLIMB = [11, 9, 6, 4, 3, 1];
const L6_DESC = [3, 4, 6, 9, 11, 13];
const L6_COL = 8; // left up-corridor column (Ground at rows 11,12; crosses the three bands)

function routeL6(): Route {
  const actions: RouteAction[] = [];
  // Blue: 2 parcels from (3,13) batch into one bottom shuffle to the LOW zone (2,12).
  actions.push(dash([3, 13]));
  actions.push(grabN(2));
  actions.push(dash([2, 13]));
  actions.push(dash([2, 12])); // deliver 2 Blue low (no band between row 13 and row 12 at col 2)
  // Blue crate unique along the bottom to the low zone.
  actions.push(dash([23, 13]));
  actions.push(grab);
  actions.push(dash([2, 13]));
  actions.push(dash([2, 12])); // deliver Blue unique
  // Green: crate depot (6,13) + Load unique (15,13) → Green zone (10,1), up the left corridor.
  actions.push(dash([6, 13]));
  actions.push(grab); // green crate
  actions.push(dash([L6_COL, 13]));
  actions.push(...ladder(L6_COL, L6_CLIMB));
  actions.push(dash([10, 1])); // deliver Green (crate)
  actions.push(dash([L6_COL, 1]));
  actions.push(...ladder(L6_COL, L6_DESC));
  actions.push(dash([15, 13]));
  actions.push(grab); // green load unique
  actions.push(dash([L6_COL, 13]));
  actions.push(...ladder(L6_COL, L6_CLIMB));
  actions.push(dash([10, 1])); // deliver Green unique
  // Red Load unique (19,13) → (1,1), up the left corridor.
  actions.push(dash([L6_COL, 1]));
  actions.push(...ladder(L6_COL, L6_DESC));
  actions.push(dash([19, 13]));
  actions.push(grab);
  actions.push(dash([L6_COL, 13]));
  actions.push(...ladder(L6_COL, L6_CLIMB));
  actions.push(dash([1, 1])); // deliver Red unique
  // Quota met; park clear of the freight last-train lane (row 10).
  actions.push(dash([1, 3]));
  return { actions };
}

export const ROUTES: Record<number, Route> = {
  1: routeL1(),
  2: routeL2(),
  3: routeL3(),
  4: routeL4(),
  5: routeL5(),
  6: routeL6(),
};
