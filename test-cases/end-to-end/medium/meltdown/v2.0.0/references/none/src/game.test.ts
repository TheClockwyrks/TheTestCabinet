// Meltdown over the runtime: the four functions, and the seam between them.
//
// The layer BENEATH the game is `src/runtime.test.ts`, and the rules the
// simulation resolves are measured in `src/sim.test.ts`, `src/heat.test.ts` and
// the rest. What is measured HERE is only what `src/game.ts` itself decides:
//
//   * what `initialize` declares — every action, every cue, every overlay source;
//   * that an update mirrors the runtime's pointer and mute bit into the state;
//   * that an action edge reaches `performAction` once per press;
//   * WHERE THE PAUSE GATE SITS. The gate is in the game's own update, against
//     the game's own clock, so a paused build freezes on the WALL clock and not
//     merely when something declines to step it (specs/waves.md). That is
//     measured here by handing the game real deltas and reading the floor, never
//     by asking whether a stepping operation was refused.
//   * that a cue raised between two frames is played BY a frame, because a cue
//     belongs to the frame loop (specs/audio.md).

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { beforeEach, describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS, CUES, STAGE_H, STAGE_W } from "./constants";
import { CUE_SPECS } from "./audio";
import { createGame } from "./game";
import { addUnit } from "./sim";
import { startRun, type MeltdownState } from "./state";
import type { InitApi, RenderApi, UpdateApi } from "./runtime";
import type { PointerSample } from "./pointer";

// ---- A recording stand-in for everything the runtime supplies -------------

interface Recorder {
  actions: string[];
  cues: [string, unknown][];
  sources: string[];
  played: string[];
  edges: Set<string>;
  pointer: { x: number; y: number; down: boolean };
  muted: boolean;
  init: InitApi<MeltdownState>;
  api: UpdateApi;
}

function recorder(): Recorder {
  const r: Partial<Recorder> &
    Pick<
      Recorder,
      "actions" | "cues" | "sources" | "played" | "edges" | "pointer" | "muted"
    > = {
    actions: [],
    cues: [],
    sources: [],
    played: [],
    edges: new Set<string>(),
    pointer: { x: 0, y: 0, down: false },
    muted: false,
  };
  const full = r as Recorder;
  full.init = {
    input: {
      register: (name, keys) => full.actions.push(`${name}=${keys.join(",")}`),
    },
    audio: { define: (cue, spec) => full.cues.push([cue, spec]) },
    diagnostics: { register: (name) => full.sources.push(name) },
  };
  full.api = {
    input: {
      // An edge is consumed by the read, exactly as the keyboard's is.
      pressed: (name) => full.edges.delete(name),
      pointer: () => full.pointer,
    },
    audio: {
      play: (cue) => full.played.push(cue),
      setMuted: (muted) => {
        full.muted = muted;
      },
      muted: () => full.muted,
    },
  };
  return full;
}

interface Fixture {
  game: ReturnType<typeof createGame>;
  state: MeltdownState;
  r: Recorder;
  /** Run one frame worth `dt` seconds of elapsed time. Draws nothing. */
  frame(dt: number): void;
  /** Press an action, so the next frame sees its edge. */
  press(action: string): void;
  /** Report one pointer event, resolved the moment it arrives. */
  point(sample: PointerSample): void;
}

function fixture(): Fixture {
  const r = recorder();
  const game = createGame();
  const state = game.initialize(r.init);
  return {
    game,
    state,
    r,
    frame: (dt) => game.update(state, r.api, dt),
    press: (action) => {
      r.edges.add(action);
    },
    point: (sample) => game.pointer(state, sample, r.api),
  };
}

let f: Fixture;

beforeEach(() => {
  f = fixture();
});

// ---- initialize ---------------------------------------------------------

