import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor as ActorType, Pawn as PawnType } from "./actors";
import { Actor, Pawn } from "./actors";
import { ConstantClock } from "./clocks";
import { ColliderComponent } from "./collision";
import {
  LightComponent,
  MeshComponent,
  ShapeComponent,
  TextComponent,
} from "./components";
import type {
  Clock,
  EndPlayReason,
  Manifold,
  Recording,
  SurfaceMetrics,
  Vec2,
  Vec3,
  Viewport,
} from "./contract";
import { PlayerController } from "./controllers";
import type { Engine } from "./engine";
import { createEngine } from "./engine";
import type { GameDefinition, InitApi } from "./game-instance";
import { GameInstance } from "./game-instance";
import { GameMode } from "./game-mode";
import { add, quatLookAt, scale, vec3 } from "./math";
import type {
  Context2dStub,
  InstalledContexts,
  RecordedOp,
} from "./testing/canvas";
import { installCanvasContexts } from "./testing/canvas";
import type { InstalledCodecs } from "./testing/codecs";
import { installCodecs } from "./testing/codecs";
import type { GlStub } from "./testing/gl";
import type { ActorSpec, World } from "./worlds";

/**
 * The "Validating a Game" worked example, transcribed from
 * `apps/docs/src/content/docs/engines/structured-3d/examples/validating-a-game.md`
 * and run.
 *
 * The page is a case's whole validation surface: the case's constants, the
 * four-operation debug surface its instrumentation spec fixes, the build's game
 * definition, one harness, and six validator suites over it. The page promises
 * that code works against the engine as written, so all of it is carried here as
 * literally as one test module allows, and the assertions are the page's own —
 * the arithmetic each figure follows from and the object each claim is about,
 * not merely that nothing threw.
 *
 * What the page fixes is the **case**: the table of figures, the level and tag
 * vocabulary, the actions and their keys, the cues, the camera's pose, the HUD's
 * place, and the module the build exports its game from. What it leaves to the
 * model under test is the **build** — the actors, the controller, the two game
 * modes. A reference build of that case is written below, from the table and
 * from the narration around each check.
 *
 * Adaptations, every one of them forced by the environment rather than chosen:
 *
 * - The page's suites run in a browser page through vitest's Playwright provider
 *   on headless Chromium, where the world pass rasterizes in software and
 *   `getImageData` reads real bytes. This suite runs under jsdom, which gives a
 *   document and events but neither a GPU nor a 2D rasterizer, so the two pixel
 *   readings are reconstructed rather than read: `harness.pixel` composes the
 *   screen layer's recorded fills at one device pixel, and `harness.picture`
 *   answers a letterbox sample from the clear the frame issued and refuses a
 *   sample inside the picture, which the GPU drew and nothing here can read
 *   back. Each is documented where it is defined.
 * - Because of that, the page's third rendering check — "renders the runner
 *   where the camera projects it", which samples the stage at the point the
 *   camera projects the runner to and reads the runner's own colour back under
 *   `unlit` — is asserted one step earlier in the pipeline: the material the
 *   runner's mesh was *drawn through*, read off `onBeforeRender`. Under `shaded`
 *   that is the declared material; under `unlit` it is a `MeshBasicMaterial`
 *   carrying the case's colour at full opacity with the lights ignored, which is
 *   the claim the page's pixel makes. The letterbox half of the check is kept as
 *   the page writes it.
 * - jsdom has no WebCodecs, so `installCodecs` stands in the `VideoEncoder` and
 *   `VideoFrame` the recorder needs. What that costs is the claim that VP9 came
 *   out of the encoder; the frame accounting the page asserts is untouched by it.
 * - `validation/replay.ts` reaches the Node side through `@vitest/browser/context`,
 *   which a jsdom run has no counterpart for. The helper is transcribed with its
 *   early return and its base64 conversion intact, over a stand-in for the
 *   browser command that records what it was handed.
 * - The example is a seeded workspace of several modules; here everything lives
 *   in one module, so the `Snapshot` and `Debug` interfaces the page declares
 *   twice — once in `validation/debug.ts` and once in `src/game.ts`, both from
 *   the same instrumentation spec — are declared once, and the cast to
 *   `GameDefinition<Debug>` the page's harness makes is unnecessary here because
 *   the two declarations cannot differ.
 * - Imports name the engine's own modules rather than the published package
 *   `@clockwyrks/structured-3d` (this file *is* that package).
 * - One assertion is *added*, and it is the only one: the page's wall check
 *   closes on `runner.x < ARENA_WIDTH / 2`, which is exactly where an unblocked
 *   runner arrives after the 120 frames the check advances, so that line alone
 *   cannot tell a walled arena from an open field. The page's own prose says
 *   more than the line does — the runner "meets it with its radius to spare" —
 *   and that sentence is asserted beside it, where the runner settles.
 * - This repository compiles with `noUncheckedIndexedAccess`, so the page's
 *   `hits[0].wall`, `played[0].gain`, and `recording.frames[0].count` become
 *   asserted index reads, and `screen.getContext = () => recorded` takes a cast
 *   because `getContext` is an overload set nothing with one signature satisfies.
 *   The values compared and the behaviour driven are unchanged.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — the case's constants, transcribed verbatim              */
/* -------------------------------------------------------------------------- */

const DESIGN_WIDTH = 640;
const DESIGN_HEIGHT = 360;

const BACKGROUND = "#0b0f18";
const WALL_COLOR = "#2a3550";
const ORB_COLOR = "#f7c948";
const RUNNER_COLOR = "#7fd1ff";
const HUD_COLOR = "#1a2238";
const SCORE_COLOR = "#f2f5f7";

const LEVELS = {
  arena: "arena",
  summary: "summary",
} as const;

const TAGS = {
  wall: "wall",
  orb: "orb",
  runner: "runner",
} as const;

const ACTIONS = {
  up: { keys: ["KeyW", "ArrowUp"] },
  down: { keys: ["KeyS", "ArrowDown"] },
  left: { keys: ["KeyA", "ArrowLeft"] },
  right: { keys: ["KeyD", "ArrowRight"] },
  dash: { keys: ["Space"] },
} as const;

const CUES = {
  collect: { freq: 880, freqTo: 1320, durationMs: 90 },
  dash: { wave: "square", freq: 220, freqTo: 110, durationMs: 120 },
  over: { freq: 440, freqTo: 220, durationMs: 400 },
} as const;

type ActionName = keyof typeof ACTIONS;

const ARENA_WIDTH = 16;
const ARENA_DEPTH = 9;

const CAMERA = { position: vec3(0, 12, 9), target: vec3(0, 0, 0) };

