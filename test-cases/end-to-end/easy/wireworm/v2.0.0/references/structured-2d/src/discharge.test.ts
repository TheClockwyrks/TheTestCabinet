import { describe, expect, it } from "vitest";
import { noCues } from "./audio";
import { ARC_LIFE, SCORE_FRY, SCORE_PURGE_NODE } from "./constants";
import { advanceArcs, detonate } from "./discharge";
import { playingState, poseWorm } from "./fixtures";
import { nodeAt, putNode } from "./grid";

describe("the chain", () => {
  it("reaches every charged node within two tiles, and floods on from there", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    putNode(state, 12, 5, 1);
    putNode(state, 13, 5, 1);
    detonate(state, 10, 5, noCues());
    expect(state.nodes).toHaveLength(0);
    // The second wave: (13,5) is three tiles from the struck node and one from
    // the node the first wave detonated, so it is reached through that one.
    expect(state.arcs.map((arc) => [arc.from.c, arc.to.c])).toEqual([
      [10, 12],
      [12, 13],
    ]);
  });

  it("stops at a charged node further than two tiles from anything it detonated", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    putNode(state, 13, 5, 2);
    detonate(state, 10, 5, noCues());
    expect(nodeAt(state.nodes, 13, 5)?.charge).toBe(2);
    expect(state.arcs).toHaveLength(0);
  });

  it("leaps over an inert node, which neither detonates nor conducts", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    putNode(state, 12, 5, 0);
    putNode(state, 14, 5, 2);
    detonate(state, 10, 5, noCues());
    expect(nodeAt(state.nodes, 12, 5)?.charge).toBe(0);
    expect(nodeAt(state.nodes, 14, 5)?.charge).toBe(2);
    expect(state.arcs).toHaveLength(0);
  });

  it("detonates each node once, and reports one link per node beyond the struck one", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    putNode(state, 11, 5, 1);
    putNode(state, 12, 5, 1);
    putNode(state, 11, 6, 2);
    detonate(state, 10, 5, noCues());
    expect(state.nodes).toHaveLength(0);
    expect(state.arcs).toHaveLength(3);
    const links = state.arcs.map(
      (arc) => `${arc.from.c},${arc.from.r}->${arc.to.c},${arc.to.r}`,
    );
    expect(new Set(links).size).toBe(links.length);
  });

  it("takes the nodes one wave reaches in ascending row, then column", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    putNode(state, 11, 6, 1);
    putNode(state, 9, 4, 1);
    detonate(state, 10, 5, noCues());
    expect(state.arcs.map((arc) => [arc.to.c, arc.to.r])).toEqual([
      [9, 4],
      [11, 6],
    ]);
  });

  it("pays for every node it removed", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    putNode(state, 11, 5, 1);
    detonate(state, 10, 5, noCues());
    expect(state.score).toBe(SCORE_PURGE_NODE * 2);
  });

  it("raises its cue once however many nodes it took", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    putNode(state, 11, 5, 1);
    const cues = noCues();
    detonate(state, 10, 5, cues);
    expect(cues.discharge).toBe(true);
  });
});

describe("what the discharge does to the worm", () => {
  it("destroys every segment within two tiles and leaves the rest standing", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    // Seven segments across row 7, columns 14 down to 8. Columns 12 to 8 are
    // all within two tiles of (10, 5); 14 and 13 are not.
    poseWorm(state, 14, 7, 7);
    const fried = detonate(state, 10, 5, noCues());
    expect(fried).toBe(5);
    expect(state.worms).toHaveLength(1);
    expect(state.worms[0].segments.map((s) => s.c)).toEqual([14, 13]);
    expect(state.score).toBe(SCORE_PURGE_NODE + SCORE_FRY * 5);
  });

  it("leaves nothing behind on the tiles it fried", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    poseWorm(state, 11, 6, 2);
    detonate(state, 10, 5, noCues());
    expect(state.worms).toHaveLength(0);
    expect(state.nodes).toHaveLength(0);
  });

  it("cuts a worm it caught in the middle into the runs that survived", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    // Nine segments across row 5, with the middle three inside the blast.
    poseWorm(state, 14, 5, 9);
    detonate(state, 10, 5, noCues());
    expect(state.worms.map((worm) => worm.segments.map((s) => s.c))).toEqual([
      [14, 13],
      [7, 6],
    ]);
  });
});

describe("the arcs", () => {
  it("last exactly their own life and are gone after it", () => {
    const state = playingState();
    putNode(state, 10, 5, 3);
    putNode(state, 11, 5, 1);
    detonate(state, 10, 5, noCues());
    advanceArcs(state, ARC_LIFE / 2);
    expect(state.arcs).toHaveLength(1);
    advanceArcs(state, ARC_LIFE / 2);
    expect(state.arcs).toHaveLength(0);
  });
});
