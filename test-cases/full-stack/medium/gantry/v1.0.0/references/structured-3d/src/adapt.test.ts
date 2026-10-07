import { describe, expect, it } from "vitest";
import { SITES } from "./constants";
import {
  copyLoad,
  copyObstacle,
  point,
  simLoad,
  simObstacle,
  simRun,
  simSite,
  simStructure,
  stateMember,
  triple,
  writeRun,
} from "./adapt";
import { GantryState } from "./game";
import { idleRun } from "./state";

describe("positions", () => {
  it("round-trips between the state's record and the simulation's triple", () => {
    expect(point([1, 2, 3])).toEqual({ x: 1, y: 2, z: 3 });
    expect(triple({ x: 1, y: 2, z: 3 })).toEqual([1, 2, 3]);
  });
});

describe("the site", () => {
  it("copies a load all the way down", () => {
    const load = SITES[0].loads[0];
    const copy = copyLoad(load);
    expect(copy).toEqual(load);
    expect(copy.from).not.toBe(load.from);
  });

  it("copies an obstacle all the way down", () => {
    const box = { min: { x: 1, y: 2, z: 3 }, size: { x: 4, y: 5, z: 6 } };
    const copy = copyObstacle(box);
    expect(copy).toEqual(box);
    expect(copy.min).not.toBe(box.min);
  });

  it("reads a load into the shape the simulation works in", () => {
    const load = SITES[0].loads[0];
    expect(simLoad(load)).toEqual({
      cls: load.class,
      mass: load.mass,
      from: {
        pos: [load.from.x, load.from.y, load.from.z],
        yaw: load.from.yaw,
      },
      to: { pos: [load.to.x, load.to.y, load.to.z], yaw: load.to.yaw },
    });
  });

  it("turns an obstacle's corner and size into its two corners", () => {
    expect(
      simObstacle({ min: { x: 1, y: 2, z: 3 }, size: { x: 4, y: 5, z: 6 } }),
    ).toEqual({ min: [1, 2, 3], max: [5, 7, 9] });
  });

  it("carries the state's loads and obstacles onto the site's own figures", () => {
    const state = new GantryState();
    const site = simSite(2, state.site);
    expect(site.name).toBe("Over the Wall");
    expect(site.budget).toBe(SITES[2].budget);
    // The loads are the ones the state is holding, which are site 0's here.
    expect(site.loads).toHaveLength(SITES[0].loads.length);
  });
});

describe("the structure", () => {
  it("reads a crane into the shape the rules work in", () => {
    const sim = simStructure({
      members: [
        {
          id: 0,
          a: { x: 0, y: 0, z: 0 },
          b: { x: 0, y: 2, z: 0 },
          material: "strut",
        },
      ],
      nextMemberId: 1,
      ring: { corner: { x: 0, y: 2, z: 0 } },
      counterweights: [{ x: 0, y: 2, z: 0 }],
    });
    expect(sim.members[0]).toEqual({
      id: 0,
      a: [0, 0, 0],
      b: [0, 2, 0],
      material: "strut",
    });
    expect(sim.ring).toEqual({ corner: [0, 2, 0] });
    expect(sim.counterweights).toEqual([[0, 2, 0]]);
    expect(stateMember(sim.members[0]).a).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("the run", () => {
  it("round-trips the idle placeholder through the simulation's shape", () => {
    const run = idleRun();
    const sim = simRun(run);
    expect(sim.phase).toBe("idle");
    expect(sim.pivot).toEqual([0, 0, 0]);
    const back = idleRun();
    writeRun(back, sim);
    expect(back).toEqual(run);
  });

  it("leaves the frame loop's own bookkeeping alone on a write-back", () => {
    const run = idleRun();
    run.speedIndex = 2;
    run.accumulator = 0.004;
    run.lastCreakTick = 12;
    writeRun(run, simRun(run));
    expect(run.speedIndex).toBe(2);
    expect(run.accumulator).toBeCloseTo(0.004, 12);
    expect(run.lastCreakTick).toBe(12);
  });
});
