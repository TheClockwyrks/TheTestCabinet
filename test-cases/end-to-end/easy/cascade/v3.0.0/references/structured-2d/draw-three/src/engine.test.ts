import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEVELS, TAGS } from "./constants";
import { diagnosticSources } from "./diagnostics";
import { cascadeState } from "./game";
import {
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "./harness";
import { offscreenAvailable } from "./canvas-shim";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("the world the engine builds", () => {
  it("opens the one registered level and never leaves it", async () => {
    expect(h.engine.world.level).toBe(LEVELS.table);
    openTable(h);
    h.debug.setScreen("won");
    await h.advance(30);
    expect(h.engine.world.level).toBe(LEVELS.table);
  });

  it("places one actor under each of the three tags", () => {
    for (const tag of Object.values(TAGS)) {
      expect(h.engine.world.byTag(tag), tag).toHaveLength(1);
    }
  });

  it("adds one player, possessing nothing, and never sets a match phase", () => {
    const players = h.engine.world.players();
    expect(players).toHaveLength(1);
    expect(players[0].pawn).toBeNull();
    expect(h.engine.world.state.phase).toBe("waiting");
  });

  it("holds the state the mode named, and the surface initialize returned", () => {
    expect(cascadeState(h.engine.world)).toBe(h.engine.world.state);
    expect(h.engine.debug).toBe(h.debug);
  });

  it("stands an offscreen surface up for the painted layer", () => {
    expect(offscreenAvailable()).toBe(true);
  });
});

describe("the render-free core", () => {
  it("accumulates game time on every screen", async () => {
    for (const screen of ["title", "howto", "playing", "won"] as const) {
      h.debug.reset();
      h.debug.setScreen(screen);
      await h.advance(60);
      expect(h.debug.snapshot().simTime, screen).toBeCloseTo(1, 6);
    }
  });

  it("advances on elapsed time alone, however it was divided into frames", async () => {
    const run = async (
      frames: number,
      stepMs: number,
    ): Promise<[number, number]> => {
      openTable(h);
      h.debug.setLaunching(false);
      h.debug.setTrailPainting(false);
      h.debug.addFlyer("hearts", 5, 400, -4000, 240, 0);
      h.setStep(stepMs);
      await h.advance(frames);
      const shot = h.debug.snapshot();
      return [shot.simTime, shot.flyers[0].x];
    };

    const [oneTime, oneX] = await run(1, 1000);
    const [manyTime, manyX] = await run(60, 1000 / 60);
    expect(manyTime).toBeCloseTo(oneTime, 6);
    expect(Math.abs(manyX - oneX)).toBeLessThan(0.5);
  });

  it("mirrors the runtime's mute bit into the state each frame", async () => {
    openTable(h);
    h.engine.world.audio.setMuted(true);
    await h.advance(1);
    expect(h.debug.snapshot().muted).toBe(true);
    h.engine.world.audio.setMuted(false);
    await h.advance(1);
    expect(h.debug.snapshot().muted).toBe(false);
  });

  it("silences a cue while muted and sounds it again once unmuted", () => {
    openTable(h);
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    h.engine.world.audio.setMuted(true);
    h.cues.length = 0;
    h.debug.autoMove("tableau", 0);
    const muted = h.cues.filter((play) => play.cue === "home");
    expect(muted).toHaveLength(1);
    expect(muted[0].gain).toBe(0);

    poseColumn(h, 1, [{ suit: "spades", rank: 1 }]);
    h.engine.world.audio.setMuted(false);
    h.cues.length = 0;
    h.debug.autoMove("tableau", 1);
    const audible = h.cues.filter((play) => play.cue === "home");
    expect(audible).toHaveLength(1);
    expect(audible[0].gain).toBeGreaterThan(0);
  });
});

describe("the diagnostic sources", () => {
  it("names the screen, the deal mode, the piles, the hand and the cascade", () => {
    openTable(h);
    poseColumn(h, 0, [
      { suit: "spades", rank: 9 },
      { suit: "hearts", rank: 8 },
    ]);
    poseFoundation(h, 0, "clubs", 3);
    h.debug.addCard("stock", 0, "hearts", 2, false);
    h.debug.pointerDown(274, 280);
    h.debug.addFlyer("spades", 3, 0, 0, 0, 0);

    const sources = new Map(
      diagnosticSources(() => cascadeState(h.engine.world)).map(
        ([name, read]) => [name, read()],
      ),
    );
    expect([...sources.keys()]).toEqual([
      "screen",
      "deal",
      "stock",
      "waste",
      "foundations",
      "columns",
      "drag",
      "cascade",
    ]);
    expect(sources.get("screen")).toBe("playing");
    expect(String(sources.get("deal"))).toContain("draw-three");
    expect(sources.get("stock")).toBe(1);
    expect(String(sources.get("waste"))).toContain("showing 0");
    expect(String(sources.get("foundations"))).toBe("3 0 0 0");
    expect(String(sources.get("columns"))).toBe("1 0 0 0 0 0 0");
    expect(String(sources.get("drag"))).toContain("tableau");
    expect(String(sources.get("cascade"))).toContain("flying 1");
  });

  it("reads without writing, so watching the overlay changes nothing", async () => {
    openTable(h);
    poseColumn(h, 0, [{ suit: "spades", rank: 9 }]);
    const before = JSON.stringify(h.debug.snapshot());
    const sources = diagnosticSources(() => cascadeState(h.engine.world));
    for (const [, read] of sources) read();
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);

    // And the engine's own toggle, which is the key the overlay answers.
    h.tap("Backquote");
    await h.advance(1);
    const shown = JSON.stringify({
      ...h.debug.snapshot(),
      simTime: 0,
    });
    h.tap("Backquote");
    await h.advance(1);
    expect(JSON.stringify({ ...h.debug.snapshot(), simTime: 0 })).toBe(shown);
  });
});
