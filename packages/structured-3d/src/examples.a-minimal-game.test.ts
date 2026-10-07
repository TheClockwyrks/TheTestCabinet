import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";

import type { Clock, Engine, GameDefinition } from "./index";
import {
  Actor,
  ConstantClock,
  GameInstance,
  GameMode,
  JitterClock,
  LightComponent,
  MeshComponent,
  SequenceClock,
  TextComponent,
  createEngine,
  quatFromEuler,
  vec3,
} from "./index";
import {
  createSurface,
  installCanvasContexts,
  type Context2dStub,
} from "./testing/canvas";
import type { GlStub } from "./testing/gl";

/**
 * The documentation's worked example "A Minimal Game", transcribed and run.
 *
 * The docs promise the example's code works against the engine verbatim, so the
 * game-side modules below — `Lamp`, `Drifter`, `Readout`, `DriftMode`, and the
 * `drifter` definition — are copied from the page unchanged, and the boot module
 * is followed line for line. Only what a test environment forces is adapted:
 *
 * - The page's `index.html` becomes jsdom markup, and jsdom supplies no canvas
 *   implementation at all, so every canvas in the document is given the stubs
 *   from `./testing/canvas` — a WebGL2 context a real `THREE.WebGLRenderer`
 *   constructs over for the stage, and a recording 2D context for the screen
 *   layer. The engine makes that screen canvas for itself, from the stage
 *   canvas's owning document, so it is caught as it is created rather than
 *   handed in, which keeps the page's `createEngine` call the page's own.
 * - jsdom performs no layout either, so the canvas the page sizes with
 *   `100vw`/`100vh` reports zero, and the engine is handed a `SurfaceMetrics`
 *   reporting the size the page intends. Its device pixel ratio is deliberately
 *   `2` rather than `1`: the readout's coordinates are logical units, and at a
 *   ratio of one a device pixel and a logical unit would be indistinguishable.
 * - The page's `engine.run()` drives frames off the host's callback on a
 *   `WallClock`; a suite steps synchronously instead, with `engine.advance` over
 *   a clock that supplies its own deltas, exactly as the validator docs
 *   prescribe.
 *
 * The assertions are the outcomes the page narrates: what `initialize` resolves
 * having done, the plain `GameInstance` an instance-less definition gets, what
 * each actor's constructor settles before it belongs to a world, the identity
 * transform the lamp and the drifter sit at against the readout's screen-space
 * placement, the field the default camera sees at the `z = 0` plane and the
 * bound of `8` that keeps the box inside it, the reflection off both walls and
 * the step-size independence the overshoot arithmetic buys, the background the
 * page names reaching the clear and the fit the page's inline sizing implies,
 * the mesh and the two lights the pipeline puts in the scene, and the readout
 * drawing this frame's position in logical units — having found the drifter in
 * `beginPlay` whatever order the level declared the two in.
 */

/* -------------------------------------------------------------------------- */
/* src/actors/lamp.ts — transcribed verbatim                                  */
/* -------------------------------------------------------------------------- */

