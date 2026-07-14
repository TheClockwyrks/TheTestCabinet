// Hollowdeep — the power network: generators, wires, machines, brownout (specs/power.md).
//
// Power is a per-tile network laid along WIRES. A maximal set of edge-connected wire tiles,
// with the generators and machines attached adjacent-to-or-on it, is one network; the world
// may hold several. Each network balances SUPPLY (running, fueled generators) against
// DEMAND (diffusers + pumps). If demand exceeds supply the network BROWNS OUT and every
// machine on it stops — a browned-out diffuser stops making air, felt immediately in the
// gas economy (specs/gas.md). rebuildNetworks() recomputes the topology and each machine's
// powered/running flags each tick; stepPower() then runs the machines that are up. The
// refinery is operated, not powered (a delver job, src/economy.ts + src/sim.ts).

import {
  DIFFUSER_DEMAND,
  DIFFUSER_O2_OUT,
  GEN_FUEL_BURN_TIME,
  GEN_SUPPLY,
  PUMP_DEMAND,
  PUMP_RATE,
} from "./constants";
import type { World } from "./types";
import { emitOxygen, pumpGas } from "./gas";
import { idx } from "./world";

// Per-network readout for the HUD's power strip (specs/flow.md).
export interface NetworkStat {
  id: number;
  supply: number;
  demand: number;
  brownout: boolean;
}

// Flood-fill the wire tiles into maximal edge-connected networks, attach every
// generator/machine on or adjacent to a wire, sum supply vs demand, and set each machine's
// powered/running flags (with brownout stopping everything on an over-drawn network).
export function rebuildNetworks(world: World): NetworkStat[] {
  const { w, h, tiles } = world;
  const net = new Int32Array(w * h).fill(-1);
  let count = 0;

  // Flood-fill wire components.
  const queue: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i]!.kind !== "wire" || net[i] !== -1) continue;
    const id = count++;
    net[i] = id;
    queue.length = 0;
    queue.push(i);
    while (queue.length > 0) {
      const cur = queue.pop()!;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const around = [
        [cx - 1, cy],
        [cx + 1, cy],
        [cx, cy - 1],
        [cx, cy + 1],
      ];
      for (const [nx, ny] of around) {
        if (nx! < 0 || ny! < 0 || nx! >= w || ny! >= h) continue;
        const ni = idx(w, nx!, ny!);
        if (tiles[ni]!.kind === "wire" && net[ni] === -1) {
          net[ni] = id;
          queue.push(ni);
        }
      }
    }
  }

  // The network a machine attaches to: its own tile if it is a wire, else the first
  // adjacent wire tile's network (-1 = unattached).
  const attach = (tx: number, ty: number): number => {
    const self = idx(w, tx, ty);
    if (tiles[self]!.kind === "wire") return net[self]!;
    const around = [
      [tx - 1, ty],
      [tx + 1, ty],
      [tx, ty - 1],
      [tx, ty + 1],
    ];
    for (const [nx, ny] of around) {
      if (nx! < 0 || ny! < 0 || nx! >= w || ny! >= h) continue;
      const ni = idx(w, nx!, ny!);
      if (tiles[ni]!.kind === "wire") return net[ni]!;
    }
    return -1;
  };

  const supply = new Float64Array(count);
  const demand = new Float64Array(count);

  for (const m of world.machines) {
    m.network = attach(m.tx, m.ty);
    if (m.network < 0) continue;
    if (m.kind === "generator") {
      if (m.fuel > 0) supply[m.network] += GEN_SUPPLY;
    } else if (m.kind === "diffuser") {
      demand[m.network] += DIFFUSER_DEMAND;
    } else if (m.kind === "pump") {
      demand[m.network] += PUMP_DEMAND;
    }
  }

  const brownout: boolean[] = [];
  for (let n = 0; n < count; n++) brownout[n] = demand[n]! > supply[n]!;

  // Set each machine's flags. A generator "runs" (supplies + burns fuel) when attached and
  // fueled. A demanding machine runs only when attached to a network that met its demand.
  for (const m of world.machines) {
    if (m.kind === "generator") {
      m.powered = m.network >= 0;
      m.running = m.powered && m.fuel > 0;
    } else {
      const up = m.network >= 0 && !brownout[m.network] && supply[m.network]! > 0;
      m.powered = up;
      m.running = up;
    }
  }

  const stats: NetworkStat[] = [];
  for (let n = 0; n < count; n++) {
    stats.push({ id: n, supply: supply[n]!, demand: demand[n]!, brownout: brownout[n]! });
  }
  return stats;
}

// Run the machines that are up: generators burn their buffered ore fuel, running diffusers
// add oxygen, running pumps move CO2. `ventPhase` advances for the running steam/exhaust
// effect (specs/assets.md). Call rebuildNetworks() first so `running` is current.
export function stepPower(world: World, dt: number): void {
  for (const m of world.machines) {
    if (!m.running) continue;
    m.ventPhase += dt;
    if (m.kind === "generator") {
      m.fuel = Math.max(0, m.fuel - dt / GEN_FUEL_BURN_TIME);
    } else if (m.kind === "diffuser") {
      emitOxygen(world, m.tx, m.ty, DIFFUSER_O2_OUT * dt);
    } else if (m.kind === "pump") {
      pumpGas(world, m.tx, m.ty, PUMP_RATE * dt);
    }
  }
}
