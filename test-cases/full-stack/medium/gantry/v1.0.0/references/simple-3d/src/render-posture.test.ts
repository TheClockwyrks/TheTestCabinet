// Where the yard stands this frame: the reading the scene is drawn from.

import { describe, expect, it } from "vitest";
import { HOIST_START, LATTICE_PITCH, SITES } from "./constants";
import { point } from "./convert";
import * as edits from "./edits";
import type { GantryState } from "./game";
import { latticeNodes, yardPosture } from "./render-posture";
import { SIM_SITES } from "./sim";
import {
  addMoveStep,
  beginRun,
  openSite,
  setScreen,
  titleState,
} from "./state";

const yard = (): GantryState => setScreen(openSite(titleState(), 0), "build");

/** A ring and one arm rail: the least a run will start on. */
function crane(): GantryState {
  let s = edits.setRing(yard(), point(0, 2, 0)).state;
  s = edits.addMember(s, point(2, 4, 0), point(4, 4, 0), "rail").state;
  return s;
}

describe("the lattice", () => {
  it("is every node of the envelope on the pitch", () => {
    const nodes = latticeNodes(SIM_SITES[0].envelope);
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      for (const axis of node) expect(Math.abs(axis % LATTICE_PITCH)).toBe(0);
    }
    const { envelope } = SIM_SITES[0];
    for (const node of nodes) {
      for (let i = 0; i < 3; i++) {
        expect(node[i]).toBeGreaterThanOrEqual(envelope.min[i]);
        expect(node[i]).toBeLessThanOrEqual(envelope.max[i]);
      }
    }
  });
});

describe("an empty site", () => {
  const posture = () => yardPosture(yard());

  it("stands the site's own fixtures whatever is built", () => {
    const p = posture();
    expect(p.anchors).toEqual(SIM_SITES[0].anchors);
    expect(p.obstacles).toEqual(SIM_SITES[0].obstacles);
    expect(p.envelope).toEqual(SIM_SITES[0].envelope);
    expect(p.pads).toHaveLength(SITES[0].loads.length);
    expect(p.pads[0].placed).toBe(false);
  });

  it("shows every load waiting at its authored pose", () => {
    const p = posture();
    expect(p.loads).toHaveLength(SITES[0].loads.length);
    expect(p.loads[0].phase).toBe("waiting");
    expect(p.loads[0].pos).toEqual([
      SITES[0].loads[0].from.x,
      SITES[0].loads[0].from.y,
      SITES[0].loads[0].from.z,
    ]);
  });

  it("has no crane at all: no members, no ring, no rigging", () => {
    const p = posture();
    expect(p.members).toHaveLength(0);
    expect(p.ring).toBeNull();
    expect(p.trolley).toBeNull();
    expect(p.hook).toBeNull();
    expect(p.cable).toBeNull();
    expect(p.live).toBe(false);
    expect(p.slew).toBe(0);
  });
});

describe("a crane outside a run", () => {
  it("stands at the run-start posture the check solves at", () => {
    const p = yardPosture(crane());
    expect(p.ring).not.toBeNull();
    expect(p.ring?.baseY).toBe(2);
    expect(p.ring?.centre).toEqual([1, 2 + LATTICE_PITCH / 2, 1]);
    // The trolley sits at the track's origin, the hook `HOIST_START` under it.
    expect(p.trolley?.centre).toEqual([2, 4, 0]);
    expect(p.hook?.centre).toEqual([2, 4 - HOIST_START, 0]);
    expect(p.cable).toEqual({ from: [2, 4, 0], to: [2, 4 - HOIST_START, 0] });
  });

  it("colours nothing until the check has something to say", () => {
    const p = yardPosture(crane());
    expect(p.members).toHaveLength(1);
    expect(p.members[0].utilization).toBeNull();
    expect(p.members[0].broken).toBe(false);
  });

  it("takes the check's utilizations once it has run", () => {
    const checked = edits.showCheck(crane());
    const p = yardPosture(checked);
    const solved = checked.checkResult?.members ?? [];
    if (solved.length === 0) {
      expect(p.members[0].utilization).toBeNull();
    } else {
      expect(p.members[0].utilization).toBe(solved[0].utilization);
    }
  });
});

describe("a crane in a run", () => {
  const running = (): GantryState => {
    const started = beginRun(addMoveStep(crane(), "slew", 15, 30));
    if (started === null) throw new Error("the crane should have run");
    return started;
  };

  it("is posed live, through the simulation's own geometry", () => {
    const p = yardPosture(running());
    expect(p.live).toBe(true);
    expect(p.cable).not.toBeNull();
    expect(p.hook?.centre).toEqual(p.cable?.to);
    expect(p.trolley?.centre).toEqual(p.cable?.from);
  });

  it("draws a broken member where it stood, marked broken", () => {
    const s = running();
    s.run.broken = [s.sites[s.siteIndex].structure.members[0].id];
    const p = yardPosture(s);
    expect(p.members[0].broken).toBe(true);
  });

  it("leaves a lost load out of the picture", () => {
    const s = running();
    s.run.loads[0].phase = "lost";
    expect(yardPosture(s).loads).toHaveLength(0);
  });

  it("marks a pad the load has been set down on", () => {
    const s = running();
    s.run.loads[0].phase = "placed";
    expect(yardPosture(s).pads[0].placed).toBe(true);
  });
});
