import { describe, expect, it } from "vitest";
import { HOIST_START, LATTICE_PITCH } from "./constants";
import { readiness, SIM_SITES, type Member, type Vec3 } from "./sim";
import { latticeNodes, yardPosture } from "./render-posture";
import {
  addMoveStep,
  beginRun,
  openSite,
  setAxis,
  titleState,
  type GantryState,
} from "./state";

const member = (
  id: number,
  a: Vec3,
  b: Vec3,
  material: Member["material"],
): Member => ({ id, a, b, material });

/**
 * A small ready crane on site 1: four legs from the anchors up to the ring's
 * bottom flange, the ring on top of them, and two rails running out from the
 * top flange as the trolley's track.
 */
const MEMBERS: Member[] = [
  member(0, [0, 0, 0], [0, 2, 0], "strut"),
  member(1, [2, 0, 0], [2, 2, 0], "strut"),
  member(2, [0, 0, 2], [0, 2, 2], "strut"),
  member(3, [2, 0, 2], [2, 2, 2], "strut"),
  member(4, [0, 4, 0], [2, 4, 0], "rail"),
  member(5, [2, 4, 0], [4, 4, 0], "rail"),
];

function craneState(): GantryState {
  const base = openSite(titleState(), 0);
  const sites = base.sites.map((entry, i) =>
    i === 0
      ? {
          ...entry,
          structure: {
            members: MEMBERS.map((m) => ({ ...m })),
            nextMemberId: MEMBERS.length,
            ring: { corner: [0, 2, 0] as Vec3 },
            counterweights: [[4, 4, 0] as Vec3],
          },
        }
      : entry,
  );
  return { ...base, screen: "build", sites };
}

describe("latticeNodes", () => {
  it("names every node of the envelope, on the lattice pitch", () => {
    const nodes = latticeNodes({ min: [0, 0, 0], max: [4, 2, 4] });
    expect(nodes).toHaveLength(3 * 2 * 3);
    for (const node of nodes) {
      for (const axis of node) expect(axis % LATTICE_PITCH).toBe(0);
    }
    expect(nodes).toContainEqual([0, 0, 0]);
    expect(nodes).toContainEqual([4, 2, 4]);
  });

  it("leaves out a node the envelope does not reach", () => {
    const nodes = latticeNodes({ min: [1, 0, 1], max: [3, 0, 3] });
    expect(nodes).toEqual([[2, 0, 2]]);
  });

  it("names every node of site 1's own envelope", () => {
    const nodes = latticeNodes(SIM_SITES[0].envelope);
    expect(nodes.length).toBe(11 * 9 * 11);
  });
});

describe("the fixture crane", () => {
  it("is ready, so a run may start on it", () => {
    const state = craneState();
    expect(readiness(state.sites[0].structure, SIM_SITES[0].anchors)).toEqual(
      [],
    );
  });
});

describe("yardPosture outside a run", () => {
  it("stands the crane at the run-start posture", () => {
    const posture = yardPosture(craneState());
    expect(posture.live).toBe(false);
    expect(posture.slew).toBe(0);
    // The trolley sits at the track origin, the end nearer the slew axis.
    expect(posture.trolley?.centre).toEqual([0, 4, 0]);
    expect(posture.trolley?.yaw).toBeCloseTo(0, 9);
    // The bare hook hangs `HOIST_START` below it, on the cable.
    expect(posture.hook?.centre).toEqual([0, 4 - HOIST_START, 0]);
    expect(posture.cable).toEqual({
      from: [0, 4, 0],
      to: [0, 4 - HOIST_START, 0],
    });
  });

  it("leaves the members at their lattice positions and uncoloured", () => {
    const posture = yardPosture(craneState());
    expect(posture.members).toHaveLength(MEMBERS.length);
    expect(posture.members[0].a).toEqual([0, 0, 0]);
    expect(posture.members[0].b).toEqual([0, 2, 0]);
    for (const drawn of posture.members) {
      expect(drawn.utilization).toBeNull();
      expect(drawn.broken).toBe(false);
    }
  });

  it("centres the ring on the slew axis, on its bottom flange", () => {
    const posture = yardPosture(craneState());
    expect(posture.ring?.centre[0]).toBe(1);
    expect(posture.ring?.centre[2]).toBe(1);
    expect(posture.ring?.baseY).toBe(2);
    expect(posture.ring?.yaw).toBe(0);
  });

  it("carries the site's own fixtures, loads at their starts and pads at their targets", () => {
    const posture = yardPosture(craneState());
    const site = SIM_SITES[0];
    expect(posture.anchors).toEqual(site.anchors);
    expect(posture.envelope).toEqual(site.envelope);
    expect(posture.loads).toHaveLength(site.loads.length);
    expect(posture.loads[0].pos).toEqual(site.loads[0].from.pos);
    expect(posture.loads[0].phase).toBe("waiting");
    expect(posture.pads[0].pos).toEqual(site.loads[0].to.pos);
    expect(posture.pads[0].yaw).toBe(site.loads[0].to.yaw);
    expect(posture.pads[0].placed).toBe(false);
  });

  it("draws no rigging on a crane with no track", () => {
    const state = craneState();
    const bare = {
      ...state,
      sites: state.sites.map((entry, i) =>
        i === 0
          ? {
              ...entry,
              structure: {
                ...entry.structure,
                members: entry.structure.members.filter(
                  (m) => m.material !== "rail",
                ),
              },
            }
          : entry,
      ),
    };
    const posture = yardPosture(bare);
    expect(posture.trolley).toBeNull();
    expect(posture.hook).toBeNull();
    expect(posture.cable).toBeNull();
  });

  it("colours the members by the check result the build screen is showing", () => {
    const state = craneState();
    const shown: GantryState = {
      ...state,
      checkResult: {
        issues: [],
        cost: 0,
        budget: 3000,
        stable: true,
        members: [{ id: 0, force: 1200, utilization: 0.5 }],
      },
    };
    const posture = yardPosture(shown);
    expect(posture.members[0].utilization).toBe(0.5);
    expect(posture.members[1].utilization).toBeNull();
  });
});