const ORB_COUNT = 6;
const ORB_RADIUS = 0.3;
const ORB_POINTS = 10;

const RUNNER_RADIUS = 0.5;
const RUNNER_SPEED = 4;

const DASH_SPEED = 12;
const DASH_SECONDS = 0.25;

const HUD = { x: 80, y: 24, width: 140, height: 28 };
const HUD_LAYER = 0;
const SCORE_LAYER = 1;

const MATCH_SECONDS = 30;

/* -------------------------------------------------------------------------- */
/* validation/debug.ts — the surface the instrumentation spec fixes           */
/* -------------------------------------------------------------------------- */

interface Snapshot {
  level: string;
  phase: string;
  runner: Vec3;
  orbs: Vec3[];
  score: number;
}

interface Debug {
  placeRunner(at: Vec3): void;
  placeOrb(index: number, at: Vec3): void;
  keepOrbs(count: number): void;
  snapshot(): Snapshot;
}

/* -------------------------------------------------------------------------- */
/* The build under test: a reference build of the collection arena            */
/* -------------------------------------------------------------------------- */

/**
 * A boundary of the arena: one box drawn and one box tested, both resized
 * together, because the build's `wall` helper places four walls of three
 * different sizes from one class.
 */
class Wall extends Actor {
  readonly body = this.attach(
    new MeshComponent({
      geometry: { kind: "box", width: 1, height: 1, depth: 1 },
      material: { color: WALL_COLOR },
    }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: { kind: "box", width: 1, height: 1, depth: 1 },
      channel: TAGS.wall,
      responses: { [TAGS.runner]: "block" },
    }),
  );

  resize(width: number, height: number, depth: number): void {
    this.body.geometry = { kind: "box", width, height, depth };
    this.collider.shape = { kind: "box", width, height, depth };
  }
}

/** One collectible: a sphere the runner sweeps up by overlapping it. */
class Orb extends Actor {
  readonly body = this.attach(
    new MeshComponent({
      geometry: { kind: "sphere", radius: ORB_RADIUS },
      material: { color: ORB_COLOR },
    }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: { kind: "sphere", radius: ORB_RADIUS },
      channel: TAGS.orb,
      responses: { [TAGS.runner]: "overlap" },
    }),
  );
}

/**
 * The pawn player 0 possesses. The controller records a steering direction on
 * the ground plane and arms the dash; the pawn integrates against the delta it
 * is given, spending the dash budget at `DASH_SPEED` and the rest of each frame
 * at `RUNNER_SPEED`, so the dash costs exactly its stated duration whatever the
 * clock's step is.
 */
class Runner extends Pawn {
  readonly body = this.attach(
    new MeshComponent({
      geometry: { kind: "sphere", radius: RUNNER_RADIUS },
      material: { color: RUNNER_COLOR },
    }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: { kind: "sphere", radius: RUNNER_RADIUS },
      channel: TAGS.runner,
      responses: { [TAGS.wall]: "block", [TAGS.orb]: "overlap" },
    }),
  );

  private direction: Vec3 = vec3(0, 0, 0);
  private dashLeft = 0;

  constructor() {
    super();
    this.addTag(TAGS.runner);
  }

  /** Records this frame's steering intent; consumed and reset by `tick`. */
  steer(direction: Vec3): void {
    this.direction = direction;
  }

  /** Arms one dash and sounds its cue. One press costs one call. */
  dash(): void {
    this.dashLeft = DASH_SECONDS;
    this.world.audio.play("dash");
  }

  override tick(dt: number): void {
    // The dash is a budget of seconds spent at the dash speed: each frame
    // consumes what it can, so the boundary frame splits itself between the two
    // speeds and the distances sum exactly.
    const dashTime = Math.min(this.dashLeft, dt);
    this.dashLeft -= dashTime;
    const length = Math.hypot(this.direction.x, this.direction.z);
    if (length > 0) {
      const travel = DASH_SPEED * dashTime + RUNNER_SPEED * (dt - dashTime);
      this.transform.position = add(
        this.transform.position,
        scale(this.direction, travel / length),
      );
    }
    this.direction = vec3(0, 0, 0);
  }
}

/**
 * Player 0's controller: two axes on the ground plane from four held actions,
 * one edge for the dash. `up` and `down` steer along `-Z` and `+Z` and `left`
 * and `right` along `-X` and `+X`, which from the case's camera is up, down,
 * left, and right across the screen.
 */
class RunnerController extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Runner)) return;
    pawn.steer(
      vec3(
        this.input.value("right") - this.input.value("left"),
        0,
        this.input.value("down") - this.input.value("up"),
      ),
    );
    if (this.input.pressed("dash")) pawn.dash();
  }
}

/** The hemisphere and the directional light a standard material is shaded by. */
class Lights extends Actor {
  readonly sky = this.attach(
    new LightComponent({
      light: {
        kind: "hemisphere",
        sky: "#b8d0ff",
        ground: "#20242e",
        intensity: 1,
      },
    }),
  );
  readonly sun = this.attach(
    new LightComponent({ light: { kind: "directional", intensity: 2 } }),
  );

  constructor() {
    super();
    // A light is aimed by rotating what carries it, so the sun looks down and
    // across the arena rather than along the world's own `-Z`.
    this.transform.rotation = quatLookAt(vec3(-0.4, -1, -0.6));
  }
}

/**
 * The score readout: a panel on `HUD_LAYER` and the reading over it on
 * `SCORE_LAYER`, both screen-space, so the actor's position is logical units
 * and the two layer numbers are the screen pass's sort key.
 */
class Hud extends Actor {
  readonly panel = this.attach(
    new ShapeComponent({
      shape: { kind: "rect", width: HUD.width, height: HUD.height },
      fill: HUD_COLOR,
    }),
  );
  readonly readout = this.attach(
    new TextComponent({
      text: "score 0",
      font: "16px sans-serif",
      fill: SCORE_COLOR,
    }),
  );

  constructor() {
    super();
    this.panel.layer = HUD_LAYER;
    this.readout.layer = SCORE_LAYER;
  }

  override tick(): void {
    this.readout.text = `score ${this.world.state.players[0]?.score ?? 0}`;
  }
}

/**
 * The arena's mode: it poses the camera the case fixes, registers the world's
 * diagnostic, adds player 0 — which spawns the runner and possesses it — scores
 * each runner–orb overlap, backs the runner out of a blocking wall, and travels
 * to the summary once the last orb is gone or the match clock runs out.
 */
class ArenaMode extends GameMode {
  override playerControllerClass = RunnerController;
  override pawnClass = Runner;

