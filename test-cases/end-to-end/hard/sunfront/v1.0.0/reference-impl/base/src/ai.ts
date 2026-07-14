/**
 * Sunfront — the enemy AI opponent (specs/flow.md "The AI opponent", specs/economy.md).
 *
 * The AI runs the **same economy with no cheating**: it starts with the same `200` sol,
 * earns the same `10` sol/s (plus its own Solar Extractors), and spends only sol it has,
 * placing spawners and Extractors on its own `8×3` hidden grid through the very same
 * {@link World} economy API the player uses (`place`/`upgrade`) — every purchase is
 * affordability-guarded there, so the AI can never overspend.
 *
 * It is a **real reactive policy, not a fixed script**: each decision tick it observes
 * only what its OWN vision sees of the player's army crossing the sand (`../vision`),
 * keeps a decaying memory of that composition, and shifts a weighted target composition
 * toward the counters — flak for air, piercing for heavy, splash for a swarm — then buys
 * the single most-needed structure it can afford. It grows a modest economy and upgrades
 * when flush, but is deliberately capped (army size, Extractor count) so a player who
 * reads the counter triangle and out-economies it can clearly win.
 */

import type { Team, UnitType } from "./types";
import type { World, BuildStructure } from "./sim/world";
import { buildCost, upgradeCost } from "./sim/world";
import {
  UNIT_STATS,
  BUILD_PALETTE_ORDER,
  BUILD_GRID_COLS,
  BUILD_GRID_ROWS,
  SOLAR_EXTRACTOR_COST,
  MAX_STRUCTURE_LEVEL,
} from "./constants";
import { collectVision, pointVisible } from "./vision";

/** How often the AI makes at most one purchase decision (seconds, real-time). */
const DECISION_INTERVAL_S = 0.7;
/** How quickly the observed-composition memory tracks what is currently visible (per s). */
const OBSERVE_RATE = 0.8;
/** Hard-counter triggers: react once a category is seen this strongly. */
const AIR_TRIGGER = 0.25;
const HEAVY_TRIGGER = 0.5;
/** Keep the AI beatable: hard caps on how much it invests. */
const MAX_SPAWNERS = 12;
const MAX_EXTRACTORS = 3;
/** Sol above which the AI upgrades rather than hoarding. */
const UPGRADE_FLUSH_SOL = 350;

/** The four ways the AI reads an observed player unit (drives its counter choice). */
type Category = "air" | "heavy" | "swarm" | "support";

/** Categorize a unit type by the counter it demands (specs/units.md). */
function categoryOf(type: UnitType): Category {
  const s = UNIT_STATS[type];
  if (s.armor === "Air") return "air";
  if (s.armor === "Heavy") return "heavy";
  if (s.attack === "Support") return "support";
  return "swarm"; // Light, non-support: the mass of the army
}

/**
 * The AI's baseline desired composition (relative weights). A cost-efficient ranged
 * backbone (Sentinel), a melee screen (Scarab), a Heavy front (Bulwark), and a little
 * of everything; adaptation adds to the counters on top of this (see {@link EnemyAI}).
 */
const BASE_WEIGHTS: Record<UnitType, number> = {
  scarab: 1.5,
  trooper: 1.0,
  sentinel: 2.5,
  bulwark: 1.2,
  lancer: 1.0,
  bombard: 0.5,
  flakhound: 0.4,
  sunhawk: 0.5,
  lumen: 0.7,
  monolith: 0.2,
};

export class EnemyAI {
  private decisionTimer = DECISION_INTERVAL_S;
  /** Decaying memory of the enemy's seen composition, per category. */
  private readonly ema: Record<Category, number> = { air: 0, heavy: 0, swarm: 0, support: 0 };

  constructor(
    private readonly world: World,
    private readonly team: Team = "enemy",
  ) {}

