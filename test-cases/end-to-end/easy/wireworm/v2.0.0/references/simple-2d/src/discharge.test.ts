// The chain-arc discharge, run directly so the shape of the chain and the arcs
// it reports can be read one link at a time.

import { describe, expect, it } from "vitest";
import {
  ARC_LIFE,
  DISCHARGE_RADIUS,
  SCORE_FRY,
  SCORE_PURGE_NODE,
} from "./constants";
import { ageArcs, detonate } from "./discharge";
import { putNode } from "./field";
import { blankState } from "./flow";
import { addWorm } from "./worm";
import { newFrameEvents, toSim, type Sim } from "./sim";

function sim(): Sim {
  return toSim(blankState());
}

/** A worm of `length` segments running right from `(c, r)`, held still. */
function lay(s: Sim, c: number, r: number, length: number): number {
  const worm = addWorm(s, c, r);
  for (let i = 1; i < length; i++) worm.segments.push({ c: c + i, r });
  worm.stepping = false;
  return worm.id;
}

describe("the chain", () => {
  it("reaches a charged node at the edge of the radius and no further", () => {
    const s = sim();
    putNode(s, 10, 10, 3);
    putNode(s, 12, 12, 1);
    putNode(s, 15, 10, 1);
    detonate(s, 10, 10, newFrameEvents());
    expect(s.nodes.map((n) => `${n.c},${n.r}`)).toEqual(["15,10"]);
  });

  it("leaps over an inert node, which neither detonates nor conducts", () => {
    const s = sim();
    putNode(s, 10, 10, 3);
    putNode(s, 11, 10, 0);
    putNode(s, 13, 10, 1);
    detonate(s, 10, 10, newFrameEvents());
    // The inert node stands, and the charged node beyond it is out of reach of
    // every node the chain detonated.
    expect(s.nodes.map((n) => `${n.c},${n.r}:${n.charge}`)).toEqual([
      "11,10:0",
      "13,10:1",
    ]);
  });

  it("runs onward from each node it detonates", () => {
    const s = sim();
    putNode(s, 4, 10, 3);
    for (let c = 6; c <= 20; c += 2) putNode(s, c, 10, 1);
    detonate(s, 4, 10, newFrameEvents());
    expect(s.nodes).toHaveLength(0);
  });

  it("reports one link per node beyond the struck one, and no link twice", () => {
    const s = sim();
    putNode(s, 10, 10, 3);
    for (const [c, r] of [
      [9, 9],
      [11, 9],
      [9, 11],
      [11, 11],
      [12, 10],
    ] as const) {
      putNode(s, c, r, 1);
    }
    detonate(s, 10, 10, newFrameEvents());
    expect(s.arcs).toHaveLength(5);
    const seen = s.arcs.map(
      (arc) => `${arc.from.c},${arc.from.r}>${arc.to.c},${arc.to.r}`,
    );
    expect(new Set(seen).size).toBe(seen.length);
    // Every link starts at a node the chain had already detonated.
    expect(s.arcs[0]?.from).toEqual({ c: 10, r: 10 });
  });

  it("takes the nodes one node reaches in ascending row, then column", () => {
    const s = sim();
    putNode(s, 10, 10, 3);
    putNode(s, 11, 9, 1);
    putNode(s, 9, 9, 1);
    putNode(s, 9, 11, 1);
    detonate(s, 10, 10, newFrameEvents());
    expect(s.arcs.map((arc) => `${arc.to.c},${arc.to.r}`)).toEqual([
      "9,9",
      "11,9",
      "9,11",
    ]);
  });

  it("ages its arcs out after their life", () => {
    const s = sim();
    putNode(s, 10, 10, 3);
    putNode(s, 12, 10, 1);
    detonate(s, 10, 10, newFrameEvents());
    expect(s.arcs).toHaveLength(1);
    ageArcs(s, ARC_LIFE / 2);
    expect(s.arcs).toHaveLength(1);
    ageArcs(s, ARC_LIFE / 2);
    expect(s.arcs).toHaveLength(0);
  });

  it("does nothing where no node stands on the tile", () => {
    const s = sim();
    const ev = newFrameEvents();
    detonate(s, 3, 3, ev);
    expect(s.arcs).toHaveLength(0);
    expect(ev.cues.size).toBe(0);
  });
});

describe("what it does to the worm", () => {
  it("destroys every segment in reach and spares the ones beyond it", () => {
    const s = sim();
    putNode(s, 10, 10, 3);
    lay(s, 10, 10 + DISCHARGE_RADIUS, 1);
    lay(s, 10, 10 + DISCHARGE_RADIUS + 1, 1);
    detonate(s, 10, 10, newFrameEvents());
    expect(s.worms).toHaveLength(1);
    expect(s.worms[0]?.segments[0]).toEqual({ c: 10, r: 13 });
  });

  it("leaves nothing where a fried segment stood", () => {
    const s = sim();
    putNode(s, 10, 10, 3);
    lay(s, 10, 11, 1);
    detonate(s, 10, 10, newFrameEvents());
    expect(s.nodes).toHaveLength(0);
  });

  it("splits a worm cut through its middle, the head-side piece keeping the id", () => {
    const s = sim();
    putNode(s, 10, 5, 3);
    const id = lay(s, 6, 5, 9);
    detonate(s, 10, 5, newFrameEvents());
    expect(s.worms).toHaveLength(2);
    expect(s.worms[0]?.id).toBe(id);
    expect(s.worms[0]?.segments.map((t) => t.c)).toEqual([6, 7]);
    expect(s.worms[1]?.id).not.toBe(id);
    expect(s.worms[1]?.segments.map((t) => t.c)).toEqual([13, 14]);
  });

  it("pays for every node purged and every segment fried, and sounds once", () => {
    const s = sim();
    putNode(s, 10, 10, 3);
    putNode(s, 12, 10, 1);
    lay(s, 10, 11, 3);
    const ev = newFrameEvents();
    detonate(s, 10, 10, ev);
    expect(s.score).toBe(SCORE_PURGE_NODE * 2 + SCORE_FRY * 3);
    expect(ev.segmentsRemoved).toBe(3);
    expect([...ev.cues]).toEqual(["discharge"]);
  });
});
