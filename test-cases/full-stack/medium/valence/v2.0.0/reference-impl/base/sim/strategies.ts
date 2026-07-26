// Valence — the controller battery run.ts uses for the balance goal checks.
//
// Each controller is a declarative build list applied greedily (harness.layoutController).
// Together they pin what "balanced" means (specs/towers.md, specs/matter.md):
//   1. energy-only spam must LOSE (no answer to heavies).
//   2. a no-detection board must LOSE (inert matter leaks).
//   3. a never-upgraded board must LOSE late.
//   4. a one-lane cluster must LOSE (coverage matters — free placement, both lanes).
//   5. a competent mixed + upgraded + well-placed board must WIN.
//   6. (soft) both branch leanings can win — neither branch dominates.

import { ANCHORS, layoutController, type BuildOrder, type Controller } from "./harness";
import type { Pt } from "../src/board";
import type { Branch, TowerKind } from "../src/constants";

// Pick every k-th anchor from a lane run, so towers spread along it rather than clumping.
function spread(pts: Pt[], count: number, offset = 0): Pt[] {
  const out: Pt[] = [];
  const step = Math.max(1, Math.floor(pts.length / count));
  for (let i = 0; i < count; i++) {
    const idx = (offset + i * step) % pts.length;
    out.push(pts[idx]!);
  }
  return [...new Set(out)];
}

function order(kind: TowerKind, at: Pt, level?: 1 | 2 | 3, branch?: Branch, minRound?: number): BuildOrder {
  return { kind, at, level, branch, minRound };
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

// A competent board, built the way the round table asks for it. The opening nineteen
// rounds are nothing but free atoms, so the board opens cheap and wide on energy damage
// and only buys a capability shortly before the round that first demands it: kinetic ahead
// of the bonded clusters, detection ahead of the shielded matter, nuclear ahead of the
// isotopes, and the heavy hitters for the last stretch. `lean` picks which branch the
// flexible towers take, so we can check both branch families can win.
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
    // Opening board: cheap energy coverage on both lanes, all the early rounds need.
    ...spread(A, 2).map((c) => order("emitter", c, 1)),
    ...spread(B, 2).map((c) => order("emitter", c, 1)),
    // Thicken the line as the atom swarms grow, then start upgrading it.
    ...spread(A, 2, 3).map((c) => order("ionizer", c, 1, ib, 2)),
    ...spread(B, 2, 3).map((c) => order("ionizer", c, 1, ib, 3)),
    order("moderator", spread(IN, 1)[0] ?? spread(A, 1)[0]!, 1, undefined, 5),
    ...spread(A, 2).map((c) => order("emitter", c, 2, undefined, 7)),
    ...spread(B, 2).map((c) => order("emitter", c, 2, undefined, 8)),
    ...spread(A, 2, 3).map((c) => order("ionizer", c, 3, ib, 10)),
    ...spread(B, 2, 3).map((c) => order("ionizer", c, 3, ib, 12)),
    // Kinetic, before the first bonded clusters arrive.
    ...spread(Alow, 2).map((c) => order("cleaver", c, 2, cb, 16)),
    ...spread(Bhigh, 2).map((c) => order("cleaver", c, 2, cb, 17)),
    // Detection, before the first shielded matter arrives.
    order("catalyst", spread(IN, 1, 1)[0] ?? spread(A, 1, 1)[0]!, 1, "A", 21),
    // Nuclear, before the first isotopes arrive.
    ...spread(OUT, 1).map((c) => order("reactor", c, 2, rb, 24)),
    ...spread(Alow, 2).map((c) => order("cleaver", c, 3, cb, 26)),
    ...spread(Bhigh, 2).map((c) => order("cleaver", c, 3, cb, 27)),
    // The late board: a second detector, long-range anchors, and the rest upgraded out.
    order("catalyst", spread(Bhigh, 1, 6)[0]!, 3, "A", 29),
    ...spread(OUT, 1, 1).map((c) => order("reactor", c, 3, rb, 30)),
    order("beam", spread(Alow, 1, 2)[0]!, 3, "B", 32),
    order("beam", spread(Bhigh, 1, 2)[0]!, 3, "B", 34),
    ...spread(A, 3, 1).map((c) => order("ionizer", c, 3, ib, 35)),
    ...spread(B, 3, 1).map((c) => order("ionizer", c, 3, ib, 36)),
    order("moderator", spread(B, 1, 5)[0]!, 3, "A", 37),
  ];
  const note = lean === "A" ? "mixed, A-branches — should WIN" : "mixed, B-branches — should WIN";
  return layoutController(name, orders, note);
}