describe("initialize", () => {
  it("registers every action against its binding, and nothing else", () => {
    expect(f.r.actions).toEqual(
      ACTIONS.map((action) => `${action}=${BINDINGS[action].join(",")}`),
    );
  });

  it("declares every cue the game can play", () => {
    expect(f.r.cues.map(([cue]) => cue)).toEqual(CUE_SPECS.map(([cue]) => cue));
    expect(new Set(f.r.cues.map(([cue]) => cue))).toEqual(
      new Set(Object.values(CUES)),
    );
  });

  it("names the overlay's sources", () => {
    expect(f.r.sources).toEqual([
      "screen",
      "mode",
      "money",
      "lives",
      "wave",
      "score",
      "routes",
      "towers",
      "surge",
    ]);
  });

  it("returns a complete title-screen state, having run no frame", () => {
    expect(f.state.screen).toBe("title");
    expect(f.state.simTime).toBe(0);
    expect(f.state.towers).toEqual([]);
    expect(f.state.surge).toEqual([]);
  });
});

// ---- What an update mirrors --------------------------------------------

describe("every update", () => {
  it("mirrors the runtime's pointer into the state", () => {
    f.r.pointer = { x: 321.5, y: 47.25, down: true };
    f.frame(1 / 60);
    expect(f.state.pointer).toEqual({ x: 321.5, y: 47.25, down: true });
  });

  it("mirrors the runtime's mute bit, which the runtime owns", () => {
    f.r.muted = true;
    f.frame(1 / 60);
    expect(f.state.muted).toBe(true);
    f.r.muted = false;
    f.frame(1 / 60);
    expect(f.state.muted).toBe(false);
  });

  it("takes each action edge once, however many frames follow it", () => {
    f.press("down");
    f.frame(1 / 60);
    expect(f.state.menuIndex).toBe(1);
    f.frame(1 / 60);
    f.frame(1 / 60);
    expect(f.state.menuIndex).toBe(1);
  });

  it("reads the mute action through the runtime's bus, not the state", () => {
    f.press("mute");
    f.frame(1 / 60);
    expect(f.r.muted).toBe(true);
    expect(f.state.muted).toBe(true);
  });
});

// ---- The clock and the pause gate -------------------------------------

describe("the game's own clock", () => {
  /** A run in its wave phase with one Mote on the floor and nothing released. */
  function playing(): number {
    startRun(f.state);
    f.state.screen = "playing";
    f.state.phase = "wave";
    f.state.waveSpawning = false;
    return addUnit(f.state, "mote", "left").id;
  }

  it("accumulates the game time it advanced by", () => {
    playing();
    f.frame(0.5);
    f.frame(0.25);
    expect(f.state.simTime).toBeCloseTo(0.75, 9);
  });

  it("gains twice as fast at speed 2, and reaches the same floor", () => {
    const id = playing();
    f.state.speed = 2;
    f.frame(0.5);
    expect(f.state.simTime).toBeCloseTo(1, 9);
    const fast = f.state.surge.find((u) => u.id === id)?.x;

    const other = fixture();
    startRun(other.state);
    other.state.screen = "playing";
    other.state.phase = "wave";
    other.state.waveSpawning = false;
    const slowId = addUnit(other.state, "mote", "left").id;
    other.frame(1);
    expect(other.state.simTime).toBeCloseTo(1, 9);
    expect(other.state.surge.find((u) => u.id === slowId)?.x).toBeCloseTo(
      fast ?? Number.NaN,
      6,
    );
  });

  it("freezes the floor while paused, on the clock the player's game runs on", () => {
    // The pause gate is measured by handing the game a real interval of elapsed
    // time and reading the floor, exactly as a real-time check must
    // (specs/waves.md). Nothing here declines to step the game.
    const id = playing();
    const at = () => f.state.surge.find((u) => u.id === id)?.x ?? Number.NaN;

    const before = at();
    f.frame(0.5);
    const ran = at();
    expect(ran).toBeGreaterThan(before);

    f.state.screen = "paused";
    const held = at();
    const heldTime = f.state.simTime;
    f.frame(0.5);
    f.frame(0.5);
    expect(at()).toBe(held);
    expect(f.state.simTime).toBe(heldTime);
  });

  it("resumes from exactly where the pause left the floor", () => {
    const id = playing();
    f.frame(0.5);
    f.state.screen = "paused";
    const held = f.state.surge.find((u) => u.id === id)?.x;
    f.frame(2);
    f.state.screen = "playing";
    f.frame(0.5);
    const after = f.state.surge.find((u) => u.id === id)?.x ?? Number.NaN;
    expect(after).toBeGreaterThan(held ?? Number.NaN);
    // The two seconds spent paused bought nothing: one second of play, run in
    // two halves, has moved the unit a second's worth and no more.
    const other = fixture();
    startRun(other.state);
    other.state.screen = "playing";
    other.state.phase = "wave";
    other.state.waveSpawning = false;
    const id2 = addUnit(other.state, "mote", "left").id;
    other.frame(0.5);
    other.frame(0.5);
    expect(after).toBeCloseTo(
      other.state.surge.find((u) => u.id === id2)?.x ?? Number.NaN,
      6,
    );
  });

  it("keeps the pause key working while the floor is frozen", () => {
    playing();
    f.state.screen = "paused";
    f.press("pause");
    f.frame(1 / 60);
    expect(f.state.screen).toBe("playing");
  });

  it("holds the simulation on an ended run, and keeps its own clock", () => {
    const id = playing();
    f.state.screen = "gameover";
    const held = f.state.surge.find((u) => u.id === id)?.x;
    f.frame(0.5);
    expect(f.state.surge.find((u) => u.id === id)?.x).toBe(held);
    expect(f.state.simTime).toBeCloseTo(0.5, 9);
  });
});

