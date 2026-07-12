// Valence — the controller battery run.ts uses for the balance goal checks.
//
// Each controller is a declarative build list applied greedily (harness.layoutController).
// Together they pin what "balanced" means (specs/towers.md, specs/matter.md):
//   1. energy-only spam must LOSE (no answer to heavies).
//   2. a no-detection board must LOSE (inert matter leaks).
//   3. a never-upgraded board must LOSE late.
//   4. a one-lane cluster must LOSE (the grid rewards coverage).
//   5. a competent mixed + upgraded + well-placed board must WIN.
//   6. (soft) both branch leanings can win — neither branch dominates.

import { ANCHORS, layoutController, type BuildOrder, type Controller } from "./harness";
import type { Branch, TowerKind } from "../src/constants";

// Pick every k-th cell from a lane run, so towers spread along it rather than clumping.
function spread(cells: number[], count: number, offset = 0): number[] {
  const out: number[] = [];
  const step = Math.max(1, Math.floor(cells.length / count));
  for (let i = 0; i < count; i++) {
    const idx = (offset + i * step) % cells.length;
    out.push(cells[idx]!);
  }
  return [...new Set(out)];
}

function order(kind: TowerKind, cell: number, level?: 1 | 2 | 3, branch?: Branch, minRound?: number): BuildOrder {
  return { kind, cell, level, branch, minRound };
}

export function controllerSet(): Controller[] {
  const A = ANCHORS.laneA();
  const Alow = ANCHORS.laneAlow();
  const B = ANCHORS.laneB();
  const Bhigh = ANCHORS.laneBhigh();
  const IN = ANCHORS.sharedIn();
  const OUT = ANCHORS.sharedOut();

  // --- 1. Energy-only spam: emitters + ionizers, no kinetic/nuclear, no detection. ---
  const spamCells = [...spread(A, 6), ...spread(B, 6), ...spread(IN, 2), ...spread(OUT, 2)];
  const spam = layoutController(
    "energy-spam",
    spamCells.map((c, i) => order(i % 2 ? "ionizer" : "emitter", c, i < 6 ? 3 : 2, i % 2 ? "A" : "A")),
    "all energy — should stall on heavies",
  );

  // --- 2. No-detection: a real mixed board, but nothing that sees inert matter. ---
  const nodetOrders: BuildOrder[] = [
    ...spread(A, 3).map((c) => order("ionizer", c, 3, "B")),
    ...spread(B, 3).map((c) => order("ionizer", c, 3, "B")),
    ...spread(Alow, 2).map((c) => order("cleaver", c, 3, "A")),
    ...spread(Bhigh, 2).map((c) => order("cleaver", c, 3, "A")),
    ...spread(OUT, 2).map((c) => order("reactor", c, 3, "A")),
  ];
  const nodet = layoutController("no-detection", nodetOrders, "no reveal/detect — inert leaks");

  // --- 3. Never-upgraded: a broad tier-I mix, no upgrades at all. ---
  const noupCells = [...spread(A, 5), ...spread(B, 5), ...spread(IN, 2), ...spread(OUT, 3)];
  const noup = layoutController(
    "no-upgrade",
    noupCells.map((c, i) => {
      const kinds: TowerKind[] = ["ionizer", "cleaver", "reactor", "catalyst", "emitter"];
      return order(kinds[i % kinds.length]!, c, 1);
    }),
    "tier-I only — should drown late",
  );

  // --- 4. One-lane cluster: everything competent, but all on Lane A. ---
  const oneLaneOrders: BuildOrder[] = [
    ...spread(A, 5).map((c) => order("ionizer", c, 3, "A")),
    ...spread(Alow, 3).map((c) => order("cleaver", c, 3, "B")),
    ...spread(A, 2, 3).map((c) => order("reactor", c, 3, "B")),
    ...spread(Alow, 2, 1).map((c) => order("catalyst", c, 3, "A")),
  ];
  const oneLane = layoutController("one-lane", oneLaneOrders, "ignores Lane B — should leak there");

  // --- 5. Competent: mixed types, both lanes, detection + kinetic + nuclear, upgraded. ---
  const competent = competentLayout("competent", "A");

  // --- 6a/6b. Branch leanings — the same competent shape, favouring A vs B branches. ---
  const leanA = competentLayout("lean-A", "A");
  const leanB = competentLayout("lean-B", "B");

  return [spam, nodet, noup, oneLane, competent, leanA, leanB];
}

// A competent board: ionizers eat the swarm on both lanes, cleavers open bonds and dent
// heavies, a reactor covers the merge, catalysts reveal inert matter, a moderator buys
// time, and a beam anchors the final run. `lean` picks which branch the flexible towers
// take, so we can check both branch families can win.
function competentLayout(name: string, lean: Branch): Controller {
  const A = ANCHORS.laneA();
  const Alow = ANCHORS.laneAlow();
  const B = ANCHORS.laneB();
  const Bhigh = ANCHORS.laneBhigh();
  const IN = ANCHORS.sharedIn();
  const OUT = ANCHORS.sharedOut();
  const ib: Branch = lean; // ionizer branch (A array/detect vs B overcharge)
  const cb: Branch = lean; // cleaver branch (A rend vs B impactor)
  const rb: Branch = lean; // reactor branch (A chain vs B fallout)

  const orders: BuildOrder[] = [
    // Openers on the early shared inlet approach (both lanes pass here).
    order("cleaver", IN[0] ?? spread(A, 1)[0]!, 3, cb),
    order("catalyst", IN[1] ?? spread(B, 1)[0]!, 3, "A", 4),
    // Lane A line — a wall of ionizers backed by cleavers to open bonds/dent heavies.
    ...spread(A, 4).map((c) => order("ionizer", c, 3, ib)),
    ...spread(Alow, 3).map((c) => order("cleaver", c, 3, cb, 3)),
    // Lane B line.
    ...spread(B, 4).map((c) => order("ionizer", c, 3, ib)),
    ...spread(Bhigh, 3).map((c) => order("cleaver", c, 3, cb, 3)),
    // A mid-lane catalyst per lane so the late inert combos are revealed on both lanes.
    order("catalyst", spread(Alow, 1, 6)[0]!, 3, "A", 10),
    order("catalyst", spread(Bhigh, 1, 6)[0]!, 3, "A", 12),
    // Merge coverage: two reactors for heavies + AoE, a moderator for pacing, a beam.
    ...spread(OUT, 2).map((c) => order("reactor", c, 3, rb, 7)),
    order("moderator", spread(A, 1, 5)[0]!, 3, "A", 2),
    order("moderator", spread(B, 1, 5)[0]!, 2, undefined, 9),
    order("beam", spread(Bhigh, 1, 2)[0]!, 3, "B", 6),
    order("beam", spread(Alow, 1, 2)[0]!, 3, "B", 11),
    // Fill: extra ionizers where the greedy has money spare late.
    ...spread(A, 3, 2).map((c) => order("ionizer", c, 3, ib, 8)),
    ...spread(B, 3, 2).map((c) => order("ionizer", c, 3, ib, 8)),
  ];
  const note = lean === "A" ? "mixed, A-branches — should WIN" : "mixed, B-branches — should WIN";
  return layoutController(name, orders, note);
}