describe("yardPosture during a run", () => {
  const running = (): GantryState => {
    const state = addMoveStep(craneState(), "slew", 90, 30);
    const started = beginRun(state);
    expect(started).not.toBeNull();
    return started as GantryState;
  };

  it("poses the yard from the run rather than the build posture", () => {
    const posture = yardPosture(running());
    expect(posture.live).toBe(true);
    expect(posture.cable?.from).toEqual([0, 4, 0]);
    expect(posture.hook?.centre).toEqual([0, 4 - HOIST_START, 0]);
  });

  it("turns the arm's nodes with the slew angle and leaves the tower still", () => {
    const posture = yardPosture(setAxis(running(), "slew", 90));
    // The slew axis runs through (1, ·, 1), so the far rail node (4, 4, 0)
    // stands at (2, 4, 4) after a quarter turn.
    const far = posture.members[5];
    expect(far.b[0]).toBeCloseTo(2, 9);
    expect(far.b[1]).toBeCloseTo(4, 9);
    expect(far.b[2]).toBeCloseTo(4, 9);
    // A leg from an anchor is in the tower and has not moved.
    expect(posture.members[0].a).toEqual([0, 0, 0]);
    expect(posture.slew).toBe(90);
  });

  it("carries the counterweight round with the arm node it hangs on", () => {
    const posture = yardPosture(setAxis(running(), "slew", 90));
    expect(posture.counterweights).toHaveLength(1);
    expect(posture.counterweights[0][0]).toBeCloseTo(2, 9);
    expect(posture.counterweights[0][2]).toBeCloseTo(4, 9);
  });

  it("marks a member the run has broken", () => {
    const state = running();
    const broken: GantryState = {
      ...state,
      run: {
        ...state.run,
        intact: state.run.intact.filter((m) => m.id !== 2),
        broken: [2],
        forces: [{ id: 0, force: -100, utilization: 0.9 }],
      },
    };
    const posture = yardPosture(broken);
    expect(posture.members[2].broken).toBe(true);
    expect(posture.members[0].broken).toBe(false);
    expect(posture.members[0].utilization).toBe(0.9);
  });

  it("turns the hook to the grip and hangs the load from it", () => {
    const state = running();
    const holding: GantryState = {
      ...state,
      run: {
        ...state.run,
        axes: {
          ...state.run.axes,
          grip: { value: 45, rate: 0, command: null },
        },
        attached: 0,
        loads: state.run.loads.map((load) => ({
          ...load,
          phase: "attached" as const,
          pos: [3, 5, 0] as Vec3,
          yaw: 45,
        })),
      },
    };
    const posture = yardPosture(holding);
    expect(posture.hook?.yaw).toBe(45);
    expect(posture.loads[0].pos).toEqual([3, 5, 0]);
    expect(posture.loads[0].yaw).toBe(45);
    expect(posture.loads[0].phase).toBe("attached");
  });

  it("draws no load that has been lost", () => {
    const state = running();
    const lost: GantryState = {
      ...state,
      run: {
        ...state.run,
        loads: state.run.loads.map((load) => ({ ...load, phase: "lost" })),
      },
    };
    expect(yardPosture(lost).loads).toHaveLength(0);
  });

  it("marks a pad whose load has been set down", () => {
    const state = running();
    const done: GantryState = {
      ...state,
      run: {
        ...state.run,
        loads: state.run.loads.map((load) => ({ ...load, phase: "placed" })),
      },
    };
    expect(yardPosture(done).pads[0].placed).toBe(true);
  });
});