// ---- Where a cue comes from -------------------------------------------

describe("cues", () => {
  it("plays a cue the frame's own actions raised, in that frame", () => {
    f.press("down");
    f.frame(1 / 60);
    expect(f.r.played).toEqual(["menu"]);
  });

  it("queues a cue a pointer event raised, and plays it on the next frame", () => {
    // A pointer event resolves between two frames, so its cue cannot sound from
    // outside the loop (specs/audio.md).
    f.point({ type: "down", x: 490, y: 460, silent: false });
    f.point({ type: "up", x: 490, y: 460, silent: false });
    expect(f.r.played).toEqual([]);
    f.frame(1 / 60);
    expect(f.r.played).toEqual(["menu"]);
    f.frame(1 / 60);
    expect(f.r.played).toEqual(["menu"]);
  });

  it("raises none at all for an event reported through the debug surface", () => {
    f.point({ type: "down", x: 490, y: 460, silent: true });
    f.point({ type: "up", x: 490, y: 460, silent: true });
    f.frame(1 / 60);
    f.frame(1 / 60);
    expect(f.r.played).toEqual([]);
  });

  it("resolves a silent event identically, cue aside", () => {
    const loud = fixture();
    loud.point({ type: "down", x: 490, y: 460, silent: false });
    loud.point({ type: "up", x: 490, y: 460, silent: false });
    f.point({ type: "down", x: 490, y: 460, silent: true });
    f.point({ type: "up", x: 490, y: 460, silent: true });
    expect(f.state.screen).toBe(loud.state.screen);
    expect(f.state.menuIndex).toBe(loud.state.menuIndex);
  });
});

// ---- render ------------------------------------------------------------

describe("render", () => {
  it("draws through the context it is handed, changing no state", () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d");
    const api: RenderApi = {
      ctx: ctx as unknown as CanvasRenderingContext2D,
    };
    const before = JSON.stringify({
      screen: f.state.screen,
      simTime: f.state.simTime,
      menuIndex: f.state.menuIndex,
    });
    f.game.render(f.state, api);
    const { data } = (ctx as SKRSContext2D).getImageData(
      STAGE_W / 2,
      STAGE_H / 2,
      1,
      1,
    );
    // Something was painted at the centre of the title screen.
    expect(data[3]).toBeGreaterThan(0);
    expect(
      JSON.stringify({
        screen: f.state.screen,
        simTime: f.state.simTime,
        menuIndex: f.state.menuIndex,
      }),
    ).toBe(before);
  });

  it("draws every screen the game can be on without throwing", () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const api: RenderApi = {
      ctx: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
    };
    const screens: MeltdownState["screen"][] = [
      "title",
      "modeselect",
      "difficultyselect",
      "howto",
      "playing",
      "paused",
      "victory",
      "gameover",
    ];
    startRun(f.state);
    addUnit(f.state, "hulk", "top");
    for (const screen of screens) {
      f.state.screen = screen;
      for (const phase of ["opening", "building", "wave"] as const) {
        f.state.phase = phase;
        expect(() => f.game.render(f.state, api)).not.toThrow();
      }
    }
  });
});