  /** Removers for the engine-bus subscriptions this world's mode made. */
  private readonly off: (() => void)[] = [];

  override beginPlay(): void {
    const world = this.world;

    world.camera.position = CAMERA.position;
    world.camera.lookAt(CAMERA.target);

    this.addPlayer({ name: "runner" });
    this.setPhase("playing");

    world.diagnostics.register("orbs", () => world.byTag(TAGS.orb).length);

    this.off.push(
      // Detection is the engine's; the response is the game's. A blocking pair
      // is separated by moving the runner out along the manifold, with the
      // normal flipped when the runner is the pair's first actor.
      world.events.on("hit", ({ a, b, manifold }) => {
        const runner = a instanceof Runner ? a : b instanceof Runner ? b : null;
        if (runner === null) return;
        const push: Manifold["normal"] = manifold.normal;
        const sign = a === runner ? -1 : 1;
        runner.transform.position = add(
          runner.transform.position,
          scale(push, sign * manifold.depth),
        );
      }),
      world.events.on("overlap:begin", ({ a, b }) => {
        const orb = a instanceof Orb ? a : b instanceof Orb ? b : null;
        const runner = a instanceof Runner ? a : b instanceof Runner ? b : null;
        if (orb === null || runner === null || !orb.alive) return;
        // Placed before the destroy, so the cue sounds from where the orb stood.
        this.world.audio.play("collect", { at: orb.transform.position });
        orb.destroy();
        const scorer = this.state.players[0];
        if (scorer !== undefined) scorer.score += ORB_POINTS;
      }),
    );

    world.after(MATCH_SECONDS, () => this.finish());
  }

  override tick(): void {
    if (this.phase !== "playing") return;
    if (this.world.byTag(TAGS.orb).length === 0) this.finish();
  }

  override endPlay(reason: EndPlayReason): void {
    // Subscriptions live on the engine rather than the world, so the mode
    // removes its own when its world closes.
    for (const remove of this.off) remove();
    this.off.length = 0;
    super.endPlay(reason);
  }

  private finish(): void {
    if (this.phase === "over") return;
    this.setPhase("over");
    this.world.audio.play("over");
    this.world.open(LEVELS.summary, {
      score: this.state.players[0]?.score ?? 0,
    });
  }
}

/**
 * The summary's mode. It keeps a possessed runner so the debug surface's
 * `snapshot` answers in the summary as readily as in the arena, which the
 * example's transition check relies on.
 */
class SummaryMode extends GameMode {
  override playerControllerClass = RunnerController;
  override pawnClass = Runner;