  /** Advance the AI: observe every step, decide on the decision cadence. */
  step(dt: number): void {
    if (this.world.result) return;
    this.observe(dt);
    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer += DECISION_INTERVAL_S;
      this.decide();
    }
  }

  /** The AI's decaying memory of what it has seen (exposed for diagnostics/tests). */
  observed(): Readonly<Record<Category, number>> {
    return this.ema;
  }

  // --- Observation: only what our OWN vision sees of the enemy (no cheating) ---

  private observe(dt: number): void {
    const vision = collectVision(this.world, this.team);
    const counts: Record<Category, number> = { air: 0, heavy: 0, swarm: 0, support: 0 };
    for (const u of this.world.units) {
      if (u.team === this.team || u.dead) continue;
      if (!pointVisible(vision, u.x, u.z)) continue;
      counts[categoryOf(u.type)] += 1;
    }
    const k = Math.min(1, OBSERVE_RATE * dt);
    for (const c of ["air", "heavy", "swarm", "support"] as const) {
      this.ema[c] += (counts[c] - this.ema[c]) * k;
    }
  }

  // --- Decision: buy the single most-needed thing we can afford -----------------

  private decide(): void {
    const sol = this.world.sol[this.team];
    const owned = this.ownedByType();
    const extractors = this.countKind("solar-extractor");
    const spawners = this.spawnerCount();
    const cell = this.firstFreeCell();
    const afford = (c: number): boolean => sol >= c;

    // 1. Hard air counter: air in sight and no Flak yet — answer it immediately.
    if (
      this.ema.air > AIR_TRIGGER && (owned.get("flakhound") ?? 0) === 0 &&
      cell && spawners < MAX_SPAWNERS && afford(buildCost("flakhound"))
    ) {
      this.world.place(this.team, "flakhound", cell.col, cell.row);
      return;
    }

    // 2. Hard heavy counter: heavies in sight and no Piercing yet — answer with a Lancer.
    if (
      this.ema.heavy > HEAVY_TRIGGER && (owned.get("lancer") ?? 0) === 0 &&
      cell && spawners < MAX_SPAWNERS && afford(buildCost("lancer"))
    ) {
      this.world.place(this.team, "lancer", cell.col, cell.row);
      return;
    }

    // 3. Get a starter army going before anything else.
    if (spawners === 0 && cell) {
      if (afford(buildCost("sentinel"))) {
        this.world.place(this.team, "sentinel", cell.col, cell.row);
        return;
      }
      if (afford(buildCost("scarab"))) {
        this.world.place(this.team, "scarab", cell.col, cell.row);
        return;
      }
      return; // save toward the first spawner
    }

    // 4. Grow a modest economy (capped, so the player can out-economise it).
    const desiredExtractors = Math.min(MAX_EXTRACTORS, Math.max(1, Math.floor(spawners / 3)));
    if (extractors < desiredExtractors && cell && afford(SOLAR_EXTRACTOR_COST)) {
      this.world.place(this.team, "solar-extractor", cell.col, cell.row);
      return;
    }

    // 5. Fill the largest composition deficit we can afford this tick.
    const best = this.pickComposition(owned, cell !== null, afford);
    if (best && cell && spawners < MAX_SPAWNERS) {
      this.world.place(this.team, best, cell.col, cell.row);
      return;
    }

    // 6. Nothing worth building (unaffordable, or grid full): upgrade when flush.
    if (sol > UPGRADE_FLUSH_SOL) {
      const up = this.pickUpgrade();
      if (up && afford(upgradeCost(up.kind))) this.world.upgrade(up);
    }
  }

  /** The unit type with the largest positive, affordable shortfall vs the target mix. */
  private pickComposition(
    owned: Map<UnitType, number>,
    hasCell: boolean,
    afford: (c: number) => boolean,
  ): UnitType | null {
    if (!hasCell) return null;
    const weights = this.desiredWeights();
    let total = 0;
    for (const t of BUILD_PALETTE_ORDER) total += weights[t];
    const targetArmy = Math.min(MAX_SPAWNERS, 3 + Math.floor(this.world.elapsedS / 22));

    let bestType: UnitType | null = null;
    let bestDeficit = 0;
    for (const t of BUILD_PALETTE_ORDER) {
      if (!afford(buildCost(t))) continue;
      const desired = (weights[t] / total) * targetArmy;
      const deficit = desired - (owned.get(t) ?? 0);
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestType = t;
      }
    }
    return bestType;
  }

  /** Baseline weights shifted toward the counters the AI has seen it needs. */
  private desiredWeights(): Record<UnitType, number> {
    const w: Record<UnitType, number> = { ...BASE_WEIGHTS };
    w.flakhound += this.ema.air * 2.0; // air demands flak, hard
    w.lancer += this.ema.heavy * 1.2; // heavies demand piercing
    w.bombard += this.ema.swarm * 0.5; // a swarm demands splash
    w.monolith += this.ema.swarm * 0.12;
    return w;
  }

  /** The lowest-hanging upgrade: a sub-max spawner first, else a sub-max Extractor. */
  private pickUpgrade(): BuildStructure | null {
    let spawner: BuildStructure | null = null;
    let extractor: BuildStructure | null = null;
    for (const s of this.world.structures) {
      if (s.team !== this.team || s.level >= MAX_STRUCTURE_LEVEL) continue;
      if (s.kind === "solar-extractor") {
        if (!extractor) extractor = s;
      } else if (!spawner) {
        spawner = s;
      }
    }
    return spawner ?? extractor;
  }

  // --- Small queries over our own structures -----------------------------------

  private ownedByType(): Map<UnitType, number> {
    const counts = new Map<UnitType, number>();
    for (const s of this.world.structures) {
      if (s.team !== this.team || s.kind === "solar-extractor") continue;
      counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
    }
    return counts;
  }

  private spawnerCount(): number {
    let n = 0;
    for (const s of this.world.structures) {
      if (s.team === this.team && s.kind !== "solar-extractor") n += 1;
    }
    return n;
  }

  private countKind(kind: "solar-extractor"): number {
    let n = 0;
    for (const s of this.world.structures) {
      if (s.team === this.team && s.kind === kind) n += 1;
    }
    return n;
  }

  /** The first empty cell of the AI's own build grid, or null if the grid is full. */
  private firstFreeCell(): { col: number; row: number } | null {
    for (let row = 0; row < BUILD_GRID_ROWS; row++) {
      for (let col = 0; col < BUILD_GRID_COLS; col++) {
        if (this.world.cellFree(this.team, col, row)) return { col, row };
      }
    }
    return null;
  }
}
