import { afterEach, describe, expect, it } from "vitest";

import type { Clock, Engine, GameDefinition, InitApi } from "./index";
import {
  Actor,
  ConstantClock,
  FORWARD,
  GameInstance,
  GameMode,
  LightComponent,
  MeshComponent,
  createEngine,
  normalize,
  quatLookAt,
  quatRotate,
  vec3,
} from "./index";
import type { Context2dStub, InstalledContexts } from "./testing/canvas";
import { createStage, installCanvasContexts } from "./testing/canvas";
import { installCodecs } from "./testing/codecs";

/**
 * The documentation's worked example "Diagnostics and Overlay", transcribed
 * from `engines/structured-3d/examples/diagnostics-and-overlay.md` and run
 * against the shipped engine.
 *
 * The page's four modules are carried over below as they are written: the
 * instance with its two engine-scoped sources, the game mode with its four
 * world-scoped ones, the lights actor and the six drones the level places, and
 * the boot module's `createEngine` call. Only the module order changes — a
 * level's actors are declared over the mode's `TAG`, which a single file has to
 * introduce first — and only what a test environment forces is adapted, each
 * adaptation one the engine's own validator pages prescribe:
 *
 * - jsdom performs no layout and hands out no canvas contexts, so the element
 *   the page's `querySelector` finds is a stub canvas whose `webgl2` context a
 *   real `THREE.WebGLRenderer` constructs over, and a `SurfaceMetrics` reports
 *   the size and the device pixel ratio a browser would have measured.
 * - The screen layer is handed in rather than made by the engine, which is what
 *   `EngineOptions.screen` exists for: the overlay draws through that layer's
 *   2D context, so a suite meaning to read the panel's lines has to hold it.
 * - The page's `await engine.run()` drives frames off the host's callback on a
 *   wall clock; a check steps synchronously instead, with `engine.advance` over
 *   a `ConstantClock`, which is what the validators' "Simulation" page fixes.
 *
 * What is asserted is what the page narrates: two registries with two
 * lifetimes, six sources read back in registration order, the panel hidden
 * until the backtick key and then drawing the engine's world line, the
 * instance's lines, the world's, and the metrics line with the renderer's
 * counts under it; the three display shapes formatted their three ways; every
 * source evaluated at the read rather than sampled at registration; the counts
 * read off the renderer after the frame's own render, already six draws of
 * twelve triangles each on the first frame the panel draws, while the timings
 * beside them are still empty; the graph's one column per sample over the last
 * ten seconds of simulated time rather than over the whole run; and the overlay
 * drawn in device space, after the recorder has taken the frame, so it lands on
 * the canvas and outside the recording.
 */

/* -------------------------------------------------------------------------- */
/* src/instance.ts — transcribed                                              */
/* -------------------------------------------------------------------------- */

const BUILD = "patrol 1.4.0";

class PatrolInstance extends GameInstance<null> {
  opens = 0;

  override initialize(api: InitApi): null {
    api.diagnostics.register("build", () => BUILD);
    api.diagnostics.register("opens", () => this.opens);
    return null;
  }