  override beginPlay(): void {
    this.addPlayer({ name: "runner" });
    this.setPhase("over");
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — the build's game definition, transcribed verbatim            */
/* -------------------------------------------------------------------------- */

const WALL_THICKNESS = 0.5;
const WALL_HEIGHT = 1;
const HALF = WALL_THICKNESS / 2;

const copy = (at: Vec3): Vec3 => vec3(at.x, at.y, at.z);

class Collector extends GameInstance<Debug> {
  best = 0;

  override initialize(api: InitApi): Debug {
    for (const [name, binding] of Object.entries(ACTIONS)) {
      api.input.register(name, { keys: [...binding.keys] });
    }
    for (const [cue, spec] of Object.entries(CUES)) {
      api.audio.define(cue, spec);
    }
    api.diagnostics.register("best", () => this.best);

    return {
      placeRunner: (at) => {
        this.runner().transform.position = copy(at);
      },
      placeOrb: (index, at) => {
        const orb = this.orbs()[index];
        if (orb === undefined)
          throw new Error(`the arena holds no orb ${index}`);
        orb.transform.position = copy(at);
      },
      keepOrbs: (count) => {
        const orbs = this.orbs();
        if (orbs.length < count)
          throw new Error(`the arena holds ${orbs.length} orbs`);
        for (const orb of orbs.slice(count)) orb.destroy();
      },
      snapshot: () => {
        const world = this.engine.world;
        return {
          level: world.level,
          phase: world.state.phase,
          runner: copy(this.runner().transform.position),
          orbs: this.orbs().map((orb) => copy(orb.transform.position)),
          score: world.state.players[0]?.score ?? 0,
        };
      },
    };
  }

  private runner(): PawnType {
    const [player] = this.engine.world.players();
    const pawn = player?.pawn ?? null;
    if (pawn === null) throw new Error("no player controller holds a runner");
    return pawn;
  }

  private orbs(): readonly ActorType[] {
    return this.engine.world.byTag(TAGS.orb);
  }
}

function wall(
  x: number,
  z: number,
  width: number,
  depth: number,
): ActorSpec<Wall> {
  return {
    type: Wall,
    transform: { position: vec3(x, WALL_HEIGHT / 2, z) },
    tags: [TAGS.wall],
    configure: (actor) => actor.resize(width, WALL_HEIGHT, depth),
  };
}

const orbs: readonly ActorSpec<Orb>[] = Array.from(
  { length: ORB_COUNT },
  (_, i) => {
    const angle = (i / ORB_COUNT) * Math.PI * 2;
    return {
      type: Orb,
      transform: {
        position: vec3(Math.cos(angle) * 5, 0, Math.sin(angle) * 3),
      },
      tags: [TAGS.orb],
    };
  },
);

const game: GameDefinition<Debug> = {
  instance: Collector,
  levels: {
    [LEVELS.arena]: {
      mode: ArenaMode,
      actors: [
        { type: Lights },
        { type: Hud, transform: { position: vec3(HUD.x, HUD.y, 0) } },
        wall(
          0,
          -(ARENA_DEPTH / 2 + HALF),
          ARENA_WIDTH + 2 * WALL_THICKNESS,
          WALL_THICKNESS,
        ),
        wall(
          0,
          ARENA_DEPTH / 2 + HALF,
          ARENA_WIDTH + 2 * WALL_THICKNESS,
          WALL_THICKNESS,
        ),
        wall(-(ARENA_WIDTH / 2 + HALF), 0, WALL_THICKNESS, ARENA_DEPTH),
        wall(ARENA_WIDTH / 2 + HALF, 0, WALL_THICKNESS, ARENA_DEPTH),
        ...orbs,
      ],
    },
    [LEVELS.summary]: { mode: SummaryMode },
  },
  startLevel: LEVELS.arena,
};

/* -------------------------------------------------------------------------- */
/* validation/harness.ts — the harness every validator builds through         */
/* -------------------------------------------------------------------------- */

type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

interface HarnessOptions {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
}

interface Harness {
  readonly engine: Engine<Debug>;
  readonly instance: GameInstance<Debug>;
  readonly stage: HTMLCanvasElement;
  readonly screen: CanvasRenderingContext2D;
  readonly calls: DrawCall[];
  readonly assetFailures: string[];
  world(): World;
  hold(action: ActionName): void;
  release(action: ActionName): void;
  tap(action: ActionName): void;
  logical(point: Vec3): Vec2;
  device(point: Vec2): { x: number; y: number };
  pixel(point: Vec2): [number, number, number, number];
  picture(point: Vec2): [number, number, number, number];
  dispose(): void;
}

/**
 * The page dispatches a `KeyboardEvent`; jsdom has one, but it reports `code`
 * only for a real `KeyboardEventInit`, which is what this passes it.
 */
function keyEvent(type: "keydown" | "keyup", code: string): KeyboardEvent {
  return new KeyboardEvent(type, { code });
}

function rgba(color: string): [number, number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

function toDevice(world: World, point: Vec2): { x: number; y: number } {
  const view = world.viewport();
  return {
    x: Math.round(view.offsetX + point.x * view.scale),
    y: Math.round(view.offsetY + point.y * view.scale),
  };
}

function recorder(
  target: CanvasRenderingContext2D,
  calls: DrawCall[],
): CanvasRenderingContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

function callsTo(calls: readonly DrawCall[], method: string): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

function setsOf(calls: readonly DrawCall[], property: string): unknown[] {
  return calls.flatMap((call) =>
    call.kind === "set" && call.property === property ? [call.value] : [],
  );
}

/**
 * What the screen layer holds at one device pixel, from the shapes the frame
 * filled rather than from the bytes a rasterizer would have left.
 *
 * The page's harness reads `ctx.getImageData`; jsdom's 2D context draws nothing,
 * so the reading is reconstructed from the recorded operation stream, which
 * carries the transform in force for each operation and the fill style it was
 * drawn under. The engine traces a `ShapeComponent`'s rect as a path and fills
 * it, so composition here is `beginPath`/`rect`/`fill` plus the engine's own
 * whole-canvas `clearRect` — opaque rectangles over transparency, which is
 * exactly the HUD the case fixes and exactly what the page's two samples are
 * about: one inside the panel and left of the readout, one where the layer was
 * left clear for the world pass to show through. Text is not composed, because
 * a glyph's coverage is a rasterizer's answer rather than a stream's; the page's
 * inside-the-panel sample is chosen clear of the readout for the same reason it
 * is chosen clear of the panel's anti-aliased edge. Anything else — an arc, a
 * polygon, an image — is refused rather than guessed, so a build drawing its HUD
 * some other way fails loudly instead of quietly reading transparent.
 */
function layerPixel(
  ops: readonly RecordedOp[],
  at: { x: number; y: number },
): [number, number, number, number] {
  let color: [number, number, number, number] = [0, 0, 0, 0];
  let path: { x: number; y: number; width: number; height: number } | null =
    null;

  const covers = (
    rect: { x: number; y: number; width: number; height: number },
    transform: readonly number[],
  ): boolean => {
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = transform;
    if (b !== 0 || c !== 0) {
      throw new Error("the screen layer drew under a rotated transform");
    }
    const left = a * rect.x + e;
    const top = d * rect.y + f;
    return (
      at.x >= left &&
      at.x < left + a * rect.width &&
      at.y >= top &&
      at.y < top + d * rect.height
    );
  };

  for (const op of ops) {
    switch (op.op) {
      case "beginPath":
        path = null;
        continue;
      case "rect": {
        const [x, y, width, height] = op.args as [
          number,
          number,
          number,
          number,
        ];
        path = { x, y, width, height };
        continue;
      }
      case "fill":
        if (path === null) continue;
        if (covers(path, op.transform)) color = rgba(String(op.fill));
        continue;
      case "fillRect": {
        const [x, y, width, height] = op.args as [
          number,
          number,
          number,
          number,
        ];
        if (covers({ x, y, width, height }, op.transform)) {
          color = rgba(String(op.fill));
        }
        continue;
      }
      case "clearRect": {
        const [x, y, width, height] = op.args as [
          number,
          number,
          number,
          number,
        ];
        if (covers({ x, y, width, height }, op.transform)) color = [0, 0, 0, 0];
        continue;
      }
      case "arc":
      case "ellipse":
      case "moveTo":
      case "lineTo":
      case "drawImage":
        throw new Error(
          `the screen layer drew ${op.op}, which this reading cannot compose`,
        );
      default:
        continue;
    }
  }
  return color;
}

/**
 * What the stage canvas holds at one device pixel *outside* the letterboxed
 * picture, from the clear the frame issued.
 *
 * The page reads the stage back by drawing it into a 2D canvas of its own; under
 * jsdom the renderer draws through a stubbed GL context that rasterizes nothing,
 * so the only stage pixels still honestly readable are the letterbox bars, which
 * no draw ever touches and which carry exactly the colour the frame's
 * whole-canvas clear wrote. A point inside the picture is refused rather than
 * answered with the clear, because inside the viewport the world pass is drawn
 * over it.
 */
function barPixel(
  gl: GlStub,
  viewport: Viewport,
  at: { x: number; y: number },
): [number, number, number, number] {
  if (inPicture(viewport, at)) {
    throw new Error(
      "the stage's picture is drawn by the GPU; only a letterbox sample is readable here",
    );
  }
  const cleared = gl.lastCall("clearColor")?.args as number[] | undefined;
  if (cleared === undefined) throw new Error("no frame has cleared the stage");
  const [r = 0, g = 0, b = 0, alpha = 0] = cleared;
  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
    Math.round(alpha * 255),
  ];
}

/** Whether a device pixel lies inside the letterboxed rectangle the world pass drew into. */
function inPicture(viewport: Viewport, at: { x: number; y: number }): boolean {
  return (
    at.x >= viewport.offsetX &&
    at.x < viewport.offsetX + viewport.width * viewport.scale &&
    at.y >= viewport.offsetY &&
    at.y < viewport.offsetY + viewport.height * viewport.scale
  );
}

/** Every material one object was actually drawn through, in draw order. */
function watchMaterial(object: THREE.Object3D): THREE.Material[] {
  const seen: THREE.Material[] = [];
  object.onBeforeRender = (
    _renderer: THREE.WebGLRenderer,
    _scene: THREE.Scene,
    _camera: THREE.Camera,
    _geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ): void => {
    seen.push(material);
  };
  return seen;
}

/** What the environment stands in for, installed around every check below. */
let contexts: InstalledContexts;
let codecs: InstalledCodecs;

beforeEach(() => {
  // Installed on the prototype rather than on the canvases the harness makes,
  // because the recorder creates a capture canvas of its own from the document.
  contexts = installCanvasContexts();
  codecs = installCodecs();
});

afterEach(() => {
  codecs.uninstall();
  contexts.uninstall();
});

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const cssWidth = options.cssWidth ?? DESIGN_WIDTH;
  const cssHeight = options.cssHeight ?? DESIGN_HEIGHT;
  const dpr = options.dpr ?? 1;
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);

