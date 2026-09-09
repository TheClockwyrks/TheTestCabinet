import { afterEach, describe, expect, it, vi } from "vitest";
import { Actor } from "./actors";
import { WorldCamera } from "./camera";
import { ColliderComponent } from "./collision";
import {
  CameraComponent,
  DrawComponent,
  ShapeComponent,
  SpriteComponent,
  TextComponent,
} from "./components";
import type { Camera, DrawApi, FrameInfo, Viewport, World } from "./contract";
import { RenderPipeline, type RenderScene } from "./rendering";

/**
 * Unit tests over the pipeline alone, driven against a hand-written context
 * and a world reduced to the two members the pipeline reads: `actors()` and
 * `camera`. The engine's own suite covers when `render` is called; what is
 * checked here is what one call draws — the clear, the order, the transforms,
 * the four modes, and the collision overlay.
 */

/** One recorded operation: a call with its arguments, or a property set. */
type Logged = string;

interface Stub {
  ctx: CanvasRenderingContext2D;
  log: Logged[];
}

/** A number as the log writes it, so an assertion reads like the drawing. */
function num(value: unknown): string {
  if (typeof value !== "number") return String(value);
  // `-0` prints as `0`, and long doubles are rounded so a transform assertion
  // is legible.
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded === 0 ? 0 : rounded);
}

/**
 * A context that records what reached it: every method call with its
 * arguments, and every property assignment. Separate entries for sets, so a
 * test can assert the style in force when a paint was issued.
 */
