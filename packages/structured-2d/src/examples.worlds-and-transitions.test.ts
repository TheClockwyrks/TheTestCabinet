import { describe, expect, it } from "vitest";
import {
  Actor,
  ConstantClock,
  createEngine,
  GameInstance,
  GameMode,
  TextComponent,
} from "./index";
import type {
  ActionBinding,
  Engine,
  GameDefinition,
  InitApi,
  PlayerController,
  SurfaceMetrics,
} from "./index";

/**
 * The docs' *Worlds and Transitions* example, transcribed and driven.
 *
 * The sections below are the example page's files, verbatim: the constants,
 * the game definition, the instance with its module accessor, and the three
 * game modes. Only what a test environment forces is adapted, the way the
 * *Validating a Game* page adapts it: the canvas is a fake carrying a
 * recording-free 2D context, a `SurfaceMetrics` over a bare `EventTarget`
 * stands in for a document, and `engine.run()` becomes `engine.advance` under
 * a `ConstantClock` — one simulated second per frame, so the example's
 * 20-second match is twenty frames and the arithmetic the page narrates is
 * the arithmetic asserted.
 */

/* ------------------------------------------------------------------------- */
/* src/constants.ts                                                          */
/* ------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;
const BACKGROUND = "#0b0f16";
const TEXT = "#e6edf6";

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

/* ------------------------------------------------------------------------- */
/* src/instance.ts                                                           */
/* ------------------------------------------------------------------------- */

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

/* ------------------------------------------------------------------------- */
/* src/levels/menu-mode.ts                                                   */
/* ------------------------------------------------------------------------- */

class Prompt extends Actor {
  readonly label = this.attach(new TextComponent({ text: "", fill: TEXT }));
}

class MenuMode extends GameMode {
  override pawnClass = null;
  private player!: PlayerController;

  override beginPlay(): void {
    this.player = this.addPlayer({ name: "player" });
    this.world.spawn(Prompt, {
      transform: { x: WIDTH / 2, y: HEIGHT / 2 },
      configure: (prompt) => {
        prompt.label.text = `RELAY    best ${instance().bestScore}    ENTER`;
      },
    });
  }

  override tick(): void {
    if (this.player.input.pressed("confirm")) this.world.open(LEVELS.match);
  }
}

/* ------------------------------------------------------------------------- */
/* src/levels/match-mode.ts                                                  */
/* ------------------------------------------------------------------------- */

class Readout extends Actor {
  readonly label = this.attach(new TextComponent({ text: "", fill: TEXT }));
}

class MatchMode extends GameMode {
  override pawnClass = null;
  private player!: PlayerController;
  private readout!: Readout;

