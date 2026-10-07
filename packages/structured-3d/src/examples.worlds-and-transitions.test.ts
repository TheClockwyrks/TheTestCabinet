import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  Actor,
  Component,
  ConstantClock,
  createEngine,
  GameInstance,
  GameMode,
  MeshComponent,
  PlayerController,
  TextComponent,
} from "./index";
import type {
  ActionBinding,
  ActorSpec,
  EndPlayReason,
  Engine,
  GameDefinition,
  InitApi,
  Vec3,
  World,
} from "./index";
import { createStage } from "./testing/canvas";

/**
 * The docs' *Worlds and Transitions* example, transcribed and driven.
 *
 * The sections below are the example page's files, verbatim: the constants, the
 * instance with its module accessor, the three game modes, and the game
 * definition. Only what a test environment forces is adapted, the way the
 * *Validating a Game* page adapts it. That page's harness builds its engine over
 * two canvases it creates itself and a `SurfaceMetrics` reporting the size and
 * ratio it chose, and this suite does the same through `src/testing/canvas.ts`:
 * a stage canvas handing out the WebGL2 stub a real `THREE.WebGLRenderer`
 * constructs over, a screen canvas handing out a recording 2D context — which is
 * what a `TextComponent` is drawn through, and so is where the page's claim
 * about `CENTER` is readable — and a surface over an `EventTarget` a test
 * dispatches keys at. `engine.run()` becomes `engine.advance` under a
 * `ConstantClock` of one simulated second per frame, so the example's 20-second
 * match is twenty frames and the arithmetic the page narrates is the arithmetic
 * asserted.
 *
 * The surface reports a device pixel ratio of 2 over a 640 x 360 element, so the
 * fit scales logical units by two. That is deliberate: the page says a
 * `TextComponent` reads its actor's position as logical units from the top-left
 * of the design field, and a suite fitted one-to-one could not tell a logical
 * coordinate from a device one.
 *
 * The second suite below is the same game with recording layered onto it. The
 * page narrates a transition as twelve steps, but its own three levels declare
 * no `load` and no actors, its actors and controllers override no `endPlay`, and
 * none of its components are world-space, so steps 3 through 6 and 8 through 10
 * leave no trace in the code the page prints. The probes are the page's modes
 * subclassed to write into a log, the page's registry with a `load` and two
 * declared actors added to the results level, and one world-space mesh in the
 * match — the least instrumentation that makes the narrated order observable.
 */

/* ------------------------------------------------------------------------- */
/* src/constants.ts                                                          */
/* ------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;
const BACKGROUND = "#0b0f16";
const TEXT = "#e6edf6";

const CENTER = { x: WIDTH / 2, y: HEIGHT / 2, z: 0 };

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
      transform: { position: CENTER },
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
      transform: { position: CENTER },
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
      transform: { position: CENTER },
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

interface Booted {
  engine: Engine<null>;
  /** The screen layer's recorded operations, which is where text lands. */
  stage: ReturnType<typeof createStage>;
  /** Press and release a bound key between frames. */
  tap(code: string): void;
}

function boot(game: GameDefinition<null> = relay): Booted {
  const stage = createStage({ cssWidth: WIDTH, cssHeight: HEIGHT, dpr: 2 });
  // The `createEngine` call is main.ts's, with the canvas the page would have
  // queried supplied by the harness, and the two testing seams the validators
  // pages use: a scripted clock and a surface with no layout behind it.
  const engine = createEngine({
    canvas: stage.stage.canvas,
    screen: stage.screen.canvas,
    width: WIDTH,
    height: HEIGHT,
    background: BACKGROUND,
    game,
    clock: new ConstantClock(1000),
    surface: stage.surface.surface,
  });
  // A press-and-release between frames arms the action's edge for the next
  // frame; either bound key works, because the binding lists both.
  const tap = (code: string): void => {
    stage.surface.target.dispatchEvent(
      Object.assign(new Event("keydown"), { code, repeat: false }),
    );
    stage.surface.target.dispatchEvent(
      Object.assign(new Event("keyup"), { code }),
    );
  };
  return { engine, stage, tap };
}