function contextStub(width = 800, height = 450): Stub {
  const log: Logged[] = [];
  const base: Record<string, unknown> = {
    canvas: { width, height },
  };
  const method =
    (name: string) =>
    (...args: unknown[]): void => {
      log.push(`${name}(${args.map(num).join(",")})`);
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
    "clip",
  ]) {
    base[name] = method(name);
  }
  const proxy = new Proxy(base, {
    set(subject, property, value): boolean {
      log.push(`set:${String(property)}=${num(value)}`);
      return Reflect.set(subject, property, value, subject);
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, log };
}

/**
 * Where `entry` first appears after the pipeline's clip on the logical field,
 * whose own viewport transform precedes every component's.
 */
function afterClip(log: string[], entry: string): number {
  return log.indexOf(entry, log.indexOf("clip()") + 1);
}

/** A world reduced to what the pipeline reads. */
function fakeWorld(actors: Actor[], camera?: Camera): World {
  const view = camera ?? new WorldCamera(640, 360);
  return {
    actors: (): readonly Actor[] => actors.filter((actor) => actor.alive),
    camera: view,
  } as unknown as World;
}

/** A scene over `actors`, with everything else at its simplest. */
function scene(
  actors: Actor[],
  overrides: Partial<RenderScene> = {},
): { scene: RenderScene; stub: Stub } {
  const stub = contextStub();
  const viewport: Viewport = {
    width: 640,
    height: 360,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  const frame: FrameInfo = { count: 5, timeMs: 100, lastDeltaMs: 16 };
  return {
    stub,
    scene: {
      ctx: stub.ctx,
      world: overrides.world ?? fakeWorld(actors),
      viewport,
      frame,
      background: null,
      imageSmoothing: true,
      width: 640,
      height: 360,
      ...overrides,
    },
  };
}

/** An actor at `(x, y)`, with `components` attached in order. */
function actorWith(
  components: readonly InstanceType<typeof import("./components").Component>[],
  at: { x?: number; y?: number; rotation?: number } = {},
): Actor {
  const actor = new Actor();
  actor.transform.x = at.x ?? 0;
  actor.transform.y = at.y ?? 0;
  actor.transform.rotation = at.rotation ?? 0;
  for (const component of components) actor.attach(component);
  return actor;
}

/** A shape the tests reuse: a filled 10×10 rect. */
function box(fill = "#123456"): ShapeComponent {
  return new ShapeComponent({
    shape: { kind: "rect", width: 10, height: 10 },
    fill,
  });
}

/** The fills issued, in order, with the style each was issued under. */
function fills(log: Logged[]): string[] {
  const found: string[] = [];
  let style = "";
  for (const entry of log) {
    if (entry.startsWith("set:fillStyle=")) style = entry.slice(14);
    if (entry === "fill()" || entry.startsWith("fillRect(")) found.push(style);
  }
  return found;
}

describe("the switches", () => {
  it("holds shaded until the mode is set, then the set mode", () => {
    const pipeline = new RenderPipeline();
    expect(pipeline.mode()).toBe("shaded");
    pipeline.setMode("wireframe");
    expect(pipeline.mode()).toBe("wireframe");
  });

  it("holds the collision overlay off until it is turned on", () => {
    const pipeline = new RenderPipeline();
    expect(pipeline.collisionOverlay()).toBe(false);
    pipeline.setCollisionOverlay(true);
    expect(pipeline.collisionOverlay()).toBe(true);
    pipeline.setCollisionOverlay(false);
    expect(pipeline.collisionOverlay()).toBe(false);
  });
});

describe("the clear", () => {
  it("clears the whole backing store to transparency when no background was given", () => {
    const { scene: frame, stub } = scene([]);
    new RenderPipeline().render(frame);
    expect(stub.log[0]).toBe("setTransform(1,0,0,1,0,0)");
    expect(stub.log[1]).toBe("clearRect(0,0,800,450)");
  });

  it("fills the whole backing store with the background color when one was", () => {
    const { scene: frame, stub } = scene([], { background: "#101018" });
    new RenderPipeline().render(frame);
    expect(stub.log[0]).toBe("setTransform(1,0,0,1,0,0)");
    expect(stub.log[1]).toBe("set:fillStyle=#101018");
    expect(stub.log[2]).toBe("fillRect(0,0,800,450)");
  });

  it("clears before any component draws", () => {
    const { scene: frame, stub } = scene([actorWith([box()])]);
    new RenderPipeline().render(frame);
    expect(stub.log.indexOf("clearRect(0,0,800,450)")).toBeLessThan(
      stub.log.indexOf("fill()"),
    );
  });
});

describe("image smoothing", () => {
  const image = { width: 16, height: 24 } as unknown as ImageBitmap;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets the context's smoothing from the scene after the clear and before any component draws", () => {
    const { scene: frame, stub } = scene(
      [actorWith([new SpriteComponent({ image })])],
      { imageSmoothing: false },
    );
    new RenderPipeline().render(frame);
    const set = stub.log.indexOf("set:imageSmoothingEnabled=false");
    expect(set).toBeGreaterThan(stub.log.indexOf("clearRect(0,0,800,450)"));
    expect(set).toBeLessThan(
      stub.log.findIndex((entry) => entry.startsWith("drawImage(")),
    );
  });

  it("sets it every frame, whatever the frame draws", () => {
    const { scene: frame, stub } = scene([]);
    const pipeline = new RenderPipeline();
    pipeline.render(frame);
    pipeline.render(frame);
    expect(
      stub.log.filter((entry) => entry === "set:imageSmoothingEnabled=true"),
    ).toHaveLength(2);
  });

  it("hands a DrawComponent the context already carrying the setting", () => {
    let seen: boolean | null = null;
    class Probe extends DrawComponent {
      draw(api: DrawApi): void {
        seen = api.ctx.imageSmoothingEnabled;
      }
    }
    const { scene: frame } = scene([actorWith([new Probe()])], {
      imageSmoothing: false,
    });
    new RenderPipeline().render(frame);
    expect(seen).toBe(false);
  });

  it("samples the tint scratch the way the frame does", () => {
    // A host with a second canvas: the scratch is a recording context of its
    // own, so what the tint prepared on it is observable.
    const scratch = contextStub(1, 1);
    vi.spyOn(document, "createElement").mockReturnValue(
      scratch.ctx.canvas as unknown as HTMLElement,
    );
    (scratch.ctx.canvas as unknown as Record<string, unknown>)["getContext"] =
      (): CanvasRenderingContext2D => scratch.ctx;

    const sprite = new SpriteComponent({ image, tint: "#ff0000" });
    const { scene: frame, stub } = scene([actorWith([sprite])], {
      imageSmoothing: false,
    });
    new RenderPipeline().render(frame);

    const set = scratch.log.indexOf("set:imageSmoothingEnabled=false");
    expect(set).toBeGreaterThanOrEqual(0);
    expect(set).toBeLessThan(
      scratch.log.findIndex((entry) => entry.startsWith("drawImage(")),
    );
    // The main context blits the flattened scratch, under its own setting.
    expect(stub.log).toContain("set:imageSmoothingEnabled=false");
    expect(stub.log).toContain("drawImage([object Object],-8,-12,16,24)");
  });
});

