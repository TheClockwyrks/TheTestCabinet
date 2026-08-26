import { createCanvas } from "@test-cabinet/headless-webgl2";
import { describe, expect, it } from "vitest";
import { Actor } from "./actors";
import type { SurfaceMetrics } from "./camera";
import { ConstantClock } from "./clocks";
import { ShapeComponent, TextComponent } from "./components";
import type { DrawOp, Recording } from "./contract";
import type { PlayerController } from "./controllers";
import { createEngine, type Engine } from "./engine";
import {
  GameInstance,
  type GameDefinition,
  type InitApi,
} from "./game-instance";
import { GameMode } from "./game-mode";
import type { ActionBinding } from "./input";
import { quatFromAxisAngle, quatMultiply } from "./math";

/**
 * The documentation's worked example "Worlds and Transitions", transcribed and
 * run. The sections below are the page's own modules, verbatim: the constants,
 * the game definition, the instance with its module accessor, and the three
 * game modes. Only what a test environment forces is adapted:
 *
 * - The page's boot module finds a canvas in a document; here
 *   `@test-cabinet/headless-webgl2` makes one in process and a
 *   `SurfaceMetrics` over a bare `EventTarget` reports its size and carries
 *   the key events a player's keyboard would deliver. The element is smaller
 *   than the design field, which the WebGL2 implementation being a software
 *   rasterizer forces and which nothing the page states depends on.
 * - `engine.run()` becomes `engine.advance` under a `ConstantClock` of one
 *   simulated second per frame, so the page's twenty-second match is twenty
 *   frames and the arithmetic the page narrates is the arithmetic asserted.
 *
 * The assertions are the page's own narration: the transition it lists step by
 * step, the table of what survives it and what is rebuilt, the whole-field
 * rule a partial spawn transform follows, `elapsed` counting match time alone,
 * and the billboard a `TextComponent` draws with its font size read as world
 * units of text height.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — transcribed verbatim                                    */
/* -------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;
const BACKGROUND = "#0b0f16";
const TEXT = "#e6edf6";
const FONT = "1px sans-serif";

const LEVELS = {
  menu: "menu",
  match: "match",
  results: "results",
} as const;

const ACTIONS: Record<string, ActionBinding> = {
  confirm: { keys: ["Enter", "Space"] },
};

const MATCH_SECONDS = 20;
const RESULTS_SECONDS = 4;

/* -------------------------------------------------------------------------- */
/* src/instance.ts — transcribed verbatim                                     */
/* -------------------------------------------------------------------------- */

let built: RelayInstance | null = null;

function instance(): RelayInstance {
  if (built === null) throw new Error("the game instance is not built yet");
  return built;
}

class RelayInstance extends GameInstance<null> {
  bestScore = 0;

