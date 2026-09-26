import { createCanvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssetStore, assetManifest, type AssetIo } from "./assets";
import { CUES, STEP_SECONDS, SWAP_SECONDS } from "./constants";
import { createGame, reportFor } from "./game";
import {
  cellCenter,
  createInitialState,
  loadBoard,
  setRefillKinds,
  requestSwap,
  setScreen,
  startRound,
  tick,
  type FacetState,
} from "./core";
import { quietRowsWith } from "./core/fixtures";
import type { InitApi, ScratchCanvas, UpdateApi } from "./runtime";
import type { PointerDevice, PointerSample } from "./pointer";

/** One pointer sample as the runtime's pointer layer reports it. */
function sample(
  type: PointerSample["type"],
  x: number,
  y: number,
  device: PointerDevice = "mouse",
  primary = true,
): PointerSample {
  return { type, x, y, device, primary };
}

/** A swap accepted and carried through its travel, so step 1 has resolved. */
function played(
  state: FacetState,
  a: FacetState["selection"],
  b: FacetState["selection"],
) {
  const swapped = requestSwap(state, { a: a!, b: b! }).state;
  return { swapped, resolved: tick(swapped, SWAP_SECONDS).state };
}

/** A scratch factory over real contexts, so the particle players are genuine. */
const scratch: ScratchCanvas = (width, height) =>
  createCanvas(width, height).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;

/** An asset store that never resolves anything: the game runs regardless. */
function emptyAssets(): AssetStore {
  const io: AssetIo = {
    image: () => new Promise(() => {}),
    json: () => new Promise(() => {}),
    bytes: () => new Promise(() => {}),
  };
  return new AssetStore(io, assetManifest());
}

/** A store carrying the three committed particle systems, and nothing else. */
async function loadedAssets(): Promise<AssetStore> {
  const io: AssetIo = {
    image: () => new Promise(() => {}),
    json: (url) =>
      Promise.resolve(
        JSON.parse(
          readFileSync(join(import.meta.dirname, "..", "public", url), "utf8"),
        ),
      ),
    bytes: () => new Promise(() => {}),
  };
  const manifest = assetManifest();
  const store = new AssetStore(io, {
    images: {},
    systems: manifest.systems,
    sounds: {},
  });
  await store.load();
  return store;
}

/** A recording stand-in for the runtime's update-side api. */
function harness(assets: AssetStore = emptyAssets()) {
  const played: [string, number | undefined][] = [];
  const pressed = new Set<string>();
  let samples: PointerSample[] = [];
  let pointer: { x: number; y: number; down: boolean; device: PointerDevice } =
    {
      x: 0,
      y: 0,
      down: false,
      device: "mouse",
    };
  let muted = false;
  const api: UpdateApi = {
    input: {
      pressed(name) {
        const armed = pressed.has(name);
        pressed.delete(name);
        return armed;
      },
      pointer: () => pointer,
      pointerSamples() {
        const taken = samples;
        samples = [];
        return taken;
      },
    },
    audio: {
      play(cue, variant) {
        played.push([cue, variant]);
      },
      setTrack() {},
      setMuted(next) {
        muted = next;
      },
      muted: () => muted,
    },
    assets,
  };
  return {
    api,
    played,
    press: (name: string) => pressed.add(name),
    feed: (next: PointerSample[]) => {
      samples = next;
    },
    movePointer: (next: {
      x: number;
      y: number;
      down: boolean;
      device: PointerDevice;
    }) => {
      pointer = next;
    },
    isMuted: () => muted,
  };
}

/** A game already initialized, and the state its `initialize` built. */
function started() {
  const game = createGame(scratch);
  const registered: string[] = [];
  const declared: string[] = [];
  const api: InitApi<FacetState> = {
    input: { register: (name) => registered.push(name) },
    audio: { define: (cue) => declared.push(cue) },
    diagnostics: { register: () => {} },
    assets: emptyAssets(),
    scratch,
  };
  const [state, debug] = game.initialize(api);
  return { game, state, debug, registered, declared };
}

/** A board carrying a row of three rubies one swap away from meeting. */
const NEAR_RUN = quietRowsWith({
  "2,4": "R0",
  "3,4": "R0",
  "4,5": "R0",
  "4,4": "J0",
});

/**
 * A board posed on a round in play, which is where a move can be made: a swap
 * asked for off the `playing` screen is not a request at all, and `loadBoard`
 * writes the board and nothing else.
 */
const play = (rows: readonly string[]): FacetState =>
  setScreen(loadBoard(createInitialState(), rows), "playing");

