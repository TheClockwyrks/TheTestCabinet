// The surface's own edges: what each removal takes away, what each pose refuses,
// and the guard the action registration puts on the engine it is given.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InitApi } from "@clockwyrks/structured-2d";
import { CHARGE_MAX, LAYOUT, TOTAL_LEVELS, tileCX, tileCY } from "./constants";
import { createHarness, poseWorm, startPlaying, type Harness } from "./harness";
import { registerActions } from "./input";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("removing what a scenario is done with", () => {
  it("takes one entity by its id, and leaves the rest", () => {
    startPlaying(h.debug);
    const first = poseWorm(h.debug, 8, 6, 2);
    const second = poseWorm(h.debug, 20, 6, 2);
    h.debug.addFoe("glitch", 300, 300);
    h.debug.addFoe("dropper", 400, 200);
    h.debug.addBolt(500, 400);
    h.debug.addBolt(600, 400);
    const before = h.debug.snapshot();

    h.debug.removeWorm(first);
    h.debug.removeFoe(before.foes[0].id);
    h.debug.removeBolt(before.bolts[0].id);
    const after = h.debug.snapshot();
    expect(after.worms.map((worm) => worm.id)).toEqual([second]);
    expect(after.foes.map((foe) => foe.kind)).toEqual(["dropper"]);
    expect(after.bolts.map((bolt) => bolt.id)).toEqual([before.bolts[1].id]);
  });

  it("empties one roster at a time, leaving the others standing", () => {
    startPlaying(h.debug);
    h.debug.setNode(3, 3, 1);
    poseWorm(h.debug, 8, 6, 2);
    h.debug.addFoe("glitch", 300, 300);
    h.debug.addBolt(500, 400);

    h.debug.clearBolts();
    expect(h.debug.snapshot().bolts).toHaveLength(0);
    expect(h.debug.snapshot().worms).toHaveLength(1);
    h.debug.clearFoes();
    expect(h.debug.snapshot().foes).toHaveLength(0);
    expect(h.debug.snapshot().nodes).toHaveLength(1);
    h.debug.clearWorms();
    expect(h.debug.snapshot().worms).toHaveLength(0);
    expect(h.debug.snapshot().nodes).toHaveLength(1);
    h.debug.clearNodes();
    expect(h.debug.snapshot().nodes).toHaveLength(0);
  });

  it("clears one node, leaving its tile empty", () => {
    startPlaying(h.debug);
    h.debug.setNode(3, 3, 2);
    h.debug.setNode(4, 3, 2);
    h.debug.clearNode(3, 3);
    expect(h.debug.snapshot().nodes).toEqual([{ c: 4, r: 3, charge: 2 }]);
  });

  it("does nothing for an id no entity carries", () => {
    startPlaying(h.debug);
    const id = poseWorm(h.debug, 8, 6, 2);
    h.debug.removeWorm(id + 999);
    h.debug.removeFoe(id + 999);
    h.debug.removeBolt(id + 999);
    h.debug.setWormHeading(id + 999, -1);
    h.debug.setFoeVelocity(id + 999, 1, 1);
    h.debug.setFoeHit(id + 999, true);
    h.debug.setFoeMind(id + 999, false);
    h.debug.setFoeTravel(id + 999, false);
    h.debug.appendSegment(id + 999, 1, 1);
    expect(h.debug.snapshot().worms).toHaveLength(1);
  });
});

describe("what a pose refuses", () => {
  it("keeps a charge inside the field's own range", () => {
    startPlaying(h.debug);
    h.debug.setNode(5, 5, 9);
    expect(h.debug.snapshot().nodes[0].charge).toBe(CHARGE_MAX);
    h.debug.setNode(5, 5, -4);
    expect(h.debug.snapshot().nodes[0].charge).toBe(0);
  });

  it("lays nothing off the board", () => {
    startPlaying(h.debug);
    h.debug.setNode(-1, 5, 2);
    h.debug.setNode(5, 40, 2);
    expect(h.debug.snapshot().nodes).toHaveLength(0);
  });

  it("keeps the level inside the run", () => {
    startPlaying(h.debug);
    h.debug.setLevel(99);
    expect(h.debug.snapshot().level).toBe(TOTAL_LEVELS);
    h.debug.setLevel(0);
    expect(h.debug.snapshot().level).toBe(1);
  });

  it("clamps a posed cursor into the band", () => {
    startPlaying(h.debug);
    h.debug.setCursor(-90, 900);
    const { cursor } = h.debug.snapshot();
    expect(cursor.x).toBe(16);
    expect(cursor.y).toBe(704);
  });

  it("takes no negative time on a timer", () => {
    startPlaying(h.debug);
    h.debug.setCursorInvulnerable(-3);
    h.debug.setFireCooldown(-3);
    const shot = h.debug.snapshot();
    expect(shot.cursor.invulnerable).toBe(0);
    expect(shot.fireCooldown).toBe(0);
  });

  it("appends a segment to the tail end of the worm it names", () => {
    startPlaying(h.debug);
    const id = poseWorm(h.debug, 8, 6, 1);
    h.debug.appendSegment(id, 7, 6);
    h.debug.appendSegment(id, 6, 6);
    expect(h.debug.snapshot().worms[0].segments).toEqual([
      { c: 8, r: 6 },
      { c: 7, r: 6 },
      { c: 6, r: 6 },
    ]);
  });

  it("adds a bolt that then resolves through the game's own shot rules", async () => {
    startPlaying(h.debug);
    h.debug.setNode(8, 6, 0);
    h.debug.addBolt(tileCX(8), tileCY(6));
    await h.advance(1);
    expect(h.debug.snapshot().nodes).toHaveLength(0);
    expect(h.debug.snapshot().bolts).toHaveLength(0);
  });
});

describe("the actions the build registers", () => {
  it("refuses an engine built without the layout the game is written for", () => {
    const registered: string[] = [];
    const api = (layout: string | null): Pick<InitApi, "input"> => ({
      input: {
        register: (name: string) => registered.push(name),
        layout: () => (layout === null ? null : { name: layout, actions: [] }),
      },
    });
    expect(() => registerActions(api(null))).toThrow(LAYOUT);
    expect(() => registerActions(api("dpad-4"))).toThrow("dpad-4");
    expect(registered).toHaveLength(0);
    registerActions(api(LAYOUT));
    expect(registered).toContain("mute");
  });
});