  const stage = canvas(deviceWidth, deviceHeight);
  const screen = canvas(deviceWidth, deviceHeight);
  const ctx = screen.getContext("2d") as CanvasRenderingContext2D;
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  screen.getContext = (() =>
    recorded) as unknown as HTMLCanvasElement["getContext"];

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<Debug>({
    canvas: stage,
    screen,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    game,
    background: BACKGROUND,
    clock: options.clock ?? new ConstantClock(1000 / 60),
    surface,
  });

  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });

  const instance = await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", action: ActionName): void => {
    events.dispatchEvent(keyEvent(type, ACTIONS[action].keys[0]));
  };

  // The two readings the page takes from pixels, taken from what the harness's
  // stand-ins recorded instead: the layer's operations, and the stage's GL.
  const layer = contexts.context2dFor(screen) as Context2dStub;
  const gl = contexts.glFor(stage) as GlStub;

  return {
    engine,
    instance,
    stage,
    screen: ctx,
    calls,
    assetFailures,
    world: () => engine.world,
    hold: (action) => dispatch("keydown", action),
    release: (action) => dispatch("keyup", action),
    tap: (action) => {
      dispatch("keydown", action);
      dispatch("keyup", action);
    },
    logical: (point) => {
      const at = engine.world.camera.worldToLogical(point);
      return { x: at.x, y: at.y };
    },
    device: (point) => toDevice(engine.world, point),
    pixel: (point) => layerPixel(layer.ops, toDevice(engine.world, point)),
    picture: (point) =>
      barPixel(gl, engine.viewport(), toDevice(engine.world, point)),
    dispose: () => engine.destroy(),
  };
}

/* -------------------------------------------------------------------------- */
/* validation/simulation.test.ts                                              */
/* -------------------------------------------------------------------------- */

