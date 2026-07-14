// Arc Foundry — the controller battery run.ts drives for the balance goal checks.
//
// Each controller plays the game through the input-free control API only (the harness
// pullAndPlace / devPlaceNear / combineUp helpers), so a simulated match is identical
// to a played one. Together they pin what "balanced" means for a GemTD reskin
// (specs/build.md, specs/board.md, specs/towers.md):
//
//   • naive       — keep every random stamp where it lands, never combine, no maze.   LOSE
//   • no-combine  — maze well, but never combine (stuck on the low rungs).             LOSE
//   • no-maze     — combine up the ladder, but clump the guns (route never folds).     LOSE/STRUGGLE
//   • competent   — build the planned maze, combine matches up the ladder, sane        WIN (medium)
//                   targeting, recycle chaff for rolls.
//   • lean-*      — (soft) competent maze, but climb only ONE type's ladder — checks
//                   no single component type carries the game on its own.
//
// Because the press roll is RANDOM, each controller is a FACTORY (fresh closure state
// per match) and run.ts averages it over many seeds into a win rate.

import {
  COMPONENT_ORDER,
  STAMP_COST,
  combineUp,
  devPlaceNear,
  pullAndPlace,
  type BuildCtx,
  type Component,
  type ComponentType,
  type Controller,
  type Tier,
} from "./harness";
import { clumpFor, type Anchor } from "./mazes";
import type { Game } from "../src/sim";

// ---- Shared building blocks -----------------------------------------------------

// A tier target that climbs with the wave — the funded (mechanics-only) path places at
// this quality. Funded is a BEST-CASE probe (unlimited resources), so it climbs fast:
// if a degenerate board loses even at these tiers, the loss is MECHANICAL (geometry),
// not economic.
function tierForWave(wave: number): Tier {
  if (wave < 4) return 3;
  if (wave < 10) return 4;
  return 5;
}

// The wall skeleton competent keeps as MAZE — combining only ever spends the SURPLUS
// above this into carries, so the route stays long while a handful of towers climb the
// ladder. It must sit BELOW the running placement count (≈4–5/wave) so there is always
// a surplus to combine; a good GemTD board is bimodal — dozens of T1 wall-chaff plus a
// few T4/T5 carries — so this floor is deliberately generous but well under the total.
function mazeFloor(wave: number, mazeSize: number): number {
  return Math.min(mazeSize, Math.round(10 + wave * 1.1));
}

// Pull-and-place the whole 5-stamp allowance toward the planned maze, advancing an
// index so the serpentine fills in order across build phases. Returns the new index.
function fillMaze(g: Game, anchors: Anchor[], idx: number): number {
  let guard = 0;
  while (g.canStamp() && guard++ < 12) {
    const target = anchors[idx % anchors.length]!;
    if (pullAndPlace(g, target)) idx++;
  }
  return idx;
}

// A T1 component that can never climb (no same-type partner on the board) — chaff that
// is safe to slag into a wall (it keeps walling, refunds Charge; specs/build.md §6.4).
function spareT1(g: Game): Component | null {
  for (const s of g.structures) {
    if (s.kind === "component" && s.tier === 1 && !g.combinePartnerOf(s)) return s;
  }
  return null;
}

// Point discharge rigs at the STRONGEST unit (anti-tank / boss); leave everything else
// on the default FIRST (furthest along the chain), which is the best anti-leak pick.
function targeting(g: Game): void {
  for (const s of g.structures) {
    if (s.kind === "component" && s.type === "discharge") g.setTargeting(s, "strongest");
  }
}

// Funded fill: devPlace `count` anchors (exact type/tier), tracking an index so it only
// ever adds. `tierFn` scales quality with the wave; `typeFn` picks the type per slot.
function fundedFill(
  g: Game,
  anchors: Anchor[],
  count: number,
  idx: number,
  tier: Tier,
  typeFn: (i: number) => ComponentType,
): number {
  while (idx < Math.min(count, anchors.length)) {
    devPlaceNear(g, typeFn(idx), tier, anchors[idx]!);
    idx++;
  }
  return idx;
}

// ---- The battery ----------------------------------------------------------------

export function controllerSet(): Controller[] {
  return [naive(), noCombine(), noMaze(), competent(), leanType("lean-arcnode", "arcnode"), leanType("lean-discharge", "discharge")];
}