describe("reportFor", () => {
  it("reports nothing when no chain step ran", () => {
    const state = play(NEAR_RUN);
    expect(reportFor(state, state)).toBeNull();
  });

  it("reports nothing for a swap still travelling between its cells", () => {
    const before = play(NEAR_RUN);
    const { swapped } = played(before, { col: 4, row: 5 }, { col: 4, row: 4 });
    expect(swapped.phase).toBe("swapping");
    expect(reportFor(before, swapped)).toBeNull();
  });

  it("reports the cells step 1 of a swap's chain cleared", () => {
    const before = play(NEAR_RUN);
    const { swapped, resolved } = played(
      before,
      { col: 4, row: 5 },
      { col: 4, row: 4 },
    );
    const report = reportFor(swapped, resolved);
    expect(report?.cleared.map((cell) => [cell.col, cell.row])).toEqual([
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
    expect(report?.cleared.every((cell) => cell.kind === "ruby")).toBe(true);
    expect(report?.cleared.every((cell) => !cell.flawed)).toBe(true);
    // Every cell is the R5 seed itself, so the whole set shatters at once.
    expect(report?.cleared.every((cell) => cell.wave === 0)).toBe(true);
    expect(report?.waves).toBe(0);
  });

  it("marks a flawed gem, so the heavier detonation is thrown for it", () => {
    const rows = quietRowsWith({
      "2,4": "R0",
      "3,4": "R0",
      "4,5": "R0",
      "4,4": "J0",
      "2,5": "J3",
    });
    const before = play(rows);
    const { swapped, resolved } = played(
      before,
      { col: 4, row: 5 },
      { col: 4, row: 4 },
    );
    const report = reportFor(swapped, resolved);
    // The flawed jade under the run is taken in by R6 and reads as flawed.
    const flawed = report?.cleared.find(
      (cell) => cell.col === 2 && cell.row === 5,
    );
    expect(flawed?.flawed).toBe(true);
    // R6 brought it in from the seed, so it shatters one wave after it.
    expect(flawed?.wave).toBe(1);
    expect(report?.waves).toBe(1);
  });

  it("reports the cut R8 created, at the cell the swap named", () => {
    const rows = quietRowsWith({
      "1,4": "R0",
      "2,4": "R0",
      "3,4": "R0",
      "4,5": "R0",
      "4,4": "J0",
    });
    const before = play(rows);
    const { swapped, resolved } = played(
      before,
      { col: 4, row: 5 },
      { col: 4, row: 4 },
    );
    expect(reportFor(swapped, resolved)?.created).toEqual([{ col: 4, row: 4 }]);
  });

  it("reads step 1 of a prism chain off the prism's own seed", () => {
    const rows = quietRowsWith({ "3,3": "X0", "4,3": "R0" });
    const before = play(rows);
    const { swapped, resolved } = played(
      before,
      { col: 3, row: 3 },
      { col: 4, row: 3 },
    );
    const report = reportFor(swapped, resolved);
    // The prism and every ruby on the board, and nothing created.
    expect(report?.created).toEqual([]);
    expect(report?.cleared.length).toBeGreaterThan(1);
    expect(
      report?.cleared.every(
        (cell) => cell.kind === "ruby" || cell.kind === null,
      ),
    ).toBe(true);
  });

  it("reads a step the cadence set off off the board as it stands", () => {
    const before = {
      ...play(NEAR_RUN),
      phase: "resolving" as const,
      chainStep: 1,
      stepTimer: 0,
    };
    // The board carries no run, so the cadence settles rather than stepping.
    const settled = tick(before, STEP_SECONDS).state;
    expect(reportFor(before, settled)).toBeNull();
  });
});

describe("the game the runtime drives", () => {
  it("registers every action and declares every cue in initialize", () => {
    const { registered, declared, state } = started();
    expect(registered).toContain("confirm");
    expect(registered).toContain("pause");
    expect(declared.sort()).toEqual(Object.values(CUES).slice().sort());
    expect(state.screen).toBe("title");
  });

  it("hands back a debug surface at the specified version", () => {
    expect(started().debug.version).toBe(1);
  });

  it("mirrors the pointer, the mute bit, and the clock every frame", () => {
    const { game, state } = started();
    const bench = harness();
    bench.movePointer({ x: 120, y: 240, down: true, device: "pen" });
    const next = game.update(state, bench.api, 0.5);
    expect(next.pointer).toEqual({
      x: 120,
      y: 240,
      down: true,
      device: "pen",
    });
    expect(next.muted).toBe(false);
    expect(next.simTime).toBeCloseTo(0.5, 9);
  });

  it("toggles the runtime's mute bit from any screen", () => {
    const { game, state } = started();
    const bench = harness();
    bench.press("mute");
    const next = game.update(state, bench.api, 1 / 60);
    expect(bench.isMuted()).toBe(true);
    expect(next.muted).toBe(true);
  });

  it("takes the highlighted title item on confirm", () => {
    const { game, state } = started();
    const bench = harness();
    bench.press("confirm");
    const next = game.update(state, bench.api, 1 / 60);
    expect(next.screen).toBe("playing");
    expect(next.board.cols).toBe(8);
  });

  it("raises the pause menu on the Escape both actions are bound to", () => {
    const { game } = started();
    const bench = harness();
    // Escape fires `pause` and `back` in the same frame, and the two act on
    // screens that do not overlap, so the board is paused and nothing else.
    bench.press("pause");
    bench.press("back");
    const playing = startRound(createInitialState());
    const paused = game.update(playing, bench.api, 1 / 60);
    expect(paused.screen).toBe("paused");

    const leaving = harness();
    leaving.press("pause");
    leaving.press("back");
    expect(game.update(paused, leaving.api, 1 / 60).screen).toBe("playing");
  });

  it("takes a menu item chosen in the same frame the highlight moved", () => {
    const { game, state } = started();
    const bench = harness();
    bench.press("down");
    bench.press("confirm");
    // The title menu is PLAY then HOW TO PLAY, so this reaches how-to.
    expect(game.update(state, bench.api, 1 / 60).screen).toBe("howto");
  });

  it("plays the cue for each event the frame raised, once", () => {
    const { game } = started();
    const bench = harness();
    const posed = play(NEAR_RUN);
    const [x, y] = cellCenter({ col: 4, row: 5 });
    const [bx, by] = cellCenter({ col: 4, row: 4 });
    bench.feed([
      sample("down", x, y, "touch"),
      sample("move", bx, by, "touch"),
      sample("up", bx, by, "touch"),
    ]);
    game.update(posed, bench.api, SWAP_SECONDS);
    const cues = bench.played.map(([cue]) => cue);
    expect(cues).toContain(CUES.select);
    expect(cues).toContain(CUES.swap);
    expect(cues).toContain(CUES.clear);
    expect(cues.filter((cue) => cue === CUES.clear)).toHaveLength(1);
  });

  it("sounds the clear cue at the rung step 1 stands on", () => {
    const { game } = started();
    const bench = harness();
    const posed = play(NEAR_RUN);
    const [x, y] = cellCenter({ col: 4, row: 5 });
    const [bx, by] = cellCenter({ col: 4, row: 4 });
    bench.feed([
      sample("down", x, y),
      sample("move", bx, by),
      sample("up", bx, by),
    ]);
    game.update(posed, bench.api, SWAP_SECONDS);
    expect(bench.played.find(([cue]) => cue === CUES.clear)).toEqual([
      CUES.clear,
      1,
    ]);
  });

  it("shows the effects of a step a pose resolved between two frames", async () => {
    // A validator poses a swap and then advances; the shatter and the burst
    // belong to the frame after it, not to the pose.
    const seen: number[] = [];
    const counting: ScratchCanvas = (width, height) => {
      seen.push(width);
      return createCanvas(width, height).getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D;
    };
    const game = createGame(counting);
    const assets = await loadedAssets();
    game.initialize({
      input: { register: () => {} },
      audio: { define: () => {} },
      diagnostics: { register: () => {} },
      assets,
      scratch: counting,
    });
    const bench = harness(assets);
    const posed = play(NEAR_RUN);
    game.update(posed, bench.api, 1 / 60);
    const swapped = requestSwap(posed, {
      a: { col: 4, row: 5 },
      b: { col: 4, row: 4 },
    }).state;
    expect(seen).toEqual([]);
    // The frame carries the swap through its travel and resolves step 1.
    game.update(swapped, bench.api, SWAP_SECONDS);
    // Three stones cleared, so three clear bursts were thrown.
    expect(seen).toEqual([96, 96, 96]);
  });

  it("plays no cue for a pose, only for a frame", () => {
    const { game, debug } = started();
    const bench = harness();
    const posed = debug.setScreen(
      debug.loadBoard(createInitialState(), NEAR_RUN),
      "playing",
    );
    const swapped = debug.requestSwap(posed, 4, 5, 4, 4);
    expect(swapped.phase).toBe("swapping");
    expect(bench.played).toEqual([]);
    // The frame after the pose plays nothing for what the pose did, though it
    // does sound the clear the step it carries through raises.
    game.update(swapped, bench.api, 1 / 60);
    expect(bench.played.map(([cue]) => cue)).not.toContain(CUES.swap);
  });

  it("reaches the same board from one long frame as from sixty short ones", () => {
    // The refill is posed on the one column the step empties, so the board the
    // two drives are compared over is the rules' alone.
    let posed = play(NEAR_RUN);
    for (const [col, kinds] of [
      [2, "M"],
      [3, "C"],
      [4, "J"],
    ] as const) {
      posed = setRefillKinds(posed, col, kinds);
    }
    const swapped = requestSwap(posed, {
      a: { col: 4, row: 5 },
      b: { col: 4, row: 4 },
    }).state;

    const one = createGame(scratch);
    const many = createGame(scratch);
    for (const game of [one, many]) {
      game.initialize({
        input: { register: () => {} },
        audio: { define: () => {} },
        diagnostics: { register: () => {} },
        assets: emptyAssets(),
        scratch,
      });
    }

    let long = swapped;
    const benchLong = harness();
    long = one.update(long, benchLong.api, 1);

    let short = swapped;
    const benchShort = harness();
    for (let frame = 0; frame < 60; frame += 1) {
      short = many.update(short, benchShort.api, 1 / 60);
    }

    expect(long.board).toEqual(short.board);
    expect(long.score).toBe(short.score);
    expect(long.phase).toBe(short.phase);
  });

  it("wraps the menu highlight with up and down", () => {
    const { game, state } = started();
    for (const [action, index] of [
      ["down", 1],
      ["up", 1],
    ] as const) {
      const bench = harness();
      bench.press(action);
      expect(game.update(state, bench.api, 1 / 60).menuIndex, action).toBe(
        index,
      );
    }
  });

  it("leaves how-to, the pause menu, and the end of a round on back", () => {
    const { game } = started();
    for (const screen of ["howto", "gameover"] as const) {
      const bench = harness();
      bench.press("back");
      const next = game.update(
        { ...startRound(createInitialState()), screen },
        bench.api,
        1 / 60,
      );
      expect(next.screen, screen).toBe("title");
    }
  });

  it("plays a move only on the release, and only with an offer standing", () => {
    const { game } = started();
    const posed = play(NEAR_RUN);
    const [x, y] = cellCenter({ col: 4, row: 5 });
    const [bx, by] = cellCenter({ col: 4, row: 4 });

    const held = harness();
    held.feed([sample("down", x, y), sample("move", bx, by)]);
    const holding = game.update(posed, held.api, 1 / 60);
    expect(holding.selection).toEqual({ col: 4, row: 5 });
    expect(holding.offer).toEqual({ col: 4, row: 4 });
    expect(holding.phase).toBe("idle");

    const let_go = harness();
    let_go.feed([sample("up", bx, by)]);
    const swapped = game.update(holding, let_go.api, 1 / 60);
    expect(swapped.phase).toBe("swapping");
    expect(swapped.selection).toBeNull();
    expect(swapped.offer).toBeNull();
  });

  it("carries a hold back where it started and plays nothing", () => {
    const { game } = started();
    const bench = harness();
    const posed = play(NEAR_RUN);
    const [x, y] = cellCenter({ col: 4, row: 5 });
    const [bx, by] = cellCenter({ col: 4, row: 4 });
    bench.feed([
      sample("down", x, y, "touch"),
      sample("move", bx, by, "touch"),
      sample("move", x, y, "touch"),
      sample("up", x, y, "touch"),
    ]);
    const next = game.update(posed, bench.api, 1 / 60);
    expect(next.phase).toBe("idle");
    expect(next.board).toBe(posed.board);
  });

  it("acts on the primary pointer alone", () => {
    const { game } = started();
    const bench = harness();
    const posed = play(NEAR_RUN);
    const [x, y] = cellCenter({ col: 4, row: 5 });
    bench.feed([sample("down", x, y, "touch", false)]);
    expect(game.update(posed, bench.api, 1 / 60).selection).toBeNull();
  });

  it("runs an absurdly long frame to its end rather than hanging on it", () => {
    const { game } = started();
    const bench = harness();
    const posed = play(NEAR_RUN);
    const swapped = requestSwap(posed, {
      a: { col: 4, row: 5 },
      b: { col: 4, row: 4 },
    }).state;
    const next = game.update(swapped, bench.api, 1000);
    expect(next.simTime).toBeCloseTo(1000, 3);
    expect(next.phase).toBe("idle");
  });

  it("draws whatever screen it is handed, through a real context", () => {
    const { game } = started();
    const ctx = createCanvas(1280, 720).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    const assets = emptyAssets();
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "levelclear",
      "gameover",
    ] as const) {
      const state = { ...startRound(createInitialState()), screen };
      expect(() => {
        game.render(state, { ctx, assets });
      }).not.toThrow();
    }
  });
});