describe("stepping the simulation", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("carries the runner at its stated speed", async () => {
    const { engine } = harness;
    engine.debug.placeRunner(vec3(0, 0, 0));

    harness.hold("right");
    await engine.advance(60);

    const { runner } = engine.debug.snapshot();
    expect(engine.frame().count).toBe(60);
    expect(engine.frame().timeMs).toBeCloseTo(1000, 6);
    expect(runner.x).toBeCloseTo(RUNNER_SPEED, 2);
    expect(runner.y).toBeCloseTo(0, 6);
    expect(runner.z).toBeCloseTo(0, 6);
    expect(harness.assetFailures).toEqual([]);
  });

  it("spends the dash over its stated duration", async () => {
    const { engine } = harness;
    engine.debug.placeRunner(vec3(0, 0, 0));

    harness.hold("right");
    harness.tap("dash");
    await engine.advance(60);

    const dashed = DASH_SPEED * DASH_SECONDS;
    const walked = RUNNER_SPEED * (1 - DASH_SECONDS);
    expect(engine.debug.snapshot().runner.x).toBeCloseTo(dashed + walked, 2);
  });

  it("is blocked by the arena wall", async () => {
    const { engine } = harness;
    engine.debug.placeRunner(vec3(0, 0, 0));

    const hits: { wall: boolean; normal: Vec3 }[] = [];
    engine.events.on("hit", ({ a, manifold }) => {
      hits.push({ wall: a.hasTag(TAGS.wall), normal: manifold.normal });
    });

    harness.hold("right");
    await engine.advance(120);

    expect(hits.length).toBeGreaterThan(0);
    const first = hits[0]!;
    expect(first.wall).toBe(true);
    expect(first.normal.x).toBeCloseTo(-1, 6);
    expect(first.normal.y).toBeCloseTo(0, 6);
    expect(engine.debug.snapshot().runner.x).toBeLessThan(ARENA_WIDTH / 2);
    // The prose behind that inequality — the runner "meets it with its radius
    // to spare" — asserted separately, because the page's own bound sits
    // exactly where an unblocked runner would have arrived after 120 frames of
    // 4 units per second and so cannot, on its own, tell a walled arena from an
    // open field. Where the runner settles can: against the wall's inner face,
    // its own radius short of it.
    expect(engine.debug.snapshot().runner.x).toBeCloseTo(
      ARENA_WIDTH / 2 - RUNNER_RADIUS,
      6,
    );
  });

  it("names the wall as the pair's first actor on every hit", async () => {
    // The page's closing note on the simulation suite: "A `hit` names the actor
    // with the lower `id` as `a`. The walls are declared actors and the runner
    // is spawned by the game mode, so the wall is always `a`". The page's own
    // check reads that off the first hit; this reads it off every one of them,
    // and off the ids the claim is actually about.
    const { engine } = harness;
    engine.debug.placeRunner(vec3(0, 0, 0));

    const pairs: { a: number; b: number; wall: boolean }[] = [];
    engine.events.on("hit", ({ a, b }) => {
      pairs.push({ a: a.id, b: b.id, wall: a.hasTag(TAGS.wall) });
    });

    harness.hold("right");
    await engine.advance(120);

    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.filter((pair) => !pair.wall)).toEqual([]);
    expect(pairs.filter((pair) => pair.a >= pair.b)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/world-and-actors.test.ts                                        */
/* -------------------------------------------------------------------------- */

describe("asserting on the world and the actors", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("opens the arena with its orbs and one possessed runner", () => {
    const { engine } = harness;
    const world = harness.world();

    expect(world.level).toBe(LEVELS.arena);
    expect(world.mode.phase).toBe("playing");
    expect(world.state.phase).toBe("playing");
    expect(world.byTag(TAGS.orb)).toHaveLength(ORB_COUNT);

    const [player] = world.players();
    expect(player!.index).toBe(0);
    expect(player!.pawn?.hasTag(TAGS.runner)).toBe(true);
    expect(world.state.players).toHaveLength(1);

    const snapshot = engine.debug.snapshot();
    expect(snapshot.level).toBe(LEVELS.arena);
    expect(snapshot.orbs).toHaveLength(ORB_COUNT);
    expect(snapshot.runner).toEqual(player!.pawn?.transform.position);

    const ids = world.actors().map((actor) => actor.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("removes a destroyed orb from the world at the end of the frame", async () => {
    const { engine } = harness;
    const world = harness.world();

    const destroyed: number[] = [];
    engine.events.on("actor:destroyed", ({ actor }) =>
      destroyed.push(actor.id),
    );

    const [kept] = world.byTag(TAGS.orb);
    engine.debug.keepOrbs(1);
    expect(world.byTag(TAGS.orb)).toEqual([kept]);

    await engine.advance(1);

    expect(destroyed).toHaveLength(ORB_COUNT - 1);
    expect(world.actors().filter((actor) => actor.hasTag(TAGS.orb))).toEqual([
      kept,
    ]);
  });

  it("travels to the summary level when the last orb is collected", async () => {
    const { engine } = harness;
    const arena = harness.world();

    const travel: string[] = [];
    engine.events.on("world:opening", ({ from, to }) =>
      travel.push(`${from} -> ${to}`),
    );
    engine.events.on("world:opened", ({ level }) =>
      travel.push(`opened ${level}`),
    );

    engine.debug.keepOrbs(1);
    await engine.advance(1);
    engine.debug.placeOrb(0, vec3(2, 0, 0));
    engine.debug.placeRunner(vec3(2, 0, 0));
    await engine.advance(1);

    const summary = harness.world();
    expect(travel).toEqual([
      `${LEVELS.arena} -> ${LEVELS.summary}`,
      `opened ${LEVELS.summary}`,
    ]);
    expect(summary.level).toBe(LEVELS.summary);
    expect(summary).not.toBe(arena);
    expect(summary.mode.options.score).toBe(ORB_POINTS);
    expect(summary.time).toBeCloseTo(0, 6);
    expect(engine.debug.snapshot().level).toBe(LEVELS.summary);
    expect(engine.instance).toBe(harness.instance);
    expect(engine.frame().count).toBe(2);
  });

  it("numbers the declared actors from one, below the runner the mode spawns", () => {
    // The page: ids are "assigned in spawn order from `1`", and "the walls and
    // the orbs are declared actors, so they are built before the mode begins
    // play and their ids are lower than the runner's". The page's first check
    // runs without advancing because "`engine.initialize` resolves once the
    // start level's actors have begun play and its game mode has begun play",
    // which is the frame counter still reading zero.
    const { engine } = harness;
    const world = harness.world();

    expect(engine.frame().count).toBe(0);

    const ids = world.actors().map((actor) => actor.id);
    expect(Math.min(...ids)).toBe(1);

    const runner = world.players()[0]?.pawn;
    expect(runner).toBeDefined();

    const declared = [...world.byTag(TAGS.wall), ...world.byTag(TAGS.orb)];
    expect(declared).toHaveLength(4 + ORB_COUNT);
    expect(Math.max(...declared.map((actor) => actor.id))).toBeLessThan(
      runner!.id,
    );
  });

  it("shares no record between a pose and a reading", () => {
    // The page: "A pose assigns a fresh `Vec3` to `transform.position`, and a
    // reading copies the position out, so the suite and the build share no
    // record." Writing through either handle is what states it: the vector the
    // pose was handed and the vector a snapshot returned are both the suite's.
    const { engine } = harness;
    const posed = vec3(1, 0, 2);
    engine.debug.placeRunner(posed);

    const first = engine.debug.snapshot();
    expect(first.runner).toEqual(vec3(1, 0, 2));

    posed.x = 99;
    first.runner.z = 99;
    first.orbs[0]!.x = 99;

    const second = engine.debug.snapshot();
    expect(second.runner).toEqual(vec3(1, 0, 2));
    expect(second.runner).not.toBe(first.runner);
    expect(second.orbs[0]).toEqual(
      harness.world().byTag(TAGS.orb)[0]!.transform.position,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* validation/diagnostics.test.ts                                             */
/* -------------------------------------------------------------------------- */

describe("asserting the diagnostics a build registered", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("registers the diagnostics the case names", () => {
    const { engine } = harness;
    engine.debug.keepOrbs(2);

    expect(engine.diagnostics()).toEqual([
      { name: "best", value: 0 },
      { name: "orbs", value: 2 },
    ]);
  });

  it("drops the arena's source when the arena closes", async () => {
    // The page's closing note on the diagnostics suite: a source the arena
    // registers is dropped when the arena closes, so the same read after the
    // travel returns the instance's sources and whatever the summary registered.
    const { engine } = harness;
    engine.debug.keepOrbs(0);
    await engine.advance(1);

    expect(harness.world().level).toBe(LEVELS.summary);
    expect(engine.diagnostics()).toEqual([{ name: "best", value: 0 }]);
  });

  it("reads the sources without drawing the overlay or stepping the frame", async () => {
    // The page: "Reading evaluates the sources and changes nothing else, so a
    // check reads them at any point in a scenario, and the overlay stays hidden
    // throughout." Hidden is observable on the screen layer: the overlay draws
    // its column of lines there, so while it stays hidden the only text a frame
    // writes is the HUD's readout.
    const { engine, calls } = harness;
    await engine.advance(1);

    const before = engine.frame().count;
    calls.length = 0;
    expect(engine.diagnostics()).toEqual([
      { name: "best", value: 0 },
      { name: "orbs", value: ORB_COUNT },
    ]);
    expect(calls).toEqual([]);
    expect(engine.frame().count).toBe(before);

    calls.length = 0;
    await engine.advance(1);
    expect(callsTo(calls, "fillText").map((args) => args[0])).toEqual([
      "score 0",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/rendering.test.ts                                               */
/* -------------------------------------------------------------------------- */

describe("asserting on the scene, the projection, and the pixels", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
  });

  afterEach(() => {
    harness.dispose();
  });

  function meshesColored(scene: THREE.Scene, color: string): THREE.Mesh[] {
    const found: THREE.Mesh[] = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as { color?: THREE.Color };
      if (material.color?.getHexString() === color.slice(1)) found.push(object);
    });
    return found;
  }

  it("places a mesh in the scene for each orb and for the runner", async () => {
    const { engine } = harness;
    engine.debug.keepOrbs(3);
    await engine.advance(1);
    engine.debug.placeRunner(vec3(2, 0, -1));
    await engine.advance(1);

    expect(meshesColored(engine.scene, ORB_COLOR)).toHaveLength(3);

    const [runner] = meshesColored(engine.scene, RUNNER_COLOR);
    expect(runner).toBeDefined();
    expect(runner!.visible).toBe(true);
    const at = runner!.getWorldPosition(new THREE.Vector3());
    expect(at.x).toBeCloseTo(2, 6);
    expect(at.y).toBeCloseTo(0, 6);
    expect(at.z).toBeCloseTo(-1, 6);
  });

  it("projects the runner to the center of the field at the origin", async () => {
    const { engine } = harness;
    engine.debug.placeRunner(vec3(0, 0, 0));
    await engine.advance(1);

    const camera = harness.world().camera;
    expect(camera.snapshot().position).toEqual(CAMERA.position);

    const origin = camera.worldToLogical(vec3(0, 0, 0));
    expect(origin.visible).toBe(true);
    expect(origin.x).toBeCloseTo(DESIGN_WIDTH / 2, 3);
    expect(origin.y).toBeCloseTo(DESIGN_HEIGHT / 2, 3);

    const right = harness.logical(vec3(3, 0, 0));
    expect(right.x).toBeGreaterThan(origin.x);
    expect(right.y).toBeCloseTo(origin.y, 3);
    expect(camera.worldToLogical(vec3(0, 24, 18)).visible).toBe(false);
  });

  it("renders the runner where the camera projects it", async () => {
    const { engine } = harness;
    engine.debug.placeRunner(vec3(0, 0, 0));
    await engine.advance(1);

    // The letterbox half of the page's check, which is readable here: a logical
    // point left of the field lands in the bar, which the pipeline clears to
    // `background` along with the rest of the canvas.
    expect(harness.picture({ x: -40, y: 10 })).toEqual(rgba(BACKGROUND));

    // The picture half. The page samples the stage at the point the camera
    // projects the runner to and reads the runner's colour back under `unlit`;
    // no rasterizer here can answer that, so the same claim is read one step
    // earlier — the point is inside the letterboxed rectangle the world pass
    // renders into, and the material the runner's mesh was drawn *through* is
    // the declared one under `shaded` and the case's colour, unlit and opaque,
    // under `unlit`.
    const center = harness.logical(vec3(0, 0, 0));
    expect(inPicture(engine.viewport(), harness.device(center))).toBe(true);

    const [runner] = meshesColored(engine.scene, RUNNER_COLOR);
    expect(runner).toBeDefined();
    const declared = runner!.material as THREE.Material;
    const seen = watchMaterial(runner!);

    await engine.advance(1);
    expect(seen).toEqual([declared]);

    engine.renderer.setMode("unlit");
    await engine.advance(1);

    const unlit = seen.at(-1) as THREE.MeshBasicMaterial;
    expect(unlit).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(`#${unlit.color.getHexString()}`).toBe(RUNNER_COLOR);
    expect(unlit.opacity).toBe(1);
  });

  it("draws the HUD panel on the screen layer in the color the case fixes", async () => {
    const { engine } = harness;
    await engine.advance(1);

    expect(harness.device({ x: 0, y: 0 })).toEqual({ x: 160, y: 0 });
    expect(harness.pixel({ x: HUD.x - HUD.width / 2 + 6, y: HUD.y })).toEqual(
      rgba(HUD_COLOR),
    );
    const corner = { x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT - 20 };
    expect(harness.pixel(corner)).toEqual([0, 0, 0, 0]);
  });

  it("writes the score over the panel", async () => {
    const { engine, calls } = harness;
    engine.debug.keepOrbs(2);
    await engine.advance(1);
    engine.debug.placeOrb(0, vec3(2, 0, 0));
    engine.debug.placeRunner(vec3(2, 0, 0));
    await engine.advance(1);

    calls.length = 0;
    await engine.advance(1);

    const fills = setsOf(calls, "fillStyle");
    expect(fills).toContain(HUD_COLOR);
    expect(fills.at(-1)).toBe(SCORE_COLOR);
    expect(fills.indexOf(HUD_COLOR)).toBeLessThan(
      fills.lastIndexOf(SCORE_COLOR),
    );

    const texts = callsTo(calls, "fillText");
    expect(texts.at(-1)?.[0]).toBe(`score ${ORB_POINTS}`);
  });

  it("draws outlines alone on the screen layer in wireframe", async () => {
    const { engine, calls } = harness;
    engine.renderer.setMode("wireframe");

    calls.length = 0;
    await engine.advance(1);

    expect(engine.renderer.mode()).toBe("wireframe");
    expect(callsTo(calls, "fill")).toHaveLength(0);
    expect(callsTo(calls, "fillText")).toHaveLength(0);
    expect(callsTo(calls, "stroke").length).toBeGreaterThan(0);
    expect(callsTo(calls, "strokeText").length).toBeGreaterThan(0);
  });

  it("fits the design field into the one backing store both canvases share", async () => {
    // The page's setup for this suite: "The canvases are 800 by 360 CSS pixels
    // at a device pixel ratio of 2, so the fit scales the 640 by 360 field by 2
    // and centers it in a 1600 by 720 backing store with a 160 device pixel bar
    // on each side. Both canvases share that backing store."
    const { engine, stage, screen } = harness;
    await engine.advance(1);

    expect([stage.width, stage.height]).toEqual([1600, 720]);
    expect([screen.canvas.width, screen.canvas.height]).toEqual([1600, 720]);

    const view = harness.world().viewport();
    expect(view.scale).toBe(2);
    expect(view.offsetX).toBe(160);
    expect(view.offsetY).toBe(0);
    expect(harness.device({ x: DESIGN_WIDTH, y: DESIGN_HEIGHT })).toEqual({
      x: 1440,
      y: 720,
    });
  });

  it("carries the engine's own clear and transform in the stream", async () => {
    // The page: "The stream also carries the engine's own clear and transform,
    // so a check names the operations the pipeline made for the game." The
    // clear is the whole backing store under the identity transform, which is
    // what makes the layer transparent wherever the screen pass drew nothing.
    const { engine, calls } = harness;
    calls.length = 0;
    await engine.advance(1);

    expect(callsTo(calls, "clearRect")).toEqual([[0, 0, 1600, 720]]);
    expect(callsTo(calls, "setTransform")[0]).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("strokes every wireframe outline at one width", async () => {
    // The page: under `wireframe` the screen pass strokes each component's
    // outline "at one width, with no fill".
    const { engine, calls } = harness;
    engine.renderer.setMode("wireframe");

    calls.length = 0;
    await engine.advance(1);

    const widths = setsOf(calls, "lineWidth");
    expect(widths.length).toBeGreaterThan(0);
    expect([...new Set(widths)]).toEqual([1]);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/input-and-audio.test.ts                                         */
/* -------------------------------------------------------------------------- */

describe("asserting on actions and cues", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("plays the dash cue once per press", async () => {
    const { engine } = harness;
    engine.debug.placeRunner(vec3(0, 0, 0));

    const played: { cue: string; t: number; gain: number; at: Vec3 | null }[] =
      [];
    const off = engine.events.on("cue:played", (event) => played.push(event));

    harness.hold("dash");
    await engine.advance(30);
    harness.release("dash");
    await engine.advance(30);
    off();

    expect(played.map((event) => event.cue)).toEqual(["dash"]);
    expect(played[0]!.gain).toBeGreaterThan(0);
    expect(played[0]!.t).toBeGreaterThan(0);
  });

  it("plays the collect cue where the orb stood and scores it", async () => {
    const { engine } = harness;
    const world = harness.world();
    engine.debug.keepOrbs(2);
    await engine.advance(1);
    engine.debug.placeOrb(0, vec3(2, 0, 0));
    engine.debug.placeRunner(vec3(2, 0, 0));

    const collected: { gain: number; at: Vec3 | null }[] = [];
    const off = engine.events.on("cue:played", ({ cue, gain, at }) => {
      if (cue === "collect") collected.push({ gain, at });
    });

    await engine.advance(1);
    off();

    expect(collected).toHaveLength(1);
    expect(collected[0]!.at).toEqual(vec3(2, 0, 0));
    expect(engine.debug.snapshot().score).toBe(ORB_POINTS);
    expect(world.byTag(TAGS.orb)).toHaveLength(1);
  });

  it("emits a muted cue with no gain", async () => {
    const { engine } = harness;
    const world = harness.world();
    world.audio.setMuted(true);

    const gains: number[] = [];
    const off = engine.events.on("cue:played", ({ gain }) => gains.push(gain));

    harness.tap("dash");
    await engine.advance(2);
    off();

    expect(world.audio.muted()).toBe(true);
    expect(gains).toEqual([0]);
  });

  it("plays the dash cue unpositioned and timestamps it in simulated time", async () => {
    // The page: "`t` is the frame loop's simulated time, so the timestamp a
    // check reads is the time the clock delivered rather than the real time the
    // suite took to run", and `at` is "`null` for an unpositioned one". The
    // page's own check reads `t > 0`; the clock makes the value itself known.
    const { engine } = harness;
    engine.debug.placeRunner(vec3(0, 0, 0));

    const played: { t: number; at: Vec3 | null }[] = [];
    const off = engine.events.on("cue:played", ({ cue, t, at }) => {
      if (cue === "dash") played.push({ t, at });
    });

    harness.tap("dash");
    await engine.advance(3);
    off();

    expect(played).toHaveLength(1);
    expect(played[0]!.at).toBeNull();
    expect(played[0]!.t).toBeCloseTo(1000 / 60, 6);
    expect(engine.frame().timeMs).toBeCloseTo(3 * (1000 / 60), 6);
  });

  it("reports the collect cue's point as a copy of the orb's own", async () => {
    // The page's events table: `at` is "the world point the call gave, as a
    // copy". The build plays the cue with the orb's own vector, so a copy is
    // what keeps the event readable after the orb is destroyed.
    const { engine } = harness;
    const world = harness.world();
    engine.debug.keepOrbs(1);
    await engine.advance(1);
    engine.debug.placeOrb(0, vec3(2, 0, 0));
    engine.debug.placeRunner(vec3(2, 0, 0));

    const orb = world.byTag(TAGS.orb)[0]!;
    const position = orb.transform.position;

    const points: (Vec3 | null)[] = [];
    const off = engine.events.on("cue:played", ({ cue, at }) => {
      if (cue === "collect") points.push(at);
    });

    await engine.advance(1);
    off();

    expect(points).toHaveLength(1);
    expect(points[0]).toEqual(vec3(2, 0, 0));
    expect(points[0]).not.toBe(position);
    expect(orb.alive).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/replay.ts and validation/recording.test.ts                      */
/* -------------------------------------------------------------------------- */

/** What the page's browser command was handed, in the order it was handed it. */
const emitted: { output: string; video: string }[] = [];

async function emitReplay(output: string, recording: Recording): Promise<void> {
  if (recording.frames.length === 0) return;
  emitted.push({ output, video: toBase64(recording.video) });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("emitting a recording", () => {
  let harness: Harness;

  beforeEach(async () => {
    emitted.length = 0;
    harness = await createHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("records the sweep that empties the arena", async () => {
    const { engine } = harness;
    engine.debug.keepOrbs(1);
    await engine.advance(1);
    engine.debug.placeOrb(0, vec3(3, 0, 0));
    engine.debug.placeRunner(vec3(0, 0, 0));

    engine.startRecording();
    harness.hold("right");
    await engine.advance(60);
    const recording = await engine.stopRecording();
    await emitReplay("sweep", recording);

    expect(recording.width).toBe(DESIGN_WIDTH);
    expect(recording.height).toBe(DESIGN_HEIGHT);
    expect(recording.frames).toHaveLength(60);
    expect(recording.frames[0]!.count).toBe(2);
    expect(recording.frames.at(-1)?.count).toBe(61);
    expect(recording.frames[0]!.deltaMs).toBeCloseTo(1000 / 60, 6);
    expect(recording.frames.at(-1)?.timeMs).toBeCloseTo(
      engine.frame().timeMs,
      6,
    );
    expect(recording.ended).toBe(false);
    expect(recording.video.length).toBeGreaterThan(0);
    expect(harness.world().level).toBe(LEVELS.summary);
  });

  it("emits the video's own bytes under the name the check chose", async () => {
    const { engine } = harness;

    engine.startRecording();
    await engine.advance(4);
    const recording = await engine.stopRecording();
    await emitReplay("sweep", recording);

    expect(emitted).toHaveLength(1);
    const sent = emitted[0]!;
    expect(sent.output).toBe("sweep");
    expect(Uint8Array.from(atob(sent.video), (c) => c.charCodeAt(0))).toEqual(
      recording.video,
    );
  });

  it("emits nothing for a recording that captured no frames", async () => {
    const { engine } = harness;

    engine.startRecording();
    const recording = await engine.stopRecording();
    await emitReplay("sweep", recording);

    expect(recording.frames).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it("refuses a second start while armed, which is why every path stops", async () => {
    // The page's closing instruction: call `stopRecording` on every path that
    // armed the recorder, since a second `startRecording` while armed is refused.
    const { engine } = harness;
    expect(engine.recording()).toBe(false);

    engine.startRecording();
    expect(engine.recording()).toBe(true);
    expect(() => engine.startRecording()).toThrow();

    await engine.advance(2);
    await engine.stopRecording();
    expect(engine.recording()).toBe(false);
  });
});
