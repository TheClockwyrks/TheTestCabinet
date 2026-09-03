// The one translation between the state's records and `src/sim`'s, and the deep
// copies every transition rests on.

import { describe, expect, it } from "vitest";
import { SITES, SITE_NAMES } from "./constants";
import {
  authoredSiteState,
  copyStructure,
  emptyStructure,
  fromSimRun,
  fromSimVec,
  idleRun,
  point,
  samePoint,
  thaw,
  toSimBox,
  toSimRun,
  toSimSite,
  toSimStructure,
  toSimTape,
  toSimVec,
} from "./convert";
import type { Step } from "./game";
import {
  idleRun as simIdleRun,
  startRun as simStartRun,
  type Member as SimMember,
} from "./sim";
import { openSite, titleState } from "./state";

describe("positions", () => {
  it("round-trip through the simulation's triple", () => {
    const p = point(1, -2, 3.5);
    expect(fromSimVec(toSimVec(p))).toEqual(p);
    expect(toSimVec(p)).toEqual([1, -2, 3.5]);
  });

  it("compare by value", () => {
    expect(samePoint(point(1, 2, 3), point(1, 2, 3))).toBe(true);
    expect(samePoint(point(1, 2, 3), point(1, 2, 4))).toBe(false);
  });
});

describe("the structure", () => {
  it("copies deeply enough that neither holder writes the other", () => {
    const structure = emptyStructure();
    structure.members.push({
      id: 0,
      a: point(0, 0, 0),
      b: point(0, 2, 0),
      material: "strut",
    });
    structure.ring = { corner: point(0, 2, 0) };
    structure.counterweights.push(point(0, 2, 0));

    const copy = copyStructure(structure);
    copy.members[0].a.x = 99;
    copy.ring!.corner.y = 99;
    copy.counterweights[0].z = 99;
    expect(structure.members[0].a.x).toBe(0);
    expect(structure.ring.corner.y).toBe(2);
    expect(structure.counterweights[0].z).toBe(0);
  });

  it("reaches the simulation as triples, without the editor's id counter", () => {
    const structure = emptyStructure();
    structure.nextMemberId = 7;
    structure.members.push({
      id: 3,
      a: point(0, 0, 0),
      b: point(2, 0, 0),
      material: "rail",
    });
    const sim = toSimStructure(structure);
    expect(sim.members[0]).toEqual({
      id: 3,
      a: [0, 0, 0],
      b: [2, 0, 0],
      material: "rail",
    });
    expect("nextMemberId" in sim).toBe(false);
  });
});

describe("the site", () => {
  it("is copied out of the table, not pointed into it", () => {
    const site = authoredSiteState(3);
    expect(site.loads).toEqual(SITES[3].loads);
    expect(site.loads[0]).not.toBe(SITES[3].loads[0]);
    expect(site.obstacles).not.toBe(SITES[3].obstacles);
  });

  it("carries the table's fixed figures and the yard as it stands", () => {
    const site = toSimSite(4, authoredSiteState(4));
    expect(site.name).toBe(SITE_NAMES[4]);
    expect(site.budget).toBe(SITES[4].budget);
    expect(site.loads[0].cls).toBe("container");
    expect(site.obstacles[0]).toEqual({
      min: [-9, 0, -2],
      max: [-5, 6, 2],
    });
  });

  it("turns an obstacle's minimum corner and size into its two corners", () => {
    expect(toSimBox({ min: point(1, 2, 3), size: point(4, 5, 6) })).toEqual({
      min: [1, 2, 3],
      max: [5, 7, 9],
    });
  });
});

describe("the tape", () => {
  it("reaches the simulation as the steps it was written as", () => {
    const program: Step[] = [
      { kind: "move", commands: [{ axis: "slew", target: 90, rate: 10 }] },
      { kind: "action", action: "attach" },
    ];
    expect(toSimTape(program)).toEqual(program);
    expect(toSimTape(program)[0]).not.toBe(program[0]);
  });
});

describe("the run", () => {
  it("round-trips through the simulation's own shape", () => {
    const start = simStartRun({
      site: toSimSite(0, authoredSiteState(0)),
      structure: toSimStructure(emptyStructure()),
      tape: [],
    });
    // An empty crane is refused, so the round trip is checked on the idle one.
    expect(start).toBeNull();

    const run = idleRun();
    run.phase = "running";
    run.tick = 12;
    run.broken = [1];
    run.bob = { pos: point(1, 2, 3), vel: point(0, -1, 0) };
    run.internals.previousPivot = point(4, 5, 6);
    run.internals.lastCreakTick = 7;
    run.internals.accumulator = 0.004;

    const members: SimMember[] = [
      { id: 0, a: [0, 0, 0], b: [0, 2, 0], material: "strut" },
      { id: 1, a: [2, 0, 0], b: [2, 2, 0], material: "strut" },
    ];
    const sim = toSimRun(run, members);
    expect(sim.tick).toBe(12);
    expect(sim.bob.pos).toEqual([1, 2, 3]);
    expect(sim.previousPivot).toEqual([4, 5, 6]);
    // The members a run solves over are the structure's, less the broken ones.
    expect(sim.intact.map((m) => m.id)).toEqual([0]);

    const back = fromSimRun(sim, run.speedIndex, 0.004, 7);
    expect(back).toEqual(run);
  });

  it("gives the idle placeholder the simulation's own resting values", () => {
    const idle = idleRun();
    const sim = simIdleRun();
    expect(idle.phase).toBe(sim.phase);
    expect(idle.axes.hoist.value).toBe(sim.axes.hoist.value);
    expect(idle.pivot).toEqual(fromSimVec(sim.pivot));
    expect(idle.internals.accumulator).toBe(0);
    expect(idle.internals.lastCreakTick).toBeNull();
  });
});

describe("thaw", () => {
  it("hands back a wholly owned copy", () => {
    const before = openSite(titleState(), 1);
    const copy = thaw(before);
    expect(copy).toEqual(before);
    copy.cleared[0] = true;
    copy.sites[1].program.push({ kind: "action", action: "attach" });
    copy.site.loads.length = 0;
    copy.run.axes.slew.value = 33;
    copy.camera.yaw = 1;
    copy.pointer.x = 5;
    expect(before.cleared[0]).toBe(false);
    expect(before.sites[1].program).toEqual([]);
    expect(before.site.loads.length).toBeGreaterThan(0);
    expect(before.run.axes.slew.value).toBe(0);
    expect(before.camera.yaw).not.toBe(1);
    expect(before.pointer.x).toBe(0);
  });
});