describe("collection", () => {
  it("skips an invisible component, a disabled one, and a dead actor", () => {
    const invisible = box();
    invisible.visible = false;
    const disabled = box();
    disabled.enabled = false;
    const dead = actorWith([box()]);
    (dead as { alive: boolean }).alive = false;
    const drawn = box("#00ff00");

    const { scene: frame, stub } = scene([
      actorWith([invisible]),
      actorWith([disabled]),
      dead,
      actorWith([drawn]),
    ]);
    new RenderPipeline().render(frame);
    expect(fills(stub.log)).toEqual(["#00ff00"]);
  });

  it("skips a component that is not a render component", () => {
    const collider = new ColliderComponent({
      shape: { kind: "circle", radius: 4 },
    });
    const { scene: frame, stub } = scene([
      actorWith([collider, box("#aa0000")]),
    ]);
    new RenderPipeline().render(frame);
    expect(fills(stub.log)).toEqual(["#aa0000"]);
  });
});

describe("the sort", () => {
  it("draws layers ascending, and spawn order within a layer", () => {
    const back = box("#back");
    back.layer = -5;
    const front = box("#front");
    front.layer = 10;
    const midFirst = box("#mid1");
    const midSecond = box("#mid2");

    const { scene: frame, stub } = scene([
      actorWith([front]),
      actorWith([midFirst]),
      actorWith([back]),
      actorWith([midSecond]),
    ]);
    new RenderPipeline().render(frame);
    expect(fills(stub.log)).toEqual(["#back", "#mid1", "#mid2", "#front"]);
  });

  it("draws attachment order within one actor", () => {
    const first = box("#first");
    const second = box("#second");
    const { scene: frame, stub } = scene([actorWith([first, second])]);
    new RenderPipeline().render(frame);
    expect(fills(stub.log)).toEqual(["#first", "#second"]);
  });

  it("reproduces the previous order exactly on a redraw with no change", () => {
    const a = box("#a");
    const b = box("#b");
    const c = box("#c");
    b.layer = 1;
    const actors = [actorWith([a]), actorWith([b]), actorWith([c])];

    const first = scene(actors);
    new RenderPipeline().render(first.scene);
    const second = scene(actors);
    new RenderPipeline().render(second.scene);
    expect(fills(second.stub.log)).toEqual(fills(first.stub.log));
    expect(fills(first.stub.log)).toEqual(["#a", "#c", "#b"]);
  });
});

describe("shapes", () => {
  it("draws a rect centered on the component's transform, in world coordinates", () => {
    const { scene: frame, stub } = scene([
      actorWith([box()], { x: 100, y: 50 }),
    ]);
    new RenderPipeline().render(frame);
    // The position rides in the operation's own arguments — no per-component
    // translate — so the stream records the world coordinates the game asked
    // for.
    expect(stub.log).toContain("rect(95,45,10,10)");
    expect(stub.log).not.toContain("translate(100,50)");
  });

  it("pivots a rotated or scaled component about its world position", () => {
    const spun = box();
    const { scene: frame, stub } = scene([
      actorWith([spun], { x: 100, y: 50, rotation: 0.5 }),
    ]);
    new RenderPipeline().render(frame);
    // Rotation earns a transform, applied about the position so the path's
    // arguments stay world coordinates.
    const pivotAt = stub.log.indexOf("translate(100,50)");
    expect(pivotAt).toBeGreaterThan(-1);
    expect(stub.log.slice(pivotAt, pivotAt + 4)).toEqual([
      "translate(100,50)",
      "rotate(0.5)",
      "scale(1,1)",
      "translate(-100,-50)",
    ]);
    expect(stub.log).toContain("rect(95,45,10,10)");
  });

  it("draws a circle as a full arc, and a polygon as its closed outline", () => {
    const circle = new ShapeComponent({
      shape: { kind: "circle", radius: 7 },
      fill: "#fff",
    });
    const polygon = new ShapeComponent({
      shape: {
        kind: "polygon",
        points: [
          { x: 0, y: -4 },
          { x: 4, y: 4 },
          { x: -4, y: 4 },
        ],
      },
      stroke: "#fff",
    });
    const { scene: frame, stub } = scene([actorWith([circle, polygon])]);
    new RenderPipeline().render(frame);
    expect(stub.log).toContain(`arc(0,0,7,0,${num(Math.PI * 2)})`);
    expect(stub.log).toContain("moveTo(0,-4)");
    expect(stub.log).toContain("lineTo(4,4)");
    expect(stub.log).toContain("lineTo(-4,4)");
    expect(stub.log).toContain("closePath()");
  });

  it("fills only with a fill, strokes only with a stroke, and draws nothing with neither", () => {
    const fillOnly = new ShapeComponent({
      shape: { kind: "rect", width: 2, height: 2 },
      fill: "#f00",
    });
    const strokeOnly = new ShapeComponent({
      shape: { kind: "rect", width: 2, height: 2 },
      stroke: "#0f0",
      strokeWidth: 3,
    });
    const neither = new ShapeComponent({
      shape: { kind: "rect", width: 2, height: 2 },
    });

    const { scene: frame, stub } = scene([
      actorWith([fillOnly, strokeOnly, neither]),
    ]);
    new RenderPipeline().render(frame);
    expect(stub.log.filter((entry) => entry === "fill()")).toHaveLength(1);
    expect(stub.log.filter((entry) => entry === "stroke()")).toHaveLength(1);
    const strokeAt = stub.log.indexOf("stroke()");
    expect(stub.log.slice(0, strokeAt)).toContain("set:lineWidth=3");
    expect(stub.log.slice(0, strokeAt)).toContain("set:strokeStyle=#0f0");
  });

  it("clamps opacity into 0..1 at the draw", () => {
    const dim = box();
    dim.opacity = -0.5;
    const bright = box();
    bright.opacity = 1.5;
    const half = box();
    half.opacity = 0.25;

    const { scene: frame, stub } = scene([actorWith([dim, bright, half])]);
    new RenderPipeline().render(frame);
    const alphas = stub.log.filter((entry) =>
      entry.startsWith("set:globalAlpha="),
    );
    expect(alphas).toEqual([
      "set:globalAlpha=0",
      "set:globalAlpha=1",
      "set:globalAlpha=0.25",
    ]);
  });
});

