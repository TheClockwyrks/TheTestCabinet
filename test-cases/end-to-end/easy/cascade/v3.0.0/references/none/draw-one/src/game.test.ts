import { describe, expect, it } from "vitest";
import {
  CUES,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  STAGE_H,
  STAGE_W,
} from "./constants";
import { BACKGROUND, game } from "./game";
import { RecordingAudio, stageContext } from "./harness.test-support";
import type { CueSpec } from "./audio-bus";
import type { InitApi, UpdateApi } from "./runtime";
import type { PointerPosition, PointerSample } from "./pointer";
import type { CascadeState } from "./state";

/** The init surface the runtime hands `initialize`, recorded. */
function initApi() {
  const cues = new Map<string, CueSpec>();
  const sources = new Map<string, () => unknown>();
  const api: InitApi = {
    audio: {
      define: (cue, spec) => {
        cues.set(cue, spec);
      },
    },
    diagnostics: {
      register: (name, source) => {
        sources.set(name, source);
      },
    },
  };
  return { api, cues, sources };
}

/** The update surface, over a queue of samples the test hands the frame. */
function updateApi(audio: RecordingAudio, queue: PointerSample[]) {
  const position: PointerPosition = { x: 0, y: 0, down: false };
  const api: UpdateApi = {
    pointer: {
      samples: () => queue.splice(0),
      current: () => position,
    },
    audio,
  };
  return api;
}

function boot(): {
  state: CascadeState;
  audio: RecordingAudio;
  queue: PointerSample[];
  api: UpdateApi;
  sources: Map<string, () => unknown>;
  cues: Map<string, CueSpec>;
} {
  const init = initApi();
  const state = game.initialize(init.api);
  const audio = new RecordingAudio();
  const queue: PointerSample[] = [];
  return {
    state,
    audio,
    queue,
    api: updateApi(audio, queue),
    sources: init.sources,
    cues: init.cues,
  };
}

describe("the game the runtime drives", () => {
  it("opens on the title screen with an empty table", () => {
    const { state } = boot();
    expect(state.screen).toBe("title");
    expect(state.stock).toHaveLength(0);
    expect(state.tableau.every((column) => column.length === 0)).toBe(true);
  });

  it("declares the ten cues and names its diagnostics", () => {
    const { cues, sources } = boot();
    expect([...cues.keys()].sort()).toEqual(Object.values(CUES).sort());
    expect([...sources.keys()]).toEqual([
      "screen",
      "deal",
      "stock",
      "waste",
      "foundations",
      "columns",
      "drag",
      "launched",
      "inflight",
    ]);
  });

  it("reports the screen, the deal mode and every pile on the overlay", () => {
    const { state, sources } = boot();
    state.screen = "playing";
    state.stock.push({ id: 1, suit: "spades", rank: 2, faceUp: false });
    expect(sources.get("screen")?.()).toBe("playing");
    expect(String(sources.get("deal")?.())).toContain(DEAL_MODE);
    expect(String(sources.get("deal")?.())).toContain(DEAL_MODE_LABEL);
    expect(sources.get("stock")?.()).toBe(1);
    expect(sources.get("waste")?.()).toBe(0);
    expect(sources.get("foundations")?.()).toBe("0 0 0 0");
    expect(sources.get("columns")?.()).toBe("0 0 0 0 0 0 0");
    expect(sources.get("drag")?.()).toBe("none");
    expect(sources.get("launched")?.()).toBe(0);
    expect(sources.get("inflight")?.()).toBe(0);
  });

  it("accumulates game time whatever the screen", () => {
    const { state, api } = boot();
    game.update(state, api, 0.25);
    expect(state.simTime).toBeCloseTo(0.25, 9);
    state.screen = "playing";
    game.update(state, api, 0.25);
    expect(state.simTime).toBeCloseTo(0.5, 9);
  });

  it("mirrors the runtime's mute bit into the state every update", () => {
    const { state, api, audio } = boot();
    audio.setMuted(true);
    game.update(state, api, 0);
    expect(state.muted).toBe(true);
    audio.setMuted(false);
    game.update(state, api, 0);
    expect(state.muted).toBe(false);
  });

  it("answers a whole gesture delivered inside one frame", () => {
    const { state, api, queue } = boot();
    state.screen = "playing";
    state.tableau[0].push({ id: 1, suit: "spades", rank: 13, faceUp: true });
    state.tableau[1].push({ id: 2, suit: "hearts", rank: 12, faceUp: true });
    // Press on the Queen, cross the table, and release over the King, all in
    // the samples of one frame.
    queue.push(
      { type: "down", x: 396, y: 188 },
      { type: "move", x: 300, y: 200 },
      { type: "up", x: 274, y: 188 },
    );
    game.update(state, api, 1 / 60);
    expect(state.tableau[1]).toHaveLength(0);
    expect(state.tableau[0].map((c) => c.rank)).toEqual([13, 12]);
  });

  it("plays what the frame raised, once each", () => {
    const { state, api, audio, queue } = boot();
    state.screen = "playing";
    state.stock.push({ id: 1, suit: "spades", rank: 2, faceUp: false });
    queue.push({ type: "down", x: 274, y: 74 }, { type: "up", x: 274, y: 74 });
    game.update(state, api, 1 / 60);
    expect(audio.played).toEqual([CUES.turn]);
    game.update(state, api, 1 / 60);
    expect(audio.played).toEqual([CUES.turn]);
  });

  it("draws the state the update left, and names the background it clears to", () => {
    const { state } = boot();
    expect(BACKGROUND).toMatch(/^#[0-9a-f]{6}$/i);
    const surface = stageContext();
    expect(() => game.render(state, { ctx: surface.ctx })).not.toThrow();
    const [r, g, b] = surface.pixel(STAGE_W - 1, STAGE_H - 1);
    expect(r + g + b).toBeGreaterThan(0);
  });
});