class Lamp extends Actor {
  constructor() {
    super();
    this.attach(
      new LightComponent({ light: { kind: "hemisphere", intensity: 0.6 } }),
    );
    const sun = this.attach(
      new LightComponent({ light: { kind: "directional", intensity: 1.2 } }),
    );
    sun.offset.rotation = quatFromEuler(-Math.PI / 4, Math.PI / 4, 0);
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/drifter.ts — transcribed verbatim                               */
/* -------------------------------------------------------------------------- */

const BOX = 1;
const SPEED = 6;
const LIMIT = 8;

class Drifter extends Actor {
  private vx = SPEED;

  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "box", width: BOX, height: BOX, depth: BOX },
        material: { color: "#7fd1ff", roughness: 0.6 },
      }),
    );
  }

  override tick(dt: number): void {
    const half = BOX / 2;
    const limit = LIMIT - half;
    const current = this.transform.position;
    let x = current.x + this.vx * dt;

    if (x < -limit) {
      x = -2 * limit - x;
      this.vx = SPEED;
    } else if (x > limit) {
      x = 2 * limit - x;
      this.vx = -SPEED;
    }
    this.transform.position = vec3(x, current.y, current.z);
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/readout.ts — transcribed verbatim                               */
/* -------------------------------------------------------------------------- */

class Readout extends Actor {
  readonly label = this.attach(
    new TextComponent({ text: "", font: "20px monospace", fill: "#e6edf6" }),
  );
  private drifter: Drifter | null = null;

  override beginPlay(): void {
    this.drifter = this.world.find(Drifter);
  }

  override tick(): void {
    if (this.drifter === null) return;
    this.label.text = `x ${this.drifter.transform.position.x.toFixed(2)}`;
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/drift-mode.ts — transcribed verbatim                            */
/* -------------------------------------------------------------------------- */

class DriftMode extends GameMode {}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const drifter: GameDefinition = {
  levels: {
    drift: {
      mode: DriftMode,
      actors: [
        { type: Lamp },
        { type: Drifter },
        { type: Readout, transform: { position: { x: 320, y: 24, z: 0 } } },
      ],
    },
  },
  startLevel: "drift",
};

/* -------------------------------------------------------------------------- */
/* index.html + src/main.ts — transcribed, with the forced adaptations        */
/* -------------------------------------------------------------------------- */

/** The logical design size the page hands `createEngine`. */
const WIDTH = 640;
const HEIGHT = 360;

/**
 * The device pixel ratio the surface reports, and therefore the scale the
 * viewport fits the design field onto the backing store at. Two rather than one
 * so a logical unit and a device pixel are distinguishable in what was drawn.
 */
const DPR = 2;

/** An engine booted the way the page boots one, and the surfaces it drew on. */
interface Booted {
  engine: Engine;
  /** The WebGL2 context the page's own canvas hands out, recording. */
  gl: GlStub;
  /** The 2D context the engine's own screen canvas hands out, recording. */
  screen: Context2dStub;
  /** Undoes the patches this boot installed on the document. */
  teardown(): void;
}

/** What a test varies about the boot. Every default is the page's own value. */
interface BootOptions {
  /** The clock the frames come off, in place of the page's `WallClock`. */
  clock?: Clock;
  /** The size the element reports, which jsdom computes for nothing. */
  cssWidth?: number;
  cssHeight?: number;
  /** The definition to run, for the one test that reorders the level. */
  game?: GameDefinition;
}

/** Every boot's teardown, run after the test that made it. */
const booted: Booted[] = [];

afterEach(() => {
  while (booted.length > 0) booted.pop()?.teardown();
  document.body.innerHTML = "";
});

/**
 * The page's markup and boot module, adapted only as the header describes.
 *
 * `document.createElement` is wrapped for the length of the `createEngine` call
 * so the screen canvas the engine makes for itself is caught. It is never
 * inserted into the document, and the engine hands out no reference to it, so
 * intercepting its construction is the only way a suite reads what the screen
 * pass drew without taking the `screen` option the page does not pass.
 */
function boot(options: BootOptions = {}): Booted {
  const {
    clock = new ConstantClock(1000 / 60),
    cssWidth = WIDTH,
    cssHeight = HEIGHT,
    game = drifter,
  } = options;

  document.body.innerHTML =
    '<canvas id="game" style="display: block; width: 100vw; height: 100vh"></canvas>';
  const contexts = installCanvasContexts();

  const made: HTMLCanvasElement[] = [];
  const create = document.createElement.bind(document);
  document.createElement = ((tag: string): Element => {
    const element = create(tag);
    if (element instanceof HTMLCanvasElement) made.push(element);
    return element;
  }) as typeof document.createElement;

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");

  const engine = createEngine({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    background: "#05060a",
    game,
    clock,
    surface: createSurface({ cssWidth, cssHeight, dpr: DPR }).surface,
  });

  // The wrapper was an own property over the prototype's method; removing it
  // puts jsdom's own back for everything that runs after the boot.
  Reflect.deleteProperty(document, "createElement");

  const gl = contexts.glFor(canvas);
  if (gl === undefined) throw new Error("the stage canvas took no context");

  const created = made[0];
  if (created === undefined) throw new Error("the engine created no canvas");
  const screen = contexts.context2dFor(created);
  if (screen === undefined)
    throw new Error("the screen canvas took no context");

  const handle: Booted = {
    engine,
    gl,
    screen,
    teardown: () => {
      engine.destroy();
      contexts.uninstall();
    },
  };
  booted.push(handle);
  return handle;
}

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

/** The identity transform every actor the level places starts from. */
const IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

/** The lane the drifter's centre folds inside: half a box in from each limit. */
const LANE = LIMIT - BOX / 2;

/**
 * Where the drifter is after `t` seconds, from the page's own arithmetic:
 * uniform motion at `SPEED` from the origin, folded back into `[-LANE, LANE]`
 * at each limit. Reflecting the overshoot makes the per-frame stepping agree
 * with this continuous fold whatever the step size, which is the property the
 * page claims for it.
 */
function expectedX(t: number): number {
  const span = 2 * LANE;
  const raw = (LANE + SPEED * t) % (2 * span);
  return -LANE + (raw < span ? raw : 2 * span - raw);
}

/** Steps in whole frames until at least `ms` of simulated time has passed. */
async function advanceMs(engine: Engine, ms: number): Promise<void> {
  const until = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < until) await engine.advance(1);
}

/** The one mesh the pipeline placed in the scene for the drifter's component. */
function boxOf(engine: Engine): THREE.Mesh {
  const meshes = engine.scene.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh,
  );
  expect(meshes).toHaveLength(1);
  const mesh = meshes[0];
  if (mesh === undefined) throw new Error("no mesh in the scene");
  return mesh;
}

/** The first light of `kind` the pipeline placed in the scene. */
function lightOf<L extends THREE.Light>(
  engine: Engine,
  kind: new (...args: never[]) => L,
): L {
  const found = engine.scene.children.find(
    (child): child is L => child instanceof kind,
  );
  if (found === undefined) throw new Error(`no ${kind.name} in the scene`);
  return found;
}

describe("examples/a-minimal-game", () => {
  it("initialize opens the start level with its three actors and its mode begun", async () => {
    const { engine } = boot();
    const opened: string[] = [];
    engine.events.on("world:opened", ({ level }) => opened.push(level));

    await engine.initialize();

    // "`initialize` builds the game instance, opens the start level, and
    // resolves once its actors and its mode have begun play."
    expect(opened).toEqual(["drift"]);
    expect(engine.world.level).toBe("drift");
    expect(engine.world.mode).toBeInstanceOf(DriftMode);

    // "The level declares its three actors and the mode it runs under" — spawned
    // in the order the definition lists them.
    const actors = engine.world.actors();
    expect(actors).toHaveLength(3);
    expect(actors[0]).toBeInstanceOf(Lamp);
    expect(actors[1]).toBeInstanceOf(Drifter);
    expect(actors[2]).toBeInstanceOf(Readout);

    // "The lamp and the drifter sit at the identity transform, which is the
    // world origin, and the readout's transform is a screen-space placement in
    // logical units." The readout's spec gives a position alone, so its
    // rotation and scale are filled from the identity.
    expect(actors[0]?.transform).toEqual(IDENTITY);
    expect(actors[1]?.transform).toEqual(IDENTITY);
    expect(actors[2]?.transform).toEqual({
      position: { x: 320, y: 24, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it("builds a plain GameInstance for a definition naming no instance class", async () => {
    const { engine } = boot();
    await engine.initialize();

    // "The definition names no instance class, so the engine builds a plain
    // `GameInstance`" — the base class itself, whose `initialize` returns
    // `null`, which the engine hands back as the debug surface.
    expect(Object.getPrototypeOf(engine.instance)).toBe(GameInstance.prototype);
    expect(engine.debug).toBeNull();
  });

  it("settles each actor in its constructor, before it belongs to a world", () => {
    // "Each actor's constructor attaches the components that draw it and sets
    // its defaults, which is everything an actor settles before it belongs to a
    // world." Constructed outside any world — no `createEngine`, no level — the
    // three classes the page writes already carry everything that draws them,
    // which is why the level can declare them as bare types.
    const lamp = new Lamp();
    expect(lamp.components).toHaveLength(2);
    expect(
      lamp.components.every((part) => part instanceof LightComponent),
    ).toBe(true);

    const box = new Drifter();
    expect(box.components).toHaveLength(1);
    expect(box.components[0]).toBeInstanceOf(MeshComponent);

    // The readout attaches its label in a field initializer, so `label` is the
    // component the actor holds rather than a second one built beside it, and
    // it carries the empty string until a tick writes over it.
    const readout = new Readout();
    expect(readout.components).toEqual([readout.label]);
    expect(readout.label.text).toBe("");
  });

  it("registers no action and loads no asset", async () => {
    const { engine } = boot();
    const assets: string[] = [];
    engine.events.on("asset:loaded", ({ path }) => assets.push(path));
    engine.events.on("asset:failed", ({ path }) => assets.push(path));

    await engine.initialize();
    await engine.advance(10);

    // The level declares no `load`, so nothing is fetched. Registration belongs
    // to a game instance's `initialize` and the definition names no instance
    // class, so the only `initialize` that ran was the base's; the mode adds no
    // player either, so nothing in the game holds an input reader at all.
    expect(assets).toEqual([]);
    expect(engine.world.players()).toEqual([]);
    expect(engine.world.controllers()).toEqual([]);
  });

  it("runs the level under a game mode that overrides nothing", async () => {
    const { engine } = boot();
    await engine.initialize();

    // "The base game mode's `beginPlay`, `tick`, and `endPlay` do nothing, so
    // `DriftMode` overrides nothing."
    expect(Object.getOwnPropertyNames(DriftMode.prototype)).toEqual([
      "constructor",
    ]);
    expect(Object.getPrototypeOf(DriftMode.prototype)).toBe(GameMode.prototype);

    // A mode that overrides nothing still runs the level's frames.
    await engine.advance(4);
    expect(engine.frame().count).toBe(4);
    expect(engine.world.mode).toBeInstanceOf(DriftMode);
  });

  it("sees about 5.8 units up and down and 10.3 across at the z = 0 plane", async () => {
    const { engine } = boot();
    await engine.initialize();
    const { camera } = engine.world;

    // "The world's camera starts at `(0, 0, 10)` looking along `-Z` at the
    // origin with a vertical field of view of `60` degrees."
    expect(camera.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(camera.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(camera.projection).toBe("perspective");
    expect(camera.fov).toBe(60);

    // "so at the `z = 0` plane it sees about `5.8` units up and down and `10.3`
    // units left and right" — the half-extents of the frustum ten units out,
    // read back off the camera's own projection rather than asserted as
    // arithmetic: the top of the field lands on logical `y = 0` and the right
    // of it on logical `x = 640`.
    const halfHeight = 10 * Math.tan((Math.PI / 180) * 30);
    const halfWidth = halfHeight * (WIDTH / HEIGHT);
    expect(halfHeight).toBeCloseTo(5.8, 1);
    expect(halfWidth).toBeCloseTo(10.3, 1);
    expect(camera.worldToLogical(vec3(0, halfHeight, 0)).y).toBeCloseTo(0, 6);
    expect(camera.worldToLogical(vec3(0, -halfHeight, 0)).y).toBeCloseTo(
      360,
      6,
    );
    expect(camera.worldToLogical(vec3(halfWidth, 0, 0)).x).toBeCloseTo(640, 6);
    expect(camera.worldToLogical(vec3(-halfWidth, 0, 0)).x).toBeCloseTo(0, 6);

    // "a bound of `8` keeps the box in view at both ends. A box is centered on
    // its component's transform, so the bounds sit half a box in from each
    // limit." The lane ends half a box in, so the box's outer face is at the
    // limit itself, and the whole face is inside the frustum at both ends.
    expect(LANE).toBe(7.5);
    for (const x of [LIMIT, -LIMIT]) {
      for (const y of [BOX / 2, -BOX / 2]) {
        const corner = camera.worldToLogical(vec3(x, y, BOX / 2));
        expect(corner.visible).toBe(true);
      }
    }
  });

  it("drifts at SPEED and reflects the overshoot off both limits", async () => {
    const { engine } = boot();
    await engine.initialize();
    const actor = engine.world.find(Drifter);
    if (actor === null) throw new Error("missing drifter");

    // The drifter starts at the world origin and carries a box a unit across.
    expect(actor.transform.position).toEqual({ x: 0, y: 0, z: 0 });

    // One second from the origin: six units along, no limit reached yet.
    await engine.advance(60);
    expect(actor.transform.position.x).toBeCloseTo(SPEED, 6);

    // The right limit is met at t = 1.25s; by two seconds the drifter has
    // reflected and is heading back left, still inside the lane.
    await engine.advance(60);
    expect(actor.transform.position.x).toBeCloseTo(3, 6);
    const atTwo = actor.transform.position.x;
    await engine.advance(1);
    expect(actor.transform.position.x).toBeLessThan(atTwo);

    // The left limit is met at t = 3.75s. Every frame from here to five seconds
    // lands on the continuous fold, and none leaves the lane the page derives.
    for (let frame = 122; frame <= 300; frame += 1) {
      await engine.advance(1);
      const x = actor.transform.position.x;
      expect(x).toBeGreaterThanOrEqual(-LANE);
      expect(x).toBeLessThanOrEqual(LANE);
      expect(x).toBeCloseTo(expectedX(engine.frame().timeMs / 1000), 6);
    }

    // Five seconds is a whole there-and-back-and-there again: the drifter is
    // back at the origin, having reflected off both limits, and heading right.
    expect(engine.frame().count).toBe(300);
    expect(actor.transform.position.x).toBeCloseTo(0, 6);
    const atFive = actor.transform.position.x;
    await engine.advance(1);
    expect(actor.transform.position.x).toBeGreaterThan(atFive);

    // "The transform is a plain record, so the move is an assignment of a fresh
    // vector built with `vec3`." The record the actor holds is replaced each
    // frame rather than written through, and the move is along X alone: the
    // fresh vector carries the other two components over unchanged.
    const held = actor.transform.position;
    const heldX = held.x;
    await engine.advance(1);
    expect(actor.transform.position).not.toBe(held);
    expect(actor.transform.position.x).not.toBe(heldX);
    expect(held.x).toBe(heldX);
    expect(actor.transform.position.y).toBe(0);
    expect(actor.transform.position.z).toBe(0);
  });

  it("keeps the outcome the same whatever step size the clock delivers", async () => {
    // "`tick` multiplies by `dt` in seconds and reflects the overshoot back
    // into the lane, which keeps the outcome the same whatever step size the
    // clock delivers." An even step, a repeating uneven pattern, and a seeded
    // draw all land on the fold of the same uniform motion.
    const clocks = [
      new ConstantClock(1000 / 60),
      new SequenceClock([8, 33, 12, 21]),
      new JitterClock(8, 40, 7),
    ];

    for (const clock of clocks) {
      const { engine } = boot({ clock });
      await engine.initialize();
      const actor = engine.world.find(Drifter);
      if (actor === null) throw new Error("missing drifter");

      // Long enough to cross both limits, whatever the cadence.
      await advanceMs(engine, 5000);
      expect(actor.transform.position.x).toBeCloseTo(
        expectedX(engine.frame().timeMs / 1000),
        6,
      );
    }
  });

  it("clears the whole canvas to the background the page names", async () => {
    const { engine, gl } = boot();
    await engine.initialize();
    gl.forget();
    await engine.advance(1);

    // The page passes `background: "#05060a"`, the same color its body carries,
    // so the field behind the box and the letterbox bars around it are the
    // page's own rather than the renderer's default.
    const cleared = gl.callsTo("clearColor");
    expect(cleared.length).toBeGreaterThan(0);
    const [red, green, blue, alpha] = cleared[0]?.args as [
      number,
      number,
      number,
      number,
    ];
    expect(red).toBeCloseTo(0x05 / 255, 6);
    expect(green).toBeCloseTo(0x06 / 255, 6);
    expect(blue).toBeCloseTo(0x0a / 255, 6);
    // A named background is opaque; transparency is what an absent one means.
    expect(alpha).toBe(1);
    expect(gl.callsTo("clear").length).toBeGreaterThan(0);
  });

  it("fits the logical field into whatever size the element reports", async () => {
    // "The canvas carries its size inline, so the engine fits the logical field
    // into whatever size the element reports." An element measuring 900 by 360
    // is wider than the 640 by 360 field the page asks for, so the fit takes
    // the smaller of the two ratios and splits the leftover width in two.
    const { engine, gl, screen } = boot({ cssWidth: 900, cssHeight: HEIGHT });
    await engine.initialize();
    gl.forget();
    screen.forget();
    await engine.advance(1);

    expect(engine.viewport()).toEqual({
      width: WIDTH,
      height: HEIGHT,
      scale: DPR,
      offsetX: (900 * DPR - WIDTH * DPR) / 2,
      offsetY: 0,
    });

    // The world pass draws into the letterboxed rectangle in device pixels,
    // with the scissor holding the picture inside it.
    const letterbox = [260, 0, WIDTH * DPR, HEIGHT * DPR];
    expect(gl.callsTo("viewport").map((call) => call.args)).toContainEqual(
      letterbox,
    );
    expect(gl.callsTo("scissor").map((call) => call.args)).toContainEqual(
      letterbox,
    );

    // The screen layer draws through the same fit, so the readout still names
    // logical (320, 24) and the transform in force is what carries it past the
    // left bar onto the picture.
    const drawn = screen.opsOf("fillText");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.args.slice(1)).toEqual([320, 24]);
    expect(drawn[0]?.transform).toEqual([DPR, 0, 0, DPR, 260, 0]);
  });

  it("draws the box through the camera at the actor's world transform", async () => {
    const { engine } = boot();
    await engine.initialize();
    const actor = engine.world.find(Drifter);
    if (actor === null) throw new Error("missing drifter");

    await engine.advance(1);

    // "Drawing belongs to the `MeshComponent`, which the pipeline places at the
    // actor's world transform each frame and renders through the camera, and a
    // `standard` material takes its shading from the lamp's lights."
    const box = boxOf(engine);
    const geometry = box.geometry as THREE.BoxGeometry;
    expect(geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(geometry.parameters.width).toBe(BOX);
    expect(geometry.parameters.height).toBe(BOX);
    expect(geometry.parameters.depth).toBe(BOX);

    const material = box.material as THREE.MeshStandardMaterial;
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(`#${material.color.getHexString()}`).toBe("#7fd1ff");
    expect(material.roughness).toBe(0.6);

    // The mesh is the same object frame after frame, moved rather than rebuilt,
    // and it stands where this frame's tick left the actor.
    for (let step = 0; step < 5; step += 1) {
      await engine.advance(1);
      expect(boxOf(engine)).toBe(box);
      expect(box.position.x).toBeCloseTo(actor.transform.position.x, 6);
      expect(box.position.y).toBe(0);
      expect(box.position.z).toBe(0);
    }
  });

  it("lights the box from above and to one side with the lamp's two lights", async () => {
    const { engine } = boot();
    await engine.initialize();
    await engine.advance(1);

    // "The hemisphere light fills the faces the sun leaves in shadow."
    const fill = lightOf(engine, THREE.HemisphereLight);
    expect(fill.intensity).toBe(0.6);

    const sun = lightOf(engine, THREE.DirectionalLight);
    expect(sun.intensity).toBe(1.2);

    // "A directional light shines along its component's world forward axis, so
    // the offset's rotation is what aims it: a pitch of a quarter turn down and
    // a yaw of a quarter turn to the side lights the box from above and to one
    // side." `FORWARD` is `(0, 0, -1)`; the quarter-turn pitch and yaw carry it
    // to `(-0.5, -√½, -0.5)`, which points down and across.
    engine.scene.updateMatrixWorld(true);
    const from = sun.getWorldPosition(new THREE.Vector3());
    const to = sun.target.getWorldPosition(new THREE.Vector3());
    const aim = to.sub(from).normalize();
    expect(aim.x).toBeCloseTo(-0.5, 6);
    expect(aim.y).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(aim.z).toBeCloseTo(-0.5, 6);
    expect(aim.y).toBeLessThan(0);

    // The lamp itself never moved, so the sun shines from the world origin.
    expect(from.toArray()).toEqual([0, 0, 0]);
  });

  it("writes the position this frame's tick produced, in logical units", async () => {
    const { engine, screen } = boot();
    await engine.initialize();
    const actor = engine.world.find(Drifter);
    const readout = engine.world.find(Readout);
    if (actor === null || readout === null) throw new Error("missing actor");

    // The label is the component the constructor attached, and nothing has
    // ticked yet, so it still carries the empty string it was built with.
    expect(readout.component(TextComponent)).toBe(readout.label);
    expect(readout.label.text).toBe("");

    // "Actors tick in spawn order and the readout is declared after the
    // drifter, so the text it writes is the position this frame's tick
    // produced." The drifter moves every frame, so a readout that lagged by one
    // would disagree on every one of them.
    for (let step = 0; step < 5; step += 1) {
      screen.forget();
      await engine.advance(1);
      const drawn = screen.opsOf("fillText");
      expect(drawn).toHaveLength(1);
      const op = drawn[0];
      const expected = `x ${actor.transform.position.x.toFixed(2)}`;
      expect(readout.label.text).toBe(expected);
      expect(op?.text).toBe(expected);
      expect(op?.fill).toBe("#e6edf6");
      // "its actor's position is logical units from the top-left of the design
      // field": the coordinates are the actor's, and the fit from logical units
      // onto the backing store rides in the transform in force.
      expect(op?.args.slice(1)).toEqual([320, 24]);
      expect(op?.transform).toEqual([DPR, 0, 0, DPR, 0, 0]);
    }
  });

  it("holds the readout in place whatever the camera does", async () => {
    const { engine, screen } = boot();
    await engine.initialize();

    // "The readout is a screen-space component ... and the camera plays no part
    // in where it draws."
    engine.world.camera.position = vec3(40, -25, 3);
    engine.world.camera.rotation = quatFromEuler(0.3, -0.8, 0.2);
    engine.world.camera.fov = 25;

    screen.forget();
    await engine.advance(1);

    // The camera really did move — the frame rendered through the pose above,
    // so the readout holding still is a claim about the screen pass and not
    // about an assignment that went nowhere.
    const snapshot = engine.world.camera.snapshot();
    expect(snapshot.position).toEqual({ x: 40, y: -25, z: 3 });
    expect(snapshot.fov).toBe(25);

    const drawn = screen.opsOf("fillText");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.args.slice(1)).toEqual([320, 24]);
    expect(drawn[0]?.transform).toEqual([DPR, 0, 0, DPR, 0, 0]);
  });

  it("lets the readout find the drifter whatever order the level declared them in", async () => {
    // "Every actor a level declares exists before any of their `beginPlay`
    // runs, so the readout finds the drifter there with `world.find`." The
    // page's own level declares the drifter first, which a spawn that ran each
    // `beginPlay` as it went would also satisfy; the same three actors with the
    // readout declared first is what separates the two.
    const reordered: GameDefinition = {
      levels: {
        drift: {
          mode: DriftMode,
          actors: [
            { type: Readout, transform: { position: { x: 320, y: 24, z: 0 } } },
            { type: Lamp },
            { type: Drifter },
          ],
        },
      },
      startLevel: "drift",
    };

    const { engine } = boot({ game: reordered });
    await engine.initialize();
    const readout = engine.world.find(Readout);
    if (readout === null) throw new Error("missing readout");
    expect(engine.world.actors()[0]).toBe(readout);

    // It found its peer: a readout that had not would write nothing at all.
    await engine.advance(1);
    expect(readout.label.text).toBe("x 0.00");

    // And the flip side of the page's closing claim: the readout now ticks
    // first, so the text it writes is the position the drifter carried into the
    // frame rather than the one this frame produced, one step behind.
    await engine.advance(1);
    expect(readout.label.text).toBe(`x ${(SPEED / 60).toFixed(2)}`);
    const actor = engine.world.find(Drifter);
    expect(actor?.transform.position.x).toBeCloseTo((2 * SPEED) / 60, 6);
  });
});