describe("render modes", () => {
  it("wireframe strokes the outline alone, at one width, and ignores the fill", () => {
    const shape = new ShapeComponent({
      shape: { kind: "rect", width: 4, height: 4 },
      fill: "#f00",
      stroke: "#0f0",
      strokeWidth: 9,
    });
    const pipeline = new RenderPipeline();
    pipeline.setMode("wireframe");
    const { scene: frame, stub } = scene([actorWith([shape])]);
    pipeline.render(frame);
    expect(stub.log).not.toContain("fill()");
    expect(stub.log).toContain("stroke()");
    expect(stub.log).toContain("set:lineWidth=1");
    expect(stub.log).not.toContain("set:lineWidth=9");
    expect(stub.log).toContain("set:strokeStyle=#0f0");
  });

  it("wireframe outlines a fill-only shape in its fill color", () => {
    const pipeline = new RenderPipeline();
    pipeline.setMode("wireframe");
    const { scene: frame, stub } = scene([actorWith([box("#123456")])]);
    pipeline.render(frame);
    expect(stub.log).toContain("set:strokeStyle=#123456");
  });

  it("unlit draws at full opacity", () => {
    const dim = box("#f00");
    dim.opacity = 0.25;
    const pipeline = new RenderPipeline();
    pipeline.setMode("unlit");
    const { scene: frame, stub } = scene([actorWith([dim])]);
    pipeline.render(frame);
    expect(stub.log).toContain("set:globalAlpha=1");
    expect(stub.log).not.toContain("set:globalAlpha=0.25");
    expect(fills(stub.log)).toEqual(["#f00"]);
  });

  it("silhouette fills flat in the layer's color: one color per layer", () => {
    const a = box("#a");
    const b = new ShapeComponent({
      shape: { kind: "circle", radius: 3 },
      stroke: "#b",
    });
    const other = box("#c");
    other.layer = 7;
    const pipeline = new RenderPipeline();
    pipeline.setMode("silhouette");
    const { scene: frame, stub } = scene([actorWith([a, b, other])]);
    pipeline.render(frame);

    const colors = fills(stub.log);
    expect(colors).toHaveLength(3);
    // Both layer-0 components fill in the same flat color; layer 7 differs.
    expect(colors[0]).toBe(colors[1]);
    expect(colors[2]).not.toBe(colors[0]);
    expect(colors[0]).toMatch(/^hsl\(/);
    // The stroke-only circle is filled, because a silhouette is a footprint.
    expect(stub.log).not.toContain("stroke()");
  });
});

describe("sprites", () => {
  const image = { width: 16, height: 24 } as unknown as ImageBitmap;

  it("draws the whole image centered by the default anchors", () => {
    const sprite = new SpriteComponent({ image });
    const { scene: frame, stub } = scene([actorWith([sprite])]);
    new RenderPipeline().render(frame);
    expect(stub.log).toContain("drawImage([object Object],-8,-12,16,24)");
  });

  it("draws the source region through the nine-argument form", () => {
    const sprite = new SpriteComponent({
      image,
      source: { x: 32, y: 0, width: 16, height: 16 },
      width: 8,
      height: 8,
      anchorX: 0,
      anchorY: 1,
    });
    const { scene: frame, stub } = scene([actorWith([sprite])]);
    new RenderPipeline().render(frame);
    expect(stub.log).toContain(
      "drawImage([object Object],32,0,16,16,0,-8,8,8)",
    );
  });

  it("falls back to the untinted blit where the host has no canvas to tint on", () => {
    // jsdom's canvas yields no 2D context, which is exactly the degraded host
    // the fallback exists for.
    const sprite = new SpriteComponent({ image, tint: "#ffffff" });
    const { scene: frame, stub } = scene([actorWith([sprite])]);
    new RenderPipeline().render(frame);
    expect(stub.log).toContain("drawImage([object Object],-8,-12,16,24)");
  });

  it("reduces the image to its bounds under wireframe, and to a flat fill under silhouette", () => {
    const wire = new RenderPipeline();
    wire.setMode("wireframe");
    const first = scene([actorWith([new SpriteComponent({ image })])]);
    wire.render(first.scene);
    expect(first.stub.log).toContain("strokeRect(-8,-12,16,24)");
    expect(first.stub.log.some((e) => e.startsWith("drawImage("))).toBe(false);

    const flat = new RenderPipeline();
    flat.setMode("silhouette");
    const second = scene([actorWith([new SpriteComponent({ image })])]);
    flat.render(second.scene);
    expect(second.stub.log).toContain("fillRect(-8,-12,16,24)");
    expect(second.stub.log.some((e) => e.startsWith("drawImage("))).toBe(false);
  });
});

describe("text", () => {
  it("draws the string at the transform, under its font, alignment, and fill", () => {
    const label = new TextComponent({
      text: "0 - 0",
      font: "24px monospace",
      fill: "#abcdef",
      align: "left",
      baseline: "top",
    });
    const { scene: frame, stub } = scene([
      actorWith([label], { x: 10, y: 20 }),
    ]);
    new RenderPipeline().render(frame);
    expect(stub.log).toContain("set:font=24px monospace");
    expect(stub.log).toContain("set:textAlign=left");
    expect(stub.log).toContain("set:textBaseline=top");
    expect(stub.log).toContain("set:fillStyle=#abcdef");
    expect(stub.log).toContain("fillText(0 - 0,10,20)");
  });

  it("outlines the glyphs under wireframe", () => {
    const label = new TextComponent({ text: "hi" });
    const pipeline = new RenderPipeline();
    pipeline.setMode("wireframe");
    const { scene: frame, stub } = scene([actorWith([label])]);
    pipeline.render(frame);
    expect(stub.log).toContain("strokeText(hi,0,0)");
    expect(stub.log.some((e) => e.startsWith("fillText("))).toBe(false);
  });
});

describe("the camera and the transform", () => {
  it("composes the viewport, the camera, and the component transform, in that order", () => {
    const { scene: frame, stub } = scene([
      actorWith([box()], { x: 100, y: 50 }),
    ]);
    frame.viewport = {
      width: 640,
      height: 360,
      scale: 2,
      offsetX: 10,
      offsetY: 20,
    };
    new RenderPipeline().render(frame);

    const start = afterClip(stub.log, "setTransform(2,0,0,2,10,20)");
    expect(start).toBeGreaterThan(-1);
    expect(stub.log.slice(start, start + 5)).toEqual([
      "setTransform(2,0,0,2,10,20)",
      "translate(320,180)",
      "scale(1,1)",
      "rotate(0)",
      "translate(-320,-180)",
    ]);
    // The component's untransformed position needs no transform of its own:
    // it lands in the path's arguments, in world coordinates.
    expect(stub.log).toContain("rect(95,45,10,10)");
  });

  it("adopts the first enabled CameraComponent's world transform and zoom", () => {
    const camera = new WorldCamera(640, 360);
    const disabled = new CameraComponent({ zoom: 9 });
    disabled.enabled = false;
    const lens = new CameraComponent({ zoom: 1.5 });
    const ship = actorWith([disabled, lens], {
      x: 500,
      y: 400,
      rotation: 0.25,
    });
    camera.follow(ship);

    const world = fakeWorld([ship], camera);
    const { scene: frame } = scene([ship], { world });
    new RenderPipeline().render(frame);

    expect(camera.x).toBe(500);
    expect(camera.y).toBe(400);
    expect(camera.zoom).toBe(1.5);
    expect(camera.rotation).toBe(0.25);
  });

  it("leaves the projection alone when the target carries no enabled lens", () => {
    const camera = new WorldCamera(640, 360);
    camera.x = 11;
    camera.y = 22;
    const plain = actorWith([box()], { x: 500, y: 400 });
    camera.follow(plain);

    const world = fakeWorld([plain], camera);
    const { scene: frame } = scene([plain], { world });
    new RenderPipeline().render(frame);
    expect(camera.x).toBe(11);
    expect(camera.y).toBe(22);
  });

  it("clamps the adopted view to the camera's bounds", () => {
    const camera = new WorldCamera(640, 360);
    camera.bounds = { x: 0, y: 0, width: 2048, height: 1152 };
    const lens = new CameraComponent();
    const ship = actorWith([lens], { x: 5000, y: -100 });
    camera.follow(ship);

    const world = fakeWorld([ship], camera);
    const { scene: frame } = scene([ship], { world });
    new RenderPipeline().render(frame);
    // Half the visible extent in from each edge: 640/2 and 360/2 at zoom 1.
    expect(camera.x).toBe(2048 - 320);
    expect(camera.y).toBe(180);
  });

  it("clamps a hand-driven camera too, and centers an axis the bounds cannot hold", () => {
    // A camera that is not the engine's own class exercises the pipeline's
    // interface-level clamp.
    const camera: Camera = {
      x: 9999,
      y: 50,
      zoom: 1,
      rotation: 0,
      bounds: { x: 0, y: 0, width: 1000, height: 100 },
      target: null,
      follow: () => undefined,
      snapshot: () => ({ x: 0, y: 0, zoom: 1, rotation: 0 }),
      worldToLogical: (point) => ({ ...point }),
      logicalToWorld: (point) => ({ ...point }),
    };
    const world = fakeWorld([], camera);
    const { scene: frame } = scene([], { world });
    new RenderPipeline().render(frame);
    expect(camera.x).toBe(1000 - 320);
    // The vertical extent (360) exceeds the bounds' 100, so the axis centers.
    expect(camera.y).toBe(50);
  });
});

describe("screen space", () => {
  /** A viewport with a fit and letterbox bars, so the two maps are told apart. */
  const fitted: Viewport = {
    width: 640,
    height: 360,
    scale: 2,
    offsetX: 10,
    offsetY: 20,
  };

  /** A camera moved, zoomed, and turned, so world space is nowhere near logical. */
  function movedCamera(): WorldCamera {
    const camera = new WorldCamera(640, 360);
    camera.x = 5000;
    camera.y = -300;
    camera.zoom = 3;
    camera.rotation = 1;
    return camera;
  }

  function screenBox(fill = "#hud"): ShapeComponent {
    const component = box(fill);
    component.space = "screen";
    return component;
  }

  it("draws a screen component under the viewport alone, at its transform in logical units", () => {
    const hud = actorWith([screenBox()], { x: 600, y: 20 });
    const world = fakeWorld([hud], movedCamera());
    const { scene: frame, stub } = scene([hud], { world, viewport: fitted });
    new RenderPipeline().render(frame);

    const start = afterClip(stub.log, "setTransform(2,0,0,2,10,20)");
    expect(start).toBeGreaterThan(-1);
    // The camera is never pushed on top: the viewport transform is followed
    // directly by the path, in logical coordinates.
    expect(stub.log.slice(start, start + 3)).toEqual([
      "setTransform(2,0,0,2,10,20)",
      "beginPath()",
      "rect(595,15,10,10)",
    ]);
    expect(stub.log).not.toContain("translate(320,180)");
  });

  it("holds its place whatever the camera does, while a world component moves", () => {
    const hud = actorWith([screenBox("#hud")], { x: 600, y: 20 });
    const prop = actorWith([box("#prop")], { x: 100, y: 50 });

    const still = new WorldCamera(640, 360);
    const first = scene([hud, prop], { world: fakeWorld([hud, prop], still) });
    new RenderPipeline().render(first.scene);

    const moved = fakeWorld([hud, prop], movedCamera());
    const second = scene([hud, prop], { world: moved });
    new RenderPipeline().render(second.scene);

    // The field's own `rect`, which the clip is taken from, is not a component's.
    const rects = (log: string[]): string[] =>
      log.filter(
        (entry, at) => entry.startsWith("rect(") && at > log.indexOf("clip()"),
      );
    // Both frames record the same operations, in spawn order; only the
    // transform the world component draws under changed.
    expect(rects(first.stub.log)).toEqual([
      "rect(595,15,10,10)",
      "rect(95,45,10,10)",
    ]);
    expect(rects(second.stub.log)).toEqual(rects(first.stub.log));
    expect(first.stub.log).toContain("translate(-320,-180)");
    expect(second.stub.log).toContain("translate(-5000,300)");
    expect(second.stub.log).toContain("scale(3,3)");
  });

  it("composes the offset onto the actor, read in logical units", () => {
    const label = screenBox();
    label.offset.x = -10;
    label.offset.y = 5;
    const hud = actorWith([label], { x: 600, y: 20 });
    const { scene: frame, stub } = scene([hud]);
    new RenderPipeline().render(frame);
    expect(stub.log).toContain("rect(585,20,10,10)");
  });

  it("pivots a rotated screen component about its logical position", () => {
    const spun = screenBox();
    const hud = actorWith([spun], { x: 600, y: 20, rotation: 0.5 });
    const { scene: frame, stub } = scene([hud], { viewport: fitted });
    new RenderPipeline().render(frame);

    const start = afterClip(stub.log, "setTransform(2,0,0,2,10,20)");
    expect(stub.log.slice(start, start + 5)).toEqual([
      "setTransform(2,0,0,2,10,20)",
      "translate(600,20)",
      "rotate(0.5)",
      "scale(1,1)",
      "translate(-600,-20)",
    ]);
    expect(stub.log).toContain("rect(595,15,10,10)");
  });

  it("keeps its layer in the one sort with world components", () => {
    const under = box("#under");
    const hud = screenBox("#hud");
    hud.layer = 5;
    const over = box("#over");
    over.layer = 10;
    const { scene: frame, stub } = scene([
      actorWith([over]),
      actorWith([hud]),
      actorWith([under]),
    ]);
    new RenderPipeline().render(frame);
    expect(fills(stub.log)).toEqual(["#under", "#hud", "#over"]);
  });

  it("draws text and sprites in logical units under the viewport alone", () => {
    const image = { width: 16, height: 24 } as unknown as ImageBitmap;
    const label = new TextComponent({ text: "hi", font: "24px monospace" });
    label.space = "screen";
    const icon = new SpriteComponent({ image });
    icon.space = "screen";
    const hud = actorWith([label, icon], { x: 320, y: 30 });
    const world = fakeWorld([hud], movedCamera());
    const { scene: frame, stub } = scene([hud], { world, viewport: fitted });
    new RenderPipeline().render(frame);

    expect(stub.log).toContain("fillText(hi,320,30)");
    expect(stub.log).toContain("drawImage([object Object],312,18,16,24)");
    // Each component starts from the viewport alone; the camera's zoom never
    // reaches the context.
    expect(stub.log).not.toContain("scale(3,3)");
  });

  it("hands a screen DrawComponent the viewport transform and names the space", () => {
    const seen: string[] = [];
    class Probe extends DrawComponent {
      draw(api: DrawApi): void {
        seen.push(api.space);
        api.ctx.fillRect(1, 2, 3, 4);
      }
    }
    const onScreen = new Probe();
    onScreen.space = "screen";
    const inWorld = new Probe();
    inWorld.layer = 1;
    const hud = actorWith([onScreen, inWorld], { x: 77, y: 88 });
    const world = fakeWorld([hud], movedCamera());
    const { scene: frame, stub } = scene([hud], { world, viewport: fitted });
    new RenderPipeline().render(frame);

    expect(seen).toEqual(["screen", "world"]);
    const draws = stub.log
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry === "fillRect(1,2,3,4)")
      .map(({ index }) => index);
    expect(draws).toHaveLength(2);
    // The screen draw follows the viewport transform directly; the world draw
    // follows the camera composed onto it.
    expect(stub.log[draws[0]! - 1]).toBe("setTransform(2,0,0,2,10,20)");
    expect(stub.log[draws[1]! - 1]).toBe("translate(-5000,300)");
  });

  it("applies the render modes to a screen component as to any other", () => {
    const pipeline = new RenderPipeline();
    pipeline.setMode("wireframe");
    const { scene: frame, stub } = scene([actorWith([screenBox("#hud")])]);
    pipeline.render(frame);
    expect(stub.log).toContain("stroke()");
    expect(stub.log).not.toContain("fill()");
    expect(stub.log).toContain("set:strokeStyle=#hud");
  });
});