  override beginPlay(): void {
    this.player = this.addPlayer({ name: "player" });
    this.readout = this.world.spawn(Readout, {
      transform: { x: WIDTH / 2, y: HEIGHT / 2 },
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

/* ------------------------------------------------------------------------- */
/* src/levels/results-mode.ts                                                */
/* ------------------------------------------------------------------------- */

class Summary extends Actor {
  readonly label = this.attach(new TextComponent({ text: "", fill: TEXT }));
}

class ResultsMode extends GameMode {
  override pawnClass = null;

  override beginPlay(): void {
    const score = Number(this.options.score ?? 0);
    const game = instance();
    game.bestScore = Math.max(game.bestScore, score);
    this.setPhase("over");
    this.world.spawn(Summary, {
      transform: { x: WIDTH / 2, y: HEIGHT / 2 },
      configure: (summary) => {
        summary.label.text = `SCORED ${score}    BEST ${game.bestScore}`;
      },
    });
    this.world.after(RESULTS_SECONDS, () => {
      this.world.open(LEVELS.menu);
    });
  }
}

/* ------------------------------------------------------------------------- */
/* src/game.ts                                                               */
/* ------------------------------------------------------------------------- */

const relay: GameDefinition<null> = {
  instance: RelayInstance,
  levels: {
    [LEVELS.menu]: { mode: MenuMode },
    [LEVELS.match]: { mode: MatchMode },
    [LEVELS.results]: { mode: ResultsMode },
  },
  startLevel: LEVELS.menu,
};

/* ------------------------------------------------------------------------- */
/* src/main.ts, adapted to the test environment                              */
/* ------------------------------------------------------------------------- */

/** A canvas reduced to what the engine reads: a context, a size, a style. */
function fakeCanvas(): HTMLCanvasElement {
  const canvas: Record<string, unknown> = { width: 0, height: 0, style: {} };
  const ctx: Record<string, unknown> = {
    canvas,
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  };
  for (const name of [
    "setTransform",
    "translate",
    "scale",
    "rotate",
    "clearRect",
    "fillRect",
    "strokeRect",
    "beginPath",
    "closePath",
    "rect",
    "arc",
    "moveTo",
    "lineTo",
    "fill",
    "stroke",
    "fillText",
    "strokeText",
    "drawImage",
    "save",
    "restore",
  ]) {
    ctx[name] = (): void => {};
  }
  canvas["getContext"] = (kind: string): unknown =>
    kind === "2d" ? ctx : null;
  return canvas as unknown as HTMLCanvasElement;
}

/** The example's engine, plus the event target a player's keyboard would be. */
function boot(): { engine: Engine<null>; tap: (code: string) => void } {
  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => WIDTH,
    cssHeight: () => HEIGHT,
    dpr: () => 1,
    events: () => target,
  };
  // The `createEngine` call is main.ts's, verbatim; the clock and surface are
  // the scripted-clock testing pattern, and `run` is replaced by `advance`.
  const engine = createEngine({
    canvas: fakeCanvas(),
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

/* ------------------------------------------------------------------------- */
/* The outcomes the page narrates                                            */
/* ------------------------------------------------------------------------- */

describe("the worlds-and-transitions example", () => {
  it("opens the menu, which waits for a confirm", async () => {
    const { engine, tap } = boot();
    await engine.initialize();

    const menu = engine.world;
    expect(menu.level).toBe(LEVELS.menu);
    expect(menu.find(Prompt)?.label.text).toBe("RELAY    best 0    ENTER");

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

  it("scores taps against the match timer, counting match time", async () => {
    const { engine, tap } = boot();
    await engine.initialize();
    tap("Enter");
    await engine.advance(1);

    const match = engine.world;
    expect(match.level).toBe(LEVELS.match);
    expect(match.mode.phase).toBe("playing");

    // Each press arms one edge, so each tapped frame scores exactly once,
    // and `elapsed` counts the playing seconds the readout reports.
    const readout = match.find(Readout);
    for (let i = 0; i < 3; i += 1) {
      tap("Space");
      await engine.advance(1);
    }
    expect(readout?.label.text).toBe("3    17.0s");
    expect(match.state.elapsed).toBe(3);

    // Run the match out. The timer fires at twenty seconds, and the tick that
    // frame still finishes against a whole world: the readout it wrote shows
    // the score the transition carried, with no time left.
    await engine.advance(MATCH_SECONDS - 3);
    expect(readout?.label.text).toBe("3    0.0s");

    const results = engine.world;
    expect(results.level).toBe(LEVELS.results);
    expect(results.mode.options.score).toBe(3);
    expect(results.find(Summary)?.label.text).toBe("SCORED 3    BEST 3");
    expect(instance().bestScore).toBe(3);
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

    // Menu -> match: the frame counter and simulated time carry over the
    // transition, while `world.time` restarts at zero.
    tap("Enter");
    await engine.advance(1);
    const match = engine.world;
    expect(match.level).toBe(LEVELS.match);
    expect(engine.frame().count).toBe(1);
    expect(engine.frame().timeMs).toBe(1000);
    expect(match.time).toBe(0);

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

    // The one framework object that survives is the instance itself.
    expect(engine.instance).toBe(relayInstance);

    // The loop's counters never reset: every frame above is accounted for.
    expect(engine.frame().count).toBe(
      1 + MATCH_SECONDS + RESULTS_SECONDS + 1 + MATCH_SECONDS,
    );
    expect(engine.frame().timeMs).toBe(engine.frame().count * 1000);

    // The emitted travel, in the documented order, for every transition.
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
