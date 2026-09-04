import { beforeAll, describe, expect, it } from "vitest";
import { HOIST_START } from "./constants";
import { GantryState } from "./game";
import { latticeNodes, yardPosture } from "./posture";
import * as editor from "./editor";
import { currentSite, setScreen } from "./state";
import { nodeKey } from "./sim";

type Node3 = [number, number, number];

interface Design {
  ring: Node3;
  counterweights: Node3[];
  members: [Node3, Node3, string][];
}

let design: Design;

/**
 * `src/sim/designs.json` carries one worked crane per site, so the posture is
 * read off a crane that actually stands rather than off an invented one.
 * `tsconfig.json` is supplied and does not set `resolveJsonModule`, so the file
 * is read through a specifier the compiler does not resolve.
 */
beforeAll(async () => {
  const specifier = "node:fs/promises";
  const fs = (await import(/* @vite-ignore */ specifier)) as {
    readFile(path: URL, encoding: string): Promise<string>;
  };
  const text = await fs.readFile(
    new URL("./sim/designs.json", import.meta.url),
    "utf8",
  );
  design = (JSON.parse(text) as { sites: Design[] }).sites[0];
});

/** Site 0's reference crane, posed through the editor's own edits. */
function crane(state: GantryState): void {
  editor.setRing(state, design.ring);
  for (const [a, b, material] of design.members) {
    editor.addMember(state, a, b, material as "strut" | "cable" | "rail");
  }
  for (const node of design.counterweights) {
    editor.addCounterweight(state, node);
  }
}

describe("latticeNodes", () => {
  it("lists every node on the pitch inside the envelope", () => {
    const nodes = latticeNodes({ min: [0, 0, 0], max: [4, 2, 0] });
    expect(nodes.map(nodeKey)).toEqual([
      "0,0,0",
      "0,2,0",
      "2,0,0",
      "2,2,0",
      "4,0,0",
      "4,2,0",
    ]);
  });

  it("starts at the first node the envelope reaches", () => {
    const nodes = latticeNodes({ min: [-1, -1, -1], max: [1, 1, 1] });
    expect(nodes.map(nodeKey)).toEqual(["0,0,0"]);
  });
});

describe("yardPosture", () => {
  it("poses an empty site with its loads waiting and its pads showing", () => {
    const state = new GantryState();
    const posture = yardPosture(state);
    const site = currentSite(state);
    expect(posture.live).toBe(false);
    expect(posture.slew).toBe(0);
    expect(posture.members).toHaveLength(0);
    expect(posture.loads).toHaveLength(site.loads.length);
    expect(posture.loads[0].phase).toBe("waiting");
    expect(posture.loads[0].pos).toEqual(site.loads[0].from.pos);
    expect(posture.pads[0].pos).toEqual(site.loads[0].to.pos);
    expect(posture.pads[0].placed).toBe(false);
    expect(posture.anchors).toEqual(site.anchors);
    expect(posture.envelope).toEqual(site.envelope);
    // With no track there is nothing to hang the hook from.
    expect(posture.cable).toBeNull();
    expect(posture.trolley).toBeNull();
  });

  it("stands the crane at the run-start posture outside a run", () => {
    const state = new GantryState();
    setScreen(state, "build");
    crane(state);
    const posture = yardPosture(state);
    expect(posture.members).toHaveLength(design.members.length);
    expect(posture.ring).not.toBeNull();
    expect(posture.trolley).not.toBeNull();
    expect(posture.cable).not.toBeNull();
    const pivot = posture.trolley?.centre ?? [0, 0, 0];
    // The hook hangs HOIST_START below the track's origin before a run.
    expect(posture.hook?.centre[1]).toBeCloseTo(pivot[1] - HOIST_START, 9);
  });

  it("colours a member from the check result while none has run", () => {
    const state = new GantryState();
    setScreen(state, "build");
    crane(state);
    expect(yardPosture(state).members[0].utilization).toBeNull();
    editor.showCheck(state);
    const solved = yardPosture(state).members.filter(
      (member) => member.utilization !== null,
    );
    expect(solved.length).toBeGreaterThan(0);
  });

  it("marks a broken member as broken and leaves it where it stood", () => {
    const state = new GantryState();
    setScreen(state, "build");
    crane(state);
    const run = state.run;
    run.phase = "running";
    run.broken = [0];
    run.intact = [];
    const posture = yardPosture(state);
    expect(posture.live).toBe(true);
    expect(posture.members.every((member) => member.broken)).toBe(true);
    expect(posture.members[0].a).toEqual([0, 0, 0]);
  });

  it("leaves a lost load out of the picture", () => {
    const state = new GantryState();
    const run = state.run;
    run.phase = "running";
    run.loads = [{ phase: "lost", pos: { x: 0, y: 0, z: 0 }, yaw: 0 }];
    expect(yardPosture(state).loads).toHaveLength(0);
  });
});