/** The label a `fillText` drew, with the coordinates it was drawn at. */
function texts(
  stage: Booted["stage"],
): Array<{ text: string; x: number; y: number; transform: readonly number[] }> {
  return stage.screen.context2d.opsOf("fillText").map((op) => ({
    text: String(op.args[0]),
    x: Number(op.args[1]),
    y: Number(op.args[2]),
    transform: op.transform,
  }));
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

  it("draws the prompt at the middle of the design field, in logical units", async () => {
    const { engine, stage } = boot();
    await engine.initialize();
    stage.screen.context2d.forget();
    await engine.advance(1);

    // `CENTER` is a screen-space placement: the text is drawn at half the
    // design size on each axis, in logical units, under the viewport transform
    // the fit built — a scale of two, because the surface reports a ratio of
    // two over an element the size of the design field.
    expect(texts(stage)).toEqual([
      {
        text: "RELAY    best 0    ENTER",
        x: WIDTH / 2,
        y: HEIGHT / 2,
        transform: [2, 0, 0, 2, 0, 0],
      },
    ]);
    engine.destroy();
  });

  it("accumulates elapsed only while the phase is playing", async () => {
    const { engine, tap } = boot();
    await engine.initialize();

    // The menu sets no phase, so its mode holds `"waiting"` and its state's
    // match clock stands still while the world's own clock runs.
    const menu = engine.world;
    expect(menu.mode.phase).toBe("waiting");
    await engine.advance(3);
    expect(menu.time).toBe(3);
    expect(menu.state.elapsed).toBe(0);

    // The match sets `"playing"` as it begins, so the two run together and the
    // readout the page's tick writes counts match time.
    tap("Enter");
    await engine.advance(1);
    const match = engine.world;
    expect(match.mode.phase).toBe("playing");
    await engine.advance(5);
    expect(match.time).toBe(5);
    expect(match.state.elapsed).toBe(5);
    expect(match.find(Readout)?.label.text).toBe("0    15.0s");
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

  it("folds the score into the best before the world it opened is announced", async () => {
    const { engine, tap } = boot();
    const opening: Array<[string | null, string]> = [];
    const bestWhenOpened: Array<[string, number]> = [];
    engine.events.on("world:opening", ({ from, to }) =>
      opening.push([from, to]),
    );
    engine.events.on("world:opened", ({ level }) =>
      bestWhenOpened.push([level, instance().bestScore]),
    );

    await engine.initialize();
    tap("Enter");
    await engine.advance(1);
    tap("Space");
    await engine.advance(1);
    tap("Space");
    await engine.advance(MATCH_SECONDS - 1);

    expect(engine.world.level).toBe(LEVELS.results);
    // Step 1 of the sequence carries the outgoing level and the incoming one.
    expect(opening).toEqual([
      [null, LEVELS.menu],
      [LEVELS.menu, LEVELS.match],
      [LEVELS.match, LEVELS.results],
    ]);
    // Step 11 runs `ResultsMode.beginPlay` — which folds the score into the
    // best — and step 12 announces the world, so a subscriber to `world:opened`
    // already reads the folded figure.
    expect(bestWhenOpened).toEqual([
      [LEVELS.menu, 0],
      [LEVELS.match, 0],
      [LEVELS.results, 2],
    ]);
    engine.destroy();
  });

  it("rebuilds the world and its camera, and keeps the instance's diagnostic", async () => {
    const { engine, tap } = boot();
    await engine.initialize();

    tap("Enter");
    await engine.advance(1);
    const match = engine.world;
    expect(match.level).toBe(LEVELS.match);

    // The camera is part of the world. Move the match's, and the world that
    // replaces it starts with a camera of its own, at the defaults.
    match.camera.position = { x: 4, y: 5, z: 6 };
    match.camera.fov = 30;
    expect(match.state.players).toHaveLength(1);

    await engine.advance(MATCH_SECONDS);
    const results = engine.world;
    expect(results.level).toBe(LEVELS.results);
    expect(results.camera).not.toBe(match.camera);
    expect(results.camera.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(results.camera.fov).toBe(60);

    // `world.time` restarts at zero, and the player states are rebuilt with the
    // world: the results mode adds none.
    expect(results.time).toBe(0);
    expect(results.state).not.toBe(match.state);
    expect(results.state.players).toHaveLength(0);

    // The instance's diagnostic source was registered through `InitApi` and
    // outlives every transition, reporting the best score the instance holds.
    expect(engine.diagnostics()).toEqual([{ name: "best", value: 0 }]);
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

    // The menu is where the relay rests: the results world's timer left with
    // it, so no further frame moves the game on its own.
    await engine.advance(RESULTS_SECONDS * 2);
    expect(engine.world).toBe(menu);

    // A second match: the action bindings registered from `InitApi` and the
    // subscriptions on `engine.events` survived, while the player states were
    // rebuilt — an untapped match scores zero, and the best stands.
    tap("Enter");
    await engine.advance(1);
    expect(engine.world.level).toBe(LEVELS.match);
    await engine.advance(MATCH_SECONDS);
    expect(engine.world.find(Summary)?.label.text).toBe("SCORED 0    BEST 1");
    expect(instance().bestScore).toBe(1);
    expect(engine.diagnostics()).toEqual([{ name: "best", value: 1 }]);

    // The one framework object that survives is the instance itself.
    expect(engine.instance).toBe(relayInstance);

    // The loop's counters never reset: every frame above is accounted for.
    expect(engine.frame().count).toBe(
      1 +
        MATCH_SECONDS +
        RESULTS_SECONDS +
        RESULTS_SECONDS * 2 +
        1 +
        MATCH_SECONDS,
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

/* ------------------------------------------------------------------------- */
/* Probes over the page's game                                               */
/* ------------------------------------------------------------------------- */

/**
 * Every probe writes one line here, and so do the transition events, so a test
 * asserts the whole sequence as an ordered array rather than as a scatter of
 * booleans. Cleared at the top of the frame under examination.
 */
const log: string[] = [];

/** The registered diagnostic sources right now, as a stamp for the log. */
function sources(): string {
  return instance()
    .engine.diagnostics()
    .map((reading) => reading.name)
    .join("+");
}

/** Step 5's first half: a component's `endPlay` runs before its actor's. */
class Mark extends Component {
  override endPlay(reason: EndPlayReason): void {
    log.push(`component of ${(this.actor as Marker).name} ${reason}`);
  }
}

/** An actor that records both ends of its play, and what it found at the near end. */
class Marker extends Actor {
  name = "";
  readonly mark = this.attach(new Mark());

  override beginPlay(): void {
    // Step 9 built the mode with the transition's options and the game state
    // before any declared actor began play, and step 10 says every declared
    // actor already exists when the first of their `beginPlay` runs.
    const score = this.world.mode.options["score"] ?? "none";
    log.push(
      `actor ${this.name} beginPlay actors=${this.world.actors().length} score=${String(score)}`,
    );
  }

  override endPlay(reason: EndPlayReason): void {
    log.push(`actor ${this.name} ${reason}`);
  }
}

/** Step 4: controllers end play in reverse order of addition. */
class LoggingController extends PlayerController {
  override endPlay(reason: EndPlayReason): void {
    log.push(
      `controller ${this.playerState.name} ${reason} diagnostics=${sources()}`,
    );
  }
}

/** The one world-space component in the game, so the scene has something to hold. */
class Prop extends Actor {
  readonly mesh = this.attach(
    new MeshComponent({
      geometry: { kind: "box", width: 1, height: 1, depth: 1 },
      material: { color: "#c14b3a" },
    }),
  );
}

/** Steps 2 and 12: the instance's two hooks, on either side of a transition. */
class ProbeInstance extends RelayInstance {
  override worldClosing(world: World): void {
    log.push(`instance.worldClosing ${world.level} diagnostics=${sources()}`);
  }

  override worldOpened(world: World): void {
    log.push(`instance.worldOpened ${world.level} best=${this.bestScore}`);
  }
}

/**
 * The page's match, plus what the page's own match has no reason to carry: a
 * second controller, two marked actors, a world diagnostic source, a repeating
 * world timer, and a mesh. Everything the page's `MatchMode` does is still done,
 * by `super`.
 */
class ProbeMatchMode extends MatchMode {
  override playerControllerClass = LoggingController;
  beats = 0;

  override beginPlay(): void {
    super.beginPlay();
    this.addPlayer({ name: "second" });
    this.world.spawn(Marker, {
      configure: (marker) => {
        marker.name = "match-a";
      },
    });
    this.world.spawn(Marker, {
      configure: (marker) => {
        marker.name = "match-b";
      },
    });
    this.world.spawn(Prop, { transform: { position: { x: 1, y: 2, z: 3 } } });
    this.world.diagnostics.register("ticks", () => this.beats);
    this.world.every(1, () => {
      this.beats += 1;
    });
  }

  override endPlay(reason: EndPlayReason): void {
    log.push(`mode ${this.world.level} ${reason}`);
  }
}

/** Step 11, which the page says runs before the world is announced. */
class ProbeResultsMode extends ResultsMode {
  override beginPlay(): void {
    log.push("mode results beginPlay");
    super.beginPlay();
  }
}

const probeRelay: GameDefinition<null> = {
  instance: ProbeInstance,
  levels: {
    [LEVELS.menu]: { mode: MenuMode },
    [LEVELS.match]: { mode: ProbeMatchMode },
    [LEVELS.results]: {
      mode: ProbeResultsMode,
      // Step 8, and step 9's ordering: two actors the level declares, spawned
      // in the order given, before the mode begins play.
      actors: [
        {
          type: Marker,
          configure: (marker: Marker): void => {
            marker.name = "declared-first";
          },
        },
        {
          type: Marker,
          configure: (marker: Marker): void => {
            marker.name = "declared-second";
          },
        },
      ] satisfies readonly ActorSpec<Marker>[],
      load: () => {
        log.push("load results");
      },
    },
  },
  startLevel: LEVELS.menu,
};

/** A menu that changes its mind inside one tick, which the page says is allowed. */
class IndecisiveMode extends GameMode {
  override pawnClass = null;
  private player!: PlayerController;

  override beginPlay(): void {
    this.player = this.addPlayer({ name: "player" });
  }

  override tick(): void {
    if (!this.player.input.pressed("confirm")) return;
    this.world.open(LEVELS.match);
    this.world.open(LEVELS.results, { score: 7 });
  }
}

const indecisiveRelay: GameDefinition<null> = {
  instance: RelayInstance,
  levels: {
    [LEVELS.menu]: { mode: IndecisiveMode },
    [LEVELS.match]: { mode: MatchMode },
    [LEVELS.results]: { mode: ResultsMode },
  },
  startLevel: LEVELS.menu,
};

/** The page's game with a gate wedged into the results level's `load`. */
function gatedRelay(gate: Promise<void>): GameDefinition<null> {
  return {
    instance: RelayInstance,
    levels: {
      [LEVELS.menu]: { mode: MenuMode },
      [LEVELS.match]: { mode: MatchMode },
      [LEVELS.results]: { mode: ResultsMode, load: () => gate },
    },
    startLevel: LEVELS.menu,
  };
}

/** Let every queued microtask and one macrotask turn run. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** The `meshesAt` helper the *Validating a Game* pages print, verbatim. */
function meshesAt(
  scene: THREE.Scene,
  point: Vec3,
  tolerance = 1e-3,
): THREE.Mesh[] {
  const target = new THREE.Vector3(point.x, point.y, point.z);
  const position = new THREE.Vector3();
  const found: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.getWorldPosition(position).distanceTo(target) <= tolerance) {
      found.push(object);
    }
  });
  return found;
}

/** Drive the probe game to the frame on which the match's timer fires. */
async function toTheCrossingFrame(
  engine: Engine<null>,
  tap: (code: string) => void,
  taps: number,
): Promise<void> {
  tap("Enter");
  await engine.advance(1);
  for (let i = 0; i < taps; i += 1) {
    tap("Space");
    await engine.advance(1);
  }
  log.length = 0;
  await engine.advance(MATCH_SECONDS - taps);
}

/* ------------------------------------------------------------------------- */
/* The twelve steps the page numbers                                         */
/* ------------------------------------------------------------------------- */

describe("the transition the worlds-and-transitions page numbers", () => {
  it("runs the twelve steps in the documented order", async () => {
    log.length = 0;
    const { engine, tap } = boot(probeRelay);
    engine.events.on("world:opening", ({ from, to }) =>
      log.push(`opening ${String(from)}->${to}`),
    );
    engine.events.on("world:closed", ({ level }) =>
      log.push(`closed ${level}`),
    );
    engine.events.on("world:opened", ({ level }) =>
      log.push(`opened ${level}`),
    );

    await engine.initialize();
    await toTheCrossingFrame(engine, tap, 2);

    expect(engine.world.level).toBe(LEVELS.results);
    expect(log).toEqual([
      // 1. The announcement, carrying the outgoing level and the incoming one.
      "opening match->results",
      // 2. The instance reads the outgoing world, whose diagnostic source is
      //    still registered.
      "instance.worldClosing match diagnostics=best+ticks",
      // 3. The world's timers and diagnostic sources are dropped, which the
      //    stamp on the very next line reports: only the instance's is left.
      // 4. Controllers, in reverse order of addition.
      "controller second level-closed diagnostics=best",
      "controller player level-closed diagnostics=best",
      // 5. Each actor's components, then the actor, in reverse spawn order.
      //    The page's own `Readout` is the first-spawned and overrides nothing,
      //    so it ends play last and silently.
      "component of match-b level-closed",
      "actor match-b level-closed",
      "component of match-a level-closed",
      "actor match-a level-closed",
      // 6. The mode, after every actor.
      "mode match level-closed",
      // 7. The close is announced.
      "closed match",
      // 8. The incoming level's `load`, awaited before anything is built.
      "load results",
      // 9 and 10. The mode holds the transition's options and the state is
      //    built before either declared actor begins play, and both actors
      //    exist before the first of them does.
      "actor declared-first beginPlay actors=2 score=2",
      "actor declared-second beginPlay actors=2 score=2",
      // 11. The mode begins play, folding the score into the best.
      "mode results beginPlay",
      // 12. The world is announced, and then the instance seeds it — by which
      //     point the fold of step 11 is already readable.
      "opened results",
      "instance.worldOpened results best=2",
    ]);
    engine.destroy();
  });

  it("clears the closing world's timers and drops its diagnostic sources", async () => {
    const { engine, tap } = boot(probeRelay);
    await engine.initialize();
    tap("Enter");
    await engine.advance(1);

    // The match's own repeating timer and its own diagnostic source, both live.
    const match = engine.world.mode as ProbeMatchMode;
    await engine.advance(3);
    expect(match.beats).toBe(3);
    expect(engine.diagnostics()).toEqual([
      { name: "best", value: 0 },
      { name: "ticks", value: 3 },
    ]);

    await engine.advance(MATCH_SECONDS - 3);
    expect(engine.world.level).toBe(LEVELS.results);

    // Step 3: the world's timers went with it, and so did its source. The
    // instance's source, registered from `InitApi`, did not.
    expect(match.beats).toBe(MATCH_SECONDS);
    expect(engine.diagnostics()).toEqual([{ name: "best", value: 0 }]);
    await engine.advance(3);
    expect(match.beats).toBe(MATCH_SECONDS);
    engine.destroy();
  });

  it("empties the scene of the closing world's objects and fills it from the next", async () => {
    const { engine, tap } = boot(probeRelay);
    await engine.initialize();

    // Every actor of the page's own game carries a `TextComponent`, which the
    // screen pass draws, so the scene the pipeline maintains starts empty.
    expect(engine.scene.children).toHaveLength(0);

    tap("Enter");
    await engine.advance(1);
    const prop = engine.world.find(Prop);
    expect(prop).not.toBeNull();
    const at = prop?.transform.position ?? { x: 0, y: 0, z: 0 };
    expect(meshesAt(engine.scene, at)).toHaveLength(1);

    // The results world declares no world-space component, so the scene the
    // frame after the transition holds nothing the match put there.
    await engine.advance(MATCH_SECONDS);
    expect(engine.world.level).toBe(LEVELS.results);
    expect(meshesAt(engine.scene, at)).toHaveLength(0);
    expect(engine.scene.children).toHaveLength(0);
    engine.destroy();
  });

  it("honors one request per frame, the second replacing the first", async () => {
    const { engine, tap } = boot(indecisiveRelay);
    const opened: string[] = [];
    engine.events.on("world:opened", ({ level }) => opened.push(level));

    await engine.initialize();
    tap("Enter");
    await engine.advance(1);

    // Both calls landed in one tick. The `match` the first named was never
    // built; the `results` the second named was, with the second's options.
    expect(opened).toEqual([LEVELS.menu, LEVELS.results]);
    expect(engine.world.level).toBe(LEVELS.results);
    expect(engine.world.mode.options["score"]).toBe(7);
    expect(instance().bestScore).toBe(7);
    engine.destroy();
  });

  it("runs no frame while a level's load is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { engine, tap } = boot(gatedRelay(gate));
    await engine.initialize();
    tap("Enter");
    await engine.advance(1);

    // Twenty-three frames asked for, and the twenty-first is the one whose
    // timer requests the results level. The transition is asynchronous because
    // the level's `load` is, so the loop parks there.
    const stepping = engine.advance(MATCH_SECONDS + 3);
    await settle();
    expect(engine.frame().count).toBe(1 + MATCH_SECONDS);
    expect(engine.world.level).toBe(LEVELS.match);
    await settle();
    expect(engine.frame().count).toBe(1 + MATCH_SECONDS);

    // Released, the transition completes and the frames after it run.
    release();
    await stepping;
    expect(engine.world.level).toBe(LEVELS.results);
    expect(engine.frame().count).toBe(1 + MATCH_SECONDS + 3);
    expect(engine.world.time).toBe(3);
    engine.destroy();
  });
});