describe("direct drawing", () => {
  class Probe extends DrawComponent {
    received: DrawApi | null = null;
    order: string[] = [];
    draw(api: DrawApi): void {
      this.received = api;
      api.ctx.fillRect(1, 2, 3, 4);
    }
  }

  it("hands the draw the context, the mode, and snapshots the caller owns", () => {
    const probe = new Probe();
    const pipeline = new RenderPipeline();
    pipeline.setMode("unlit");
    const { scene: frame, stub } = scene([actorWith([probe])]);
    pipeline.render(frame);

    const api = probe.received;
    expect(api).not.toBeNull();
    expect(api?.ctx).toBe(stub.ctx);
    expect(api?.mode).toBe("unlit");
    expect(api?.frame()).toEqual({ count: 5, timeMs: 100, lastDeltaMs: 16 });
    expect(api?.viewport()).toEqual({
      width: 640,
      height: 360,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(api?.camera()).toEqual({ x: 320, y: 180, zoom: 1, rotation: 0 });
    // Snapshots: writing one read does not leak into the next.
    const held = api?.frame();
    if (held) held.count = 999;
    expect(api?.frame().count).toBe(5);
  });

  it("draws in its place in the layer order, under the world-to-device transform alone", () => {
    const probe = new Probe();
    probe.layer = 1;
    const under = box("#under");
    const over = box("#over");
    over.layer = 2;
    const { scene: frame, stub } = scene([
      actorWith([probe], { x: 77, y: 88 }),
      actorWith([under]),
      actorWith([over]),
    ]);
    new RenderPipeline().render(frame);

    const probeAt = stub.log.indexOf("fillRect(1,2,3,4)");
    expect(probeAt).toBeGreaterThan(stub.log.indexOf("fill()"));
    expect(probeAt).toBeLessThan(stub.log.lastIndexOf("fill()"));
    // The component's own transform is not applied: no translate(77,88)
    // between the camera transform and the probe's draw.
    expect(stub.log.slice(0, probeAt)).not.toContain("translate(77,88)");
  });

  it("defers a setMode issued mid-pipeline to the next frame the pipeline runs", () => {
    const modes: string[] = [];
    const pipeline = new RenderPipeline();

    class Switcher extends DrawComponent {
      draw(api: DrawApi): void {
        modes.push(api.mode);
        pipeline.setMode("wireframe");
      }
    }

    const switcher = new Switcher();
    switcher.layer = -1;
    const first = scene([actorWith([switcher, box()])]);
    pipeline.render(first.scene);
    // The switcher drew before the box, but the box still drew under the
    // frame's mode — a shaded fill, not a wireframe stroke — agreeing with
    // the `api.mode` the switcher itself was handed.
    expect(modes).toEqual(["shaded"]);
    expect(first.stub.log).toContain("fill()");
    expect(first.stub.log).not.toContain("stroke()");

    // The next frame the pipeline runs draws under the set mode.
    const second = scene([actorWith([box()])]);
    pipeline.render(second.scene);
    expect(second.stub.log).toContain("stroke()");
    expect(second.stub.log).not.toContain("fill()");
  });
});

describe("the collision overlay", () => {
  function collider(
    responses: Record<string, "ignore" | "overlap" | "block">,
  ): ColliderComponent {
    return new ColliderComponent({
      shape: { kind: "circle", radius: 5 },
      responses,
    });
  }

  it("draws nothing while the switch is off", () => {
    const { scene: frame, stub } = scene([
      actorWith([collider({ default: "block" })]),
    ]);
    new RenderPipeline().render(frame);
    expect(stub.log.some((entry) => entry.startsWith("arc("))).toBe(false);
  });

  it("strokes every enabled collider over the finished picture, in a color per response", () => {
    const blocking = collider({ default: "block", other: "overlap" });
    const overlapping = collider({ default: "overlap" });
    const ignoring = collider({});
    const off = collider({ default: "block" });
    off.enabled = false;

    const pipeline = new RenderPipeline();
    pipeline.setCollisionOverlay(true);
    const { scene: frame, stub } = scene([
      actorWith([box("#body"), blocking, overlapping, ignoring, off]),
    ]);
    pipeline.render(frame);

    // Three enabled colliders stroke; the picture's fill comes first.
    const strokes = stub.log.filter((entry) => entry === "stroke()");
    expect(strokes).toHaveLength(3);
    expect(stub.log.indexOf("fill()")).toBeLessThan(
      stub.log.indexOf("stroke()"),
    );

    const colors = stub.log
      .filter((entry) => entry.startsWith("set:strokeStyle="))
      .map((entry) => entry.slice(16));
    expect(colors).toHaveLength(3);
    expect(new Set(colors).size).toBe(3);
  });

  it("draws independently of the render mode", () => {
    const pipeline = new RenderPipeline();
    pipeline.setMode("silhouette");
    pipeline.setCollisionOverlay(true);
    const { scene: frame, stub } = scene([
      actorWith([collider({ default: "block" })]),
    ]);
    pipeline.render(frame);
    expect(stub.log.filter((entry) => entry === "stroke()")).toHaveLength(1);
  });
});