// naive — every random stamp kept where it lands (a rough central scatter), never
// combined, no deliberate maze. Low tiers + a near-straight route → should LOSE.
function naive(): Controller {
  let fidx = 0;
  return {
    name: "naive",
    note: "scatter every roll, never combine, no maze",
    build(g, ctx) {
      if (ctx.funded) {
        // Funded: a scatter of chaff-tier guns with no structure and no climb.
        fidx = fundedFill(g, scatter(ctx, 200), ctx.wave * 4, fidx, 1, (i) => COMPONENT_ORDER[i % 5]!);
        return;
      }
      let guard = 0;
      while (g.canStamp() && guard++ < 12) {
        const col = 6 + Math.floor(ctx.rng.next() * 36);
        const row = 4 + Math.floor(ctx.rng.next() * 24);
        pullAndPlace(g, { col, row });
      }
      // never combine, never retarget — the naive default.
    },
  };
}

// no-combine — build the planned maze well, but NEVER combine, so the firing line is
// stuck on Scrap/Tuned. The geometry is right; the DPS is not → should LOSE late.
function noCombine(): Controller {
  let idx = 0;
  let fidx = 0;
  return {
    name: "no-combine",
    note: "maze well, but never climb the ladder",
    build(g, ctx) {
      if (ctx.funded) {
        // Funded: the whole maze, but pinned at T1 forever — pure ladder-denial.
        fidx = fundedFill(g, ctx.anchors, ctx.wave * 4, fidx, 1, (i) => COMPONENT_ORDER[i % 5]!);
        return;
      }
      idx = fillMaze(g, ctx.anchors, idx);
      // deliberately no combineUp().
    },
  };
}

// no-maze — combine up the ladder, but place every gun in a tight central CLUMP so the
// route never folds. High DPS in a small footprint the Load skirts in seconds → should
// LOSE / badly struggle (coverage-time, not raw DPS, wins a GemTD).
function noMaze(): Controller {
  let idx = 0;
  let fidx = 0;
  return {
    name: "no-maze",
    note: "climb the ladder, but clump the guns (route never folds)",
    build(g, ctx) {
      const clump = clumpFor(g.map.id);
      if (ctx.funded) {
        fidx = fundedFill(g, clump, ctx.wave * 4, fidx, tierForWave(ctx.wave), (i) => COMPONENT_ORDER[i % 5]!);
        return;
      }
      let guard = 0;
      while (g.canStamp() && guard++ < 12) {
        const target = clump[idx % clump.length]!;
        if (pullAndPlace(g, target)) idx++;
      }
      combineUp(g, { floor: 8 }); // it DOES climb hard — the only thing missing is the maze
      targeting(g);
    },
  };
}

// competent — build the planned maze, combine every match up the ladder, point the
// heavy rigs at the strongest unit, and recycle unclimbable chaff into extra rolls when
// short on Charge. The reference "good player" → should WIN on medium.
function competent(): Controller {
  let idx = 0;
  let fidx = 0;
  return {
    name: "competent",
    note: "planned maze + climb + targeting + recycle",
    build(g, ctx) {
      if (ctx.funded) {
        fidx = fundedFill(g, ctx.anchors, ctx.wave * 4, fidx, tierForWave(ctx.wave), (i) => COMPONENT_ORDER[i % 5]!);
        combineUp(g, { floor: mazeFloor(ctx.wave, ctx.anchors.length) });
        return;
      }
      let guard = 0;
      while (guard++ < 16) {
        if (!g.canStamp()) {
          // Out of Charge but stamps to spare (mid-game+): recycle a chaff wall.
          if (g.stampsLeft() > 0 && g.charge < STAMP_COST && ctx.wave >= 6) {
            const sp = spareT1(g);
            if (sp) {
              g.slag(sp.id);
              continue;
            }
          }
          break;
        }
        const target = ctx.anchors[idx % ctx.anchors.length]!;
        if (pullAndPlace(g, target)) idx++;
      }
      combineUp(g, { floor: mazeFloor(ctx.wave, ctx.anchors.length) });
      targeting(g);
    },
  };
}

// lean-<type> — plays the competent maze, but only ever climbs ONE type's ladder (the
// other rolls stay Scrap chaff walls). If a lean still wins as easily as the mixed
// competent, that type is carrying the game; it should generally UNDERPERFORM mixed.
function leanType(name: string, favored: ComponentType): Controller {
  let idx = 0;
  return {
    name,
    note: `maze, but climb only ${favored}`,
    build(g, ctx) {
      // (realistic only — a diagnostic on the random-roll economy)
      idx = fillMaze(g, ctx.anchors, idx);
      combineUp(g, { only: favored, floor: mazeFloor(ctx.wave, ctx.anchors.length) }); // climb ONLY the favored type
      targeting(g);
    },
  };
}

// A reproducible central scatter of anchors for the funded naive board.
function scatter(ctx: BuildCtx, n: number): Anchor[] {
  const out: Anchor[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ col: 6 + Math.floor(ctx.rng.next() * 36), row: 4 + Math.floor(ctx.rng.next() * 24) });
  }
  return out;
}