  override initialize(api: InitApi): null {
    built = this;
    for (const [name, binding] of Object.entries(ACTIONS)) {
      api.input.register(name, binding);
    }
    api.diagnostics.register("best", () => this.bestScore);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/menu-mode.ts — transcribed verbatim                             */
/* -------------------------------------------------------------------------- */

class Prompt extends Actor {
  readonly label = this.attach(
    new TextComponent({ text: "", font: FONT, fill: TEXT }),
  );
}

class MenuMode extends GameMode {
  override pawnClass = null;
  private player!: PlayerController;

  override beginPlay(): void {
    this.player = this.addPlayer({ name: "player" });
    this.world.spawn(Prompt, {
      configure: (prompt) => {
        prompt.label.text = `RELAY    best ${instance().bestScore}    ENTER`;
      },
    });
  }

  override tick(): void {
    if (this.player.input.pressed("confirm")) this.world.open(LEVELS.match);
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/match-mode.ts — transcribed verbatim                            */
/* -------------------------------------------------------------------------- */

const UP = { x: 0, y: 1, z: 0 };

class Spinner extends Actor {
  readonly body = this.attach(
    new ShapeComponent({
      shape: { kind: "box", size: { x: 1, y: 1, z: 1 } },
      color: "#7fd1ff",
    }),
  );

  override tick(dt: number): void {
    this.transform.rotation = quatMultiply(
      quatFromAxisAngle(UP, Math.PI * dt),
      this.transform.rotation,
    );
  }
}

class Readout extends Actor {
  readonly label = this.attach(
    new TextComponent({ text: "", font: FONT, fill: TEXT }),
  );
}

class MatchMode extends GameMode {
  override pawnClass = null;
  private player!: PlayerController;
  private readout!: Readout;

  override beginPlay(): void {
    this.player = this.addPlayer({ name: "player" });
    this.readout = this.world.spawn(Readout, {
      transform: { position: { x: 0, y: 1.5, z: 0 } },
    });
    this.world.spawn(Spinner, {
      transform: { position: { x: 0, y: -1, z: 0 } },
    });
    this.setPhase("playing");
    this.world.after(MATCH_SECONDS, () => this.finish());
  }

  override tick(): void {
    const player = this.player.playerState;
    if (this.player.input.pressed("confirm")) player.score += 1;
    const left = Math.max(MATCH_SECONDS - this.state.elapsed, 0);
    this.readout.label.text = `${player.score}    ${left.toFixed(1)}s`;
  }

  private finish(): void {
    this.setPhase("over");
    this.world.open(LEVELS.results, { score: this.player.playerState.score });
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/results-mode.ts — transcribed verbatim                          */
/* -------------------------------------------------------------------------- */

class Summary extends Actor {
  readonly label = this.attach(
    new TextComponent({ text: "", font: FONT, fill: TEXT }),
  );
}

class ResultsMode extends GameMode {
  override pawnClass = null;

  override beginPlay(): void {
    const score = Number(this.options.score ?? 0);
    const game = instance();
    game.bestScore = Math.max(game.bestScore, score);
    this.setPhase("over");
    this.world.spawn(Summary, {
      configure: (summary) => {
        summary.label.text = `SCORED ${score}    BEST ${game.bestScore}`;
      },
    });
    this.world.after(RESULTS_SECONDS, () => {
      this.world.open(LEVELS.menu);
    });
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const relay: GameDefinition<null> = {
  instance: RelayInstance,
  levels: {
    [LEVELS.menu]: { mode: MenuMode },
    [LEVELS.match]: { mode: MatchMode },
    [LEVELS.results]: { mode: ResultsMode },
  },
  startLevel: LEVELS.menu,
};

/* -------------------------------------------------------------------------- */
/* src/main.ts — transcribed, with the forced adaptations                     */
/* -------------------------------------------------------------------------- */

/** The size the page's canvas element is reported at; see the header. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

function boot(): { engine: Engine<null>; tap: (code: string) => void } {
  const canvas = createCanvas(
    CSS_WIDTH,
    CSS_HEIGHT,
  ) as unknown as HTMLCanvasElement;
  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => CSS_WIDTH,
    cssHeight: () => CSS_HEIGHT,
    dpr: () => 1,
    events: () => target,
  };
  const engine = createEngine<null>({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    background: BACKGROUND,
    game: relay,
    clock: new ConstantClock(1000),
    surface,
  });
  // A press-and-release between frames arms the action's edge for the next
  // frame; either bound key works, because the binding lists both.
  const tap = (code: string): void => {
    target.dispatchEvent(
      Object.assign(new Event("keydown"), { code, repeat: false }),
    );
    target.dispatchEvent(Object.assign(new Event("keyup"), { code }));
  };
  return { engine, tap };
}

/** The calls one recorded frame issued, resolved out of the shared table. */
function frameCalls(
  recording: Recording,
  index: number,
): Extract<DrawOp, { op: "call" }>[] {
  const frame = recording.frames[index];
  if (frame === undefined) throw new Error(`no frame ${index}`);
  return frame.ops
    .map((op) => recording.ops[op])
    .filter((op): op is Extract<DrawOp, { op: "call" }> => op?.op === "call");
}

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

describe("examples/worlds-and-transitions", () => {
  it("opens the menu, whose controller possesses nothing, and waits", async () => {
    const { engine, tap } = boot();
    await engine.initialize();

    // "the menu's controller possesses nothing, so `pawnClass` is `null` and
    // `addPlayer` builds a player state and a controller alone".
    const menu = engine.world;
    expect(menu.level).toBe(LEVELS.menu);
    expect(menu.players()).toHaveLength(1);
    expect(menu.players()[0]?.pawn).toBeNull();
    expect(menu.state.players).toHaveLength(1);
    expect(menu.find(Prompt)?.label.text).toBe("RELAY    best 0    ENTER");

    // "The prompt's spawn names no transform, so it sits at the identity, at
    // the origin the default camera at `(0, 0, 10)` faces."
    expect(menu.find(Prompt)?.transform.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(menu.camera.position).toEqual({ x: 0, y: 0, z: 10 });

    // The menu waits: frames without input leave it open.
    await engine.advance(3);
    expect(engine.world).toBe(menu);

    // A confirm requests the match; the request is honored at the end of the
    // frame that made it, so one advance crosses.
    tap("Enter");
    await engine.advance(1);
    expect(engine.world.level).toBe(LEVELS.match);
    expect(engine.world).not.toBe(menu);
    engine.destroy();
  });

  it("supplies all three numbers of a field a spawn spec names", async () => {
    const { engine, tap } = boot();
    await engine.initialize();
    tap("Enter");
    await engine.advance(1);

    // "Each spawn spec names only `position`, and a present field replaces the
    // whole value, so the spec supplies all three of its numbers while the
    // absent `rotation` and `scale` stay the identity's."
    const readout = engine.world.find(Readout);
    expect(readout?.transform.position).toEqual({ x: 0, y: 1.5, z: 0 });
    expect(readout?.transform.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(readout?.transform.scale).toEqual({ x: 1, y: 1, z: 1 });

    const spinner = engine.world.find(Spinner);
    expect(spinner?.transform.position).toEqual({ x: 0, y: -1, z: 0 });
    expect(spinner?.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
    engine.destroy();
  });

  it("scores taps against the match timer, counting match time alone", async () => {
    const { engine, tap } = boot();
    await engine.initialize();
    tap("Enter");
    await engine.advance(1);

    const match = engine.world;
    expect(match.level).toBe(LEVELS.match);
    expect(match.mode.phase).toBe("playing");

    // "`elapsed` accumulates only while the phase is `"playing"`, so the
    // readout counts match time rather than world time." Each press arms one
    // edge, so each tapped frame scores exactly once.
    const readout = match.find(Readout);
    for (let i = 0; i < 3; i += 1) {
      tap("Space");
      await engine.advance(1);
    }
    expect(readout?.label.text).toBe("3    17.0s");
    expect(match.state.elapsed).toBe(3);
    expect(match.time).toBe(3);

    // Run the match out. The timer fires at twenty seconds, and the tick that
    // frame still finishes against a whole world: the readout it wrote shows
    // the score the transition carried, with no time left.
    await engine.advance(MATCH_SECONDS - 3);
    expect(readout?.label.text).toBe("3    0.0s");

    const results = engine.world;
    expect(results.level).toBe(LEVELS.results);
    expect(results.mode.options.score).toBe(3);
    expect(results.mode.phase).toBe("over");
    expect(results.find(Summary)?.label.text).toBe("SCORED 3    BEST 3");
    expect(instance().bestScore).toBe(3);
    engine.destroy();
  });

  it("draws each label as a billboard sized in world units of text height", async () => {
    const { engine } = boot();
    await engine.initialize();

    // "`FONT`'s size is read in world units of text height, so one unit of
    // text stands one world unit tall however the canvas is sized", and a
    // `TextComponent` "draws as a billboard, always facing the camera".
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    const label = engine.world.find(Prompt)?.label.text ?? "";
    const billboards = frameCalls(recording, 0).filter(
      (call) => call.method === "drawBillboard",
    );
    expect(billboards).toHaveLength(1);
    expect(billboards[0].args[1]).toEqual({ x: 0, y: 0, z: 0 });
    expect(billboards[0].args[2]).toEqual({ x: label.length / 2, y: 1 });

    // The lettering travels as pixels the engine rasterized, keyed by the
    // string it drew.
    const asset =
      recording.assets[(billboards[0].args[0] as { $asset: number }).$asset];
    expect(asset?.kind).toBe("texture");
    expect(asset?.path).toBe(`text:${label}`);
    engine.destroy();
  });

  it("runs the whole relay, the best score alone crossing every transition", async () => {
    const { engine, tap } = boot();
    const seen: string[] = [];
    engine.events.on("world:opening", ({ from, to }) =>
      seen.push(`${from}->${to}`),
    );
    engine.events.on("world:closed", ({ level }) =>
      seen.push(`closed:${level}`),
    );
    engine.events.on("world:opened", ({ level }) =>
      seen.push(`opened:${level}`),
    );

    await engine.initialize();
    const relayInstance = engine.instance;
    expect(instance()).toBe(relayInstance);

    // Menu -> match. From the page's table of what crossed: the frame counter
    // and accumulated simulated time carry over, `world.time` restarts at
    // zero, and the world's camera is rebuilt at its defaults.
    tap("Enter");
    await engine.advance(1);
    const match = engine.world;
    expect(match.level).toBe(LEVELS.match);
    expect(engine.frame().count).toBe(1);
    expect(engine.frame().timeMs).toBe(1000);
    expect(match.time).toBe(0);
    expect(match.camera.position).toEqual({ x: 0, y: 0, z: 10 });

    // One scored tap, then the match runs out at twenty seconds.
    tap("Space");
    await engine.advance(1);
    await engine.advance(MATCH_SECONDS - 1);
    const results = engine.world;
    expect(results.level).toBe(LEVELS.results);
    expect(results.find(Summary)?.label.text).toBe("SCORED 1    BEST 1");

    // Results -> menu after the interlude, best in hand on the instance.
    await engine.advance(RESULTS_SECONDS);
    const menu = engine.world;
    expect(menu.level).toBe(LEVELS.menu);
    expect(menu.find(Prompt)?.label.text).toBe("RELAY    best 1    ENTER");

    // A second match: the action bindings registered from `InitApi` and the
    // subscriptions on `engine.events` survived, while the player states were
    // rebuilt — an untapped match scores zero, and the best stands.
    tap("Enter");
    await engine.advance(1);
    expect(engine.world.level).toBe(LEVELS.match);
    await engine.advance(MATCH_SECONDS);
    expect(engine.world.find(Summary)?.label.text).toBe("SCORED 0    BEST 1");
    expect(instance().bestScore).toBe(1);

    // "A figure that must outlive a transition is written onto the instance",
    // and the instance is the one framework object that survives.
    expect(engine.instance).toBe(relayInstance);

    // The loop's counters never reset: every frame above is accounted for.
    expect(engine.frame().count).toBe(
      1 + MATCH_SECONDS + RESULTS_SECONDS + 1 + MATCH_SECONDS,
    );
    expect(engine.frame().timeMs).toBe(engine.frame().count * 1000);

    // The emitted travel, in the documented order, for every transition:
    // `world:opening` opens each one and `world:opened` closes it, with the
    // outgoing world's `world:closed` between.
    expect(seen).toEqual([
      "null->menu",
      "opened:menu",
      "menu->match",
      "closed:menu",
      "opened:match",
      "match->results",
      "closed:match",
      "opened:results",
      "results->menu",
      "closed:results",
      "opened:menu",
      "menu->match",
      "closed:menu",
      "opened:match",
      "match->results",
      "closed:match",
      "opened:results",
    ]);
    engine.destroy();
  });
});