  override worldOpened(): void {
    this.opens += 1;
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/patrol-mode.ts — transcribed                                    */
/* -------------------------------------------------------------------------- */

const TAG = "drone";
const HALF_WIDTH = 8;

class PatrolMode extends GameMode {
  private wave = 1;
  private pace = 1.55;

  override beginPlay(): void {
    const diagnostics = this.world.diagnostics;
    diagnostics.register("wave", () => this.wave);
    diagnostics.register("drones", () => this.world.byTag(TAG).length);
    diagnostics.register("lead", () => {
      const lead = this.world.byTag(TAG)[0];
      if (lead === undefined) return "none";
      const { x, y, z } = lead.transform.position;
      return `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    });
    diagnostics.register("pace", () => this.pace);

    this.world.every(6, () => {
      this.wave += 1;
      this.pace += 0.25;
    });
    this.setPhase("playing");
  }

  override tick(dt: number): void {
    for (const drone of this.world.byTag(TAG)) {
      const { position } = drone.transform;
      const x = position.x + this.pace * dt;
      drone.transform.position = vec3(
        x > HALF_WIDTH ? x - 2 * HALF_WIDTH : x,
        position.y,
        position.z,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed                                                  */
/* -------------------------------------------------------------------------- */

const lights = {
  type: Actor,
  transform: { rotation: quatLookAt(vec3(-0.4, -1, -0.6)) },
  configure: (actor: Actor) => {
    actor.attach(
      new LightComponent({ light: { kind: "hemisphere", intensity: 0.6 } }),
    );
    actor.attach(
      new LightComponent({ light: { kind: "directional", intensity: 2 } }),
    );
  },
};

const drones = Array.from({ length: 6 }, (_, i) => ({
  type: Actor,
  transform: { position: vec3(-6 + i * 2.4, (i % 3) * 1.2 - 1.2, 0) },
  tags: [TAG],
  configure: (actor: Actor) => {
    actor.attach(
      new MeshComponent({
        geometry: { kind: "box", width: 0.6, height: 0.3, depth: 0.3 },
        material: { color: "#7fd1ff" },
      }),
    );
  },
}));

const patrol: GameDefinition<null> = {
  instance: PatrolInstance,
  levels: { patrol: { mode: PatrolMode, actors: [lights, ...drones] } },
  startLevel: "patrol",
};

/* -------------------------------------------------------------------------- */
/* src/main.ts — transcribed, with the forced adaptations                     */
/* -------------------------------------------------------------------------- */

/** The design field the page's boot module declares. */
const DESIGN_WIDTH = 640;
const DESIGN_HEIGHT = 360;

/** Everything the page has, plus the handles a check reads the panel through. */
interface Patrol {
  engine: Engine<null>;
  /** The screen layer's recorded operations — where the overlay draws. */
  screen: Context2dStub;
  /** Where the player's keyboard lands, standing in for the document. */
  target: EventTarget;
}

const built: Engine<null>[] = [];
const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
  while (cleanup.length > 0) cleanup.pop()?.();
  document.body.replaceChildren();
});

/**
 * The page's markup and boot module, adapted only as the header describes.
 *
 * The rig defaults to a device pixel ratio of one over an element laid out at
 * the design size, so a device pixel of either canvas stands on a logical unit
 * and nothing a check reads back has to be undone first. The device-space test
 * asks for two, which is where that stops being the identity.
 */
function boot(options: { dpr?: number; clock?: Clock } = {}): Patrol {
  const stage = createStage({
    cssWidth: DESIGN_WIDTH,
    cssHeight: DESIGN_HEIGHT,
    dpr: options.dpr ?? 1,
  });
  stage.stage.canvas.id = "game";
  document.body.append(stage.stage.canvas);

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");

  const engine = createEngine({
    canvas,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    background: "#05060a",
    game: patrol,
    clock: options.clock ?? new ConstantClock(1000 / 60),
    surface: stage.surface.surface,
    screen: stage.screen.canvas,
  });
  built.push(engine);

  return {
    engine,
    screen: stage.screen.context2d,
    target: stage.surface.target,
  };
}

/** Every line the overlay drew, in the order it drew them. */
function overlayLines(screen: Context2dStub): string[] {
  return screen.opsOf("fillText").map((op) => String(op.text));
}

/** An unrepeated `Backquote` keydown: the engine's overlay key, as a player presses it. */
function pressBackquote(target: EventTarget, repeat = false): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { code: "Backquote", repeat }),
  );
}

/** What every source reports at a given moment, as a plain record. */
function values(engine: Engine<null>): Record<string, unknown> {
  return Object.fromEntries(
    engine.diagnostics().map((reading) => [reading.name, reading.value]),
  );
}

/** The `lead` line as the page's own source computes it, for the drone in front. */
function leadLine(engine: Engine<null>): string {
  const lead = engine.world.byTag(TAG)[0];
  if (lead === undefined) return "none";
  const { x, y, z } = lead.transform.position;
  return `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
}

/**
 * The 2D stub behind the one canvas `act` caused to be made.
 *
 * The recorder builds its compose canvas from the stage canvas's owning
 * document when it is armed, and never hands it out. `installCanvasContexts`
 * gives every such canvas a recording context; watching `createElement` across
 * the arming is what says which canvas that context belongs to.
 */
function captureContext(
  contexts: InstalledContexts,
  act: () => void,
): Context2dStub {
  const made: HTMLCanvasElement[] = [];
  const createElement = document.createElement.bind(document);
  document.createElement = ((tag: string): HTMLElement => {
    const element = createElement(tag);
    if (element instanceof HTMLCanvasElement) made.push(element);
    return element;
  }) as typeof document.createElement;
  try {
    act();
  } finally {
    document.createElement = createElement;
  }

  for (const canvas of made) {
    const stub = contexts.context2dFor(canvas);
    if (stub !== undefined) return stub;
  }
  throw new Error("no canvas took a 2d context");
}

/**
 * The engine's own metrics line: the three frame times, then the counts the
 * renderer reported for the frame it drew most recently. Each figure prints
 * whole when it is an integer and to three decimal places when it is not,
 * which is the same rule the registered values follow.
 */
const METRICS_LINE =
  /^frame: \d+(?:\.\d{3})? \/ \d+(?:\.\d{3})? \/ \d+(?:\.\d{3})? ms · (\d+) draws · (\d+) tris$/;

/* -------------------------------------------------------------------------- */
/* What the page narrates                                                     */
/* -------------------------------------------------------------------------- */

describe("examples: diagnostics and overlay", () => {
  it("registers both registries at boot yet draws nothing while the overlay is hidden", async () => {
    const { engine, screen } = boot();
    const instance = await engine.initialize();

    // "`initialize` runs once, before the start level opens" and
    // "`worldOpened` runs after each world's game mode has begun play", so the
    // start level is counted before the first frame.
    expect(instance).toBeInstanceOf(PatrolInstance);
    if (!(instance instanceof PatrolInstance)) throw new Error("unreachable");
    expect(instance.opens).toBe(1);

    // "The world line counts seven actors: the six drones and the actor
    // carrying the lights."
    expect(engine.world.byTag(TAG)).toHaveLength(6);
    expect(engine.world.actors()).toHaveLength(7);

    // Two sources from the instance and four from the mode — and "the boot
    // module registers nothing", so six is the whole of it.
    expect(engine.diagnostics().map((reading) => reading.name)).toEqual([
      "build",
      "opens",
      "wave",
      "drones",
      "lead",
      "pace",
    ]);

    // "The overlay is hidden when the engine is created": a frame draws the
    // picture and no panel, though every source is registered and readable.
    screen.forget();
    await engine.advance(1);
    expect(overlayLines(screen)).toEqual([]);
    expect(engine.diagnostics()).toHaveLength(6);
  });

  it("stands the drones in the default camera's field, lit by the actor that carries the lights", async () => {
    const { engine } = boot();
    await engine.initialize();
    await engine.advance(1);

    // "The drones sit on the `z = 0` plane in front of the camera's default
    // pose, at `(0, 0, 10)` looking along `-Z`" — a pose no level of this game
    // touches, so it is the one the world was built with.
    const camera = engine.world.camera.snapshot();
    expect(camera.position).toEqual(vec3(0, 0, 10));
    expect(camera.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });

    // Which is why the metrics line counts six draws: every drone projects
    // inside the design field, so nothing the level placed is culled away.
    for (const drone of engine.world.byTag(TAG)) {
      const at = engine.world.camera.worldToLogical(drone.transform.position);
      expect(at.visible).toBe(true);
      expect(at.x).toBeGreaterThan(0);
      expect(at.x).toBeLessThan(DESIGN_WIDTH);
      expect(at.y).toBeGreaterThan(0);
      expect(at.y).toBeLessThan(DESIGN_HEIGHT);
    }

    // "A `MeshComponent` under the `standard` material takes its shading from
    // those lights, which is what the `shaded` render mode draws": six meshes
    // and the two lights one actor carries, drawn under the mode the pipeline
    // holds until something sets another.
    const placed: string[] = [];
    engine.scene.traverse((object) => placed.push(object.type));
    expect(placed.filter((type) => type === "Mesh")).toHaveLength(6);
    expect(placed).toContain("HemisphereLight");
    expect(placed).toContain("DirectionalLight");
    expect(engine.renderer.mode()).toBe("shaded");

    // "the lights actor gives the directional light a rotation that shines it
    // down and into the field" — a light is aimed by rotating the actor that
    // carries it, so the actor's forward axis is the direction `game.ts` named.
    const carrier = engine.world.actors().find((actor) => !actor.hasTag(TAG));
    expect(carrier).toBeDefined();
    const aim = quatRotate(
      carrier?.transform.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
      FORWARD,
    );
    const wanted = normalize(vec3(-0.4, -1, -0.6));
    expect(aim.x).toBeCloseTo(wanted.x, 12);
    expect(aim.y).toBeCloseTo(wanted.y, 12);
    expect(aim.z).toBeCloseTo(wanted.z, 12);
  });

  it("toggles on Backquote and draws the documented column, each shape formatted its way", async () => {
    const { engine, screen, target } = boot();
    await engine.initialize();

    // Two firings of the six-second timer: wave 1 → 3, pace 1.55 → 2.05.
    await engine.advance(725);

    pressBackquote(target);
    screen.forget();
    await engine.advance(1);

    const lines = overlayLines(screen);

    // "It draws the engine's own world line first, then the instance's
    // sources, then the world's, then a metrics line" — and each value the way
    // its shape dictates: a string as itself, an integer whole, a non-integer
    // to three decimal places.
    expect(lines.slice(0, 7)).toEqual([
      "level: patrol  phase: playing  actors: 7",
      "build: patrol 1.4.0",
      "opens: 1",
      "wave: 3",
      "drones: 6",
      `lead: ${leadLine(engine)}`,
      "pace: 2.050",
    ]);

    // The lead drone is the first the level placed — `byTag` reports in spawn
    // order — so its height and its depth are the ones `game.ts` gave it:
    // `(0 % 3) * 1.2 - 1.2` and zero. Only `x` moves, because only `x` is what
    // `tick` advances.
    expect(leadLine(engine)).toMatch(/^-?\d+\.\d, -1\.2, 0\.0$/);

    // Twelve seconds of that tick is far enough for the band to have folded:
    // exactly one drone has crossed the seam at `HALF_WIDTH` and come back
    // behind where the level placed it, and all six are still inside the band,
    // which is why six of them are still what the renderer draws.
    const placed = drones.map((spec) => spec.transform.position.x);
    const across = engine.world
      .byTag(TAG)
      .map((drone) => drone.transform.position.x);
    expect(across.every((x) => x > -HALF_WIDTH && x <= HALF_WIDTH)).toBe(true);
    expect(across.filter((x, i) => x < (placed[i] ?? 0))).toHaveLength(1);

    // "After the timings come the draw calls and the triangles the renderer
    // issued for the most recent frame ... six boxes are six draws of twelve
    // triangles each, and a light is no draw."
    expect(lines).toHaveLength(8);
    const metrics = METRICS_LINE.exec(lines[7] ?? "");
    expect(metrics).not.toBeNull();
    expect(metrics?.[1]).toBe("6");
    expect(metrics?.[2]).toBe("72");

    // "then the frame-time graph". It sits beside the text and plots "one
    // column per sample", over "a window of the last 10 seconds of simulated
    // time" — so the rectangles the overlay drew are the panel's plate, the
    // plot area behind the columns, and one column for each of the 601 frames
    // whose simulated time falls inside the ten seconds ending at the newest
    // of them. Not one per frame the run has taken: 725 frames were completed
    // before this one, and the window kept 601 of them.
    const WINDOW_FRAMES = 10 * 60 + 1;
    expect(WINDOW_FRAMES).toBeLessThan(725);
    expect(screen.opsOf("fillRect")).toHaveLength(2 + WINDOW_FRAMES);

    // The key toggles both ways, and an auto-repeat is not a press: the
    // overlay is engine chrome rather than a registered action.
    pressBackquote(target);
    pressBackquote(target, true);
    screen.forget();
    await engine.advance(1);
    expect(overlayLines(screen)).toEqual([]);
  });

  it("reports the renderer's counts on the first frame it draws, before it has a frame time to report", async () => {
    const { engine, screen, target } = boot();
    await engine.initialize();

    // The panel is switched on before a single frame has run, so the column it
    // draws is the state `beginPlay` and `game.ts` left behind, read through
    // the very first render.
    pressBackquote(target);
    screen.forget();
    await engine.advance(1);

    expect(overlayLines(screen)).toEqual([
      "level: patrol  phase: playing  actors: 7",
      "build: patrol 1.4.0",
      "opens: 1",
      "wave: 1",
      "drones: 6",
      "lead: -6.0, -1.2, 0.0",
      "pace: 1.550",
      // The counts are "read from the renderer after the scene was rendered",
      // so they are this very frame's own — already "six boxes ... six draws
      // of twelve triangles each, and a light is no draw" — while the three
      // timings are still zero, because no frame has finished being timed and
      // an empty window reports zero for all three.
      "frame: 0 / 0 / 0 ms · 6 draws · 72 tris",
    ]);

    // The lead line rounds the position `game.ts` placed the first drone at:
    // `-6 + 0 * 2.4` across, `(0 % 3) * 1.2 - 1.2` up, on the `z = 0` plane,
    // moved by the one frame of pace that has run since.
    expect(engine.world.byTag(TAG)[0]?.transform.position.x).toBeCloseTo(
      -6 + 1.55 / 60,
      12,
    );

    // And with nothing in the window there is no graph yet: the panel's plate
    // is the only rectangle the overlay drew.
    expect(screen.opsOf("fillRect")).toHaveLength(1);
  });

  it("reads the same values back off the engine, with the overlay hidden", async () => {
    const { engine, screen } = boot();
    await engine.initialize();
    await engine.advance(725);

    screen.forget();

    // The page's own snippet, verbatim.
    const readings = engine.diagnostics();

    expect(readings.map((r) => r.name)).toEqual([
      "build",
      "opens",
      "wave",
      "drones",
      "lead",
      "pace",
    ]);
    expect(readings[0]).toEqual({ name: "build", value: "patrol 1.4.0" });
    expect(readings[3]).toEqual({ name: "drones", value: 6 });

    // "Reading changes nothing the engine holds, and the overlay stays hidden
    // throughout": no line was drawn by the read, and none is drawn by the
    // frame that follows it either.
    const frame = engine.frame();
    expect(overlayLines(screen)).toEqual([]);
    expect(engine.frame()).toEqual(frame);
    await engine.advance(1);
    expect(overlayLines(screen)).toEqual([]);

    // The values are handed over unformatted; the display rules are the
    // panel's alone.
    expect(values(engine)["pace"]).toBeCloseTo(2.05, 12);
    expect(values(engine)["wave"]).toBe(3);
  });

  it("evaluates every source at the read rather than sampling it at registration", async () => {
    const { engine } = boot();
    await engine.initialize();

    // "Each one closes over the object that holds the value rather than over a
    // copy": before a frame has run, each source reports what `beginPlay` and
    // `game.ts` left behind.
    expect(values(engine)).toEqual({
      build: "patrol 1.4.0",
      opens: 1,
      wave: 1,
      drones: 6,
      lead: "-6.0, -1.2, 0.0",
      pace: 1.55,
    });

    // "the engine evaluates every source on each read, so a line reports what
    // the game holds at that instant" — a change made with no frame at all is
    // visible to the very next read, `drones` off the live world and `lead`
    // off the drone that is now in front.
    engine.world.byTag(TAG)[0]?.destroy();
    expect(values(engine)).toMatchObject({
      drones: 5,
      lead: "-3.6, 0.0, 0.0",
    });

    // And a source whose subject is gone returns the placeholder the page's
    // own vocabulary supplies rather than failing the read.
    for (const drone of engine.world.byTag(TAG)) drone.destroy();
    const readings = engine.diagnostics();
    expect(readings.map((reading) => reading.name)).toHaveLength(6);
    expect(values(engine)).toMatchObject({ drones: 0, lead: "none" });
    expect(readings.every((reading) => reading.error === undefined)).toBe(true);
  });

  it("keeps the instance's sources across a transition while the world's are rebuilt", async () => {
    const { engine, screen, target } = boot();
    await engine.initialize();
    await engine.advance(400);
    pressBackquote(target);

    // The transition is honored at the end of the frame that requested it, so
    // the frame after it is the reopened world's first and its overlay reads
    // the fresh state.
    engine.world.open("patrol");
    await engine.advance(1);
    screen.forget();
    await engine.advance(1);

    expect(overlayLines(screen).slice(0, 7)).toEqual([
      "level: patrol  phase: playing  actors: 7",
      "build: patrol 1.4.0",
      // "`build` and `opens` therefore survive every transition, and `opens`
      // counts them" — the instance's counter crossed the transition...
      "opens: 2",
      // ...while "these four are dropped when the world closes", so the mode's
      // own values start the new match over.
      "wave: 1",
      "drones: 6",
      `lead: ${leadLine(engine)}`,
      "pace: 1.550",
    ]);

    // Six sources still, two registries deep: the world's four were dropped
    // with the old world and registered again by the new mode's `beginPlay`.
    expect(engine.diagnostics().map((reading) => reading.name)).toEqual([
      "build",
      "opens",
      "wave",
      "drones",
      "lead",
      "pace",
    ]);
  });

  it("draws in device space, after the recorder has taken the frame", async () => {
    const codecs = installCodecs();
    const contexts = installCanvasContexts();
    cleanup.push(
      () => codecs.uninstall(),
      () => contexts.uninstall(),
    );

    // Two device pixels to the logical unit, which is where "in device space"
    // stops being the identity the default rig makes it.
    const { engine, screen, target } = boot({ dpr: 2 });
    await engine.initialize();
    pressBackquote(target);

    // The recorder composes each frame onto a canvas it makes when it is
    // armed. Catching that canvas is what lets the order of the capture and
    // the overlay be read back across two surfaces that record separately.
    const capture = captureContext(contexts, () => engine.startRecording());

    // Where the screen layer stood each time the recorder read it. The
    // overlay's own drawing has to come after every one of those marks.
    const marks: number[] = [];
    const compose = capture.ctx.drawImage.bind(capture.ctx);
    capture.ctx.drawImage = ((
      ...args: Parameters<CanvasRenderingContext2D["drawImage"]>
    ): void => {
      marks.push(screen.ops.length);
      compose(...args);
    }) as CanvasRenderingContext2D["drawImage"];

    screen.forget();
    await engine.advance(1);

    // "It is drawn on the screen layer in device space, after the recorder has
    // captured the frame": the stage and the screen layer were both composed
    // into the recording before the panel put a single line on the layer.
    const firstLine = screen.names().indexOf("fillText");
    expect(marks).toHaveLength(2);
    expect(firstLine).toBeGreaterThan(0);
    for (const mark of marks) expect(mark).toBeLessThan(firstLine);

    // The screen pass itself draws under the letterbox fit — two device pixels
    // to the logical unit at this ratio — which is what makes the identity
    // below the engine putting the layer back into device space for its own
    // chrome, rather than a transform that was the identity all along.
    expect(screen.ops.some((op) => op.transform[0] === 2)).toBe(true);

    // "It is drawn on the screen layer in device space": every line of the
    // panel lands in device pixels, whatever the fit is doing to the game's
    // own screen-space drawing.
    const drawn = screen.opsOf("fillText");
    expect(drawn.length).toBeGreaterThan(7);
    for (const op of drawn) expect(op.transform).toEqual([1, 0, 0, 1, 0, 0]);

    // "so it appears on the canvas and outside every recording" — three armed
    // frames, each composed before its own overlay drew, which is the whole of
    // what keeps the panel off the video.
    await engine.advance(2);
    const recording = await engine.stopRecording();
    expect(recording.frames).toHaveLength(3);
  });
});
