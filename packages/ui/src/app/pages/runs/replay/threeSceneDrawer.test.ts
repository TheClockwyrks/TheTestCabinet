import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { ThreeSceneDrawer } from "./threeSceneDrawer";
import type { ResolvedMaterial } from "./sceneDrawer3d";
import { HUD_TEXT_DEFAULTS, MATERIAL_DEFAULTS } from "./sceneDrawer3d";

/**
 * What the three-backed scene makes of what the drawer hands it.
 *
 * The renderer is a stub. Everything this file asserts on is decided BEFORE a
 * pixel: which three object a verb builds, what a light converts to, which
 * material class a render mode picks, where the letterbox rectangle sits inside
 * the surface, and how many times a frame is rendered — one pass per run, which
 * is what makes a mid-frame camera change or a depth clear mean anything. Only
 * the rasterizing is left out, and only because there is nothing in this
 * repository to rasterize with: `@test-cabinet/headless-webgl2` is a real WebGL2
 * context but a deliberately partial one, and three's renderer binds a cube-map
 * texture while it is still constructing itself, which that context refuses by
 * design. So the pixels are a browser's business, and everything up to them is
 * asserted here.
 *
 * The stub is cast into place. A `WebGLRenderer` cannot be constructed without a
 * context, and the drawer touches seven of its methods; standing those seven up
 * is what lets the rest of the class be exercised at all.
 */

/** The renderer calls the drawer made, and the scenes it was asked to render. */
interface FakeRenderer {
  renderer: THREE.WebGLRenderer;
  readonly log: string[];
  /** Every `render` call's scene graph, flattened, in order. */
  readonly passes: THREE.Object3D[][];
  /** The last viewport and scissor rectangles set. */
  viewport: number[];
  scissor: number[];
  clearColor: { color: THREE.Color; alpha: number } | null;
}

function fakeRenderer(): FakeRenderer {
  const fake: FakeRenderer = {
    renderer: null as unknown as THREE.WebGLRenderer,
    log: [],
    passes: [],
    viewport: [],
    scissor: [],
    clearColor: null,
  };
  const renderer = {
    autoClear: true,
    outputColorSpace: THREE.SRGBColorSpace,
    setScissorTest: (on: boolean) => fake.log.push(`scissorTest(${on})`),
    setViewport: (x: number, y: number, w: number, h: number) => {
      fake.viewport = [x, y, w, h];
      fake.log.push(`viewport(${x},${y},${w},${h})`);
    },
    setScissor: (x: number, y: number, w: number, h: number) => {
      fake.scissor = [x, y, w, h];
      fake.log.push(`scissor(${x},${y},${w},${h})`);
    },
    setClearColor: (color: THREE.Color, alpha: number) => {
      fake.clearColor = { color, alpha };
      fake.log.push("clearColor");
    },
    clear: () => fake.log.push("clear"),
    clearDepth: () => fake.log.push("clearDepth"),
    setSize: () => fake.log.push("setSize"),
    setPixelRatio: () => fake.log.push("setPixelRatio"),
    render: (scene: THREE.Scene) => {
      const flat: THREE.Object3D[] = [];
      scene.traverse((object) => flat.push(object));
      fake.passes.push(flat);
      fake.log.push("render");
    },
    dispose: () => fake.log.push("dispose"),
  };
  // Assigned onto the same object the closures above write to: a copy would
  // leave every scalar the drawer sets unread.
  (fake as { renderer: THREE.WebGLRenderer }).renderer =
    renderer as unknown as THREE.WebGLRenderer;
  return fake;
}

/** A drawer over a stub renderer, with the frame already opened. */
function opened(
  surface = { width: 1000, height: 600 },
  design = { width: 800, height: 600 },
  background: string | null = "#000000",
): { drawer: ThreeSceneDrawer; fake: FakeRenderer } {
  const fake = fakeRenderer();
  const drawer = new ThreeSceneDrawer({ renderer: fake.renderer, hud: null });
  drawer.blank(surface, design, background);
  drawer.setCamera({
    position: { x: 0, y: 0, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    fovY: Math.PI / 2,
    near: 0.5,
    far: 100,
  });
  return { drawer, fake };
}

/** The identity placement. */
const HERE = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

/** Everything one pass drew, of a kind. */
function drawn<T extends THREE.Object3D>(
  fake: FakeRenderer,
  pass: number,
  is: (object: THREE.Object3D) => object is T,
): T[] {
  return (fake.passes[pass] ?? []).filter(is);
}

const isMesh = (object: THREE.Object3D): object is THREE.Mesh =>
  (object as THREE.Mesh).isMesh === true;
const isSprite = (object: THREE.Object3D): object is THREE.Sprite =>
  (object as THREE.Sprite).isSprite === true;
const isLine = (object: THREE.Object3D): object is THREE.Line =>
  (object as THREE.Line).isLine === true;
const isLight = (object: THREE.Object3D): object is THREE.Light =>
  (object as THREE.Light).isLight === true;

describe("opening a frame", () => {
  it("clears the whole surface, then pins the picture inside its letterbox", () => {
    const { fake } = opened();
    // The clear covers the bars; the viewport and scissor that follow are the
    // fit, so nothing a draw issues can reach outside the picture.
    expect(fake.log.slice(0, 6)).toEqual([
      "scissorTest(false)",
      "viewport(0,0,1000,600)",
      "clearColor",
      "clear",
      "viewport(100,0,800,600)",
      "scissor(100,0,800,600)",
    ]);
    expect(fake.log[6]).toBe("scissorTest(true)");
  });

  it("measures the letterbox from the bottom, as a GL viewport is", () => {
    const fake = fakeRenderer();
    const drawer = new ThreeSceneDrawer({ renderer: fake.renderer, hud: null });
    drawer.blank(
      { width: 800, height: 1000 },
      { width: 800, height: 600 },
      null,
    );
    // 200 device pixels of bar above the picture and 200 below, and a GL
    // viewport's y is the DISTANCE FROM THE BOTTOM: 1000 − 200 − 600.
    expect(fake.viewport).toEqual([0, 200, 800, 600]);
  });

  it("clears to nothing at all when the recording was transparent", () => {
    const fake = fakeRenderer();
    const drawer = new ThreeSceneDrawer({ renderer: fake.renderer, hud: null });
    drawer.blank(
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      null,
    );
    expect(fake.clearColor?.alpha).toBe(0);
  });

  it("clears to the colour the frames were cleared to", () => {
    const { fake } = opened({ width: 800, height: 600 }, undefined, "#ff0000");
    expect(fake.clearColor?.alpha).toBe(1);
    expect(fake.clearColor?.color.getHex(THREE.LinearSRGBColorSpace)).toBe(
      0xff0000,
    );
  });

  it("takes the frustum's aspect from the design field, never from the pane", () => {
    const { drawer, fake } = opened({ width: 1000, height: 600 });
    drawer.drawLine(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      "#ffffff",
    );
    drawer.render();
    expect(fake.passes).toHaveLength(1);
    // The camera is not in the scene graph, so it is read back off the drawer's
    // own projection: a 4:3 design field on a 5:3 surface stays 4:3.
    const camera = (drawer as unknown as { camera: THREE.PerspectiveCamera })
      .camera;
    expect(camera.aspect).toBeCloseTo(800 / 600, 6);
    expect(camera.fov).toBeCloseTo(90, 6);
    expect(camera.near).toBe(0.5);
    expect(camera.far).toBe(100);
  });
});

describe("one pass per run", () => {
  it("renders once for a frame that never changes its state", () => {
    const { drawer, fake } = opened();
    drawer.drawGeometry(
      drawer.createBox({ x: 1, y: 1, z: 1 }),
      MATERIAL_DEFAULTS,
      HERE,
    );
    drawer.drawGeometry(drawer.createSphere(1), MATERIAL_DEFAULTS, HERE);
    drawer.render();
    expect(fake.log.filter((entry) => entry === "render")).toHaveLength(1);
    expect(drawn(fake, 0, isMesh)).toHaveLength(2);
  });

  it("renders the run so far before a state setter changes it", () => {
    const { drawer, fake } = opened();
    drawer.drawGeometry(
      drawer.createBox({ x: 1, y: 1, z: 1 }),
      MATERIAL_DEFAULTS,
      HERE,
    );
    drawer.setMode("unlit");
    drawer.drawGeometry(drawer.createSphere(1), MATERIAL_DEFAULTS, HERE);
    drawer.render();
    expect(fake.passes).toHaveLength(2);
    expect(drawn(fake, 0, isMesh)).toHaveLength(1);
    expect(drawn(fake, 1, isMesh)).toHaveLength(1);
  });

  it("clears the depth buffer between two runs a depth clear divides", () => {
    const { drawer, fake } = opened();
    drawer.drawGeometry(
      drawer.createBox({ x: 1, y: 1, z: 1 }),
      MATERIAL_DEFAULTS,
      HERE,
    );
    drawer.clearDepth();
    drawer.drawGeometry(drawer.createSphere(1), MATERIAL_DEFAULTS, HERE);
    drawer.render();
    const passes = fake.log.filter(
      (entry) => entry === "render" || entry === "clearDepth",
    );
    expect(passes).toEqual(["render", "clearDepth", "render"]);
  });

  it("renders nothing for a frame that drew nothing", () => {
    const { drawer, fake } = opened();
    drawer.setMode("wireframe");
    drawer.render();
    expect(fake.log).not.toContain("render");
  });

  it("keeps the order the drawer issued, whatever three would have sorted", () => {
    const { drawer, fake } = opened();
    drawer.drawGeometry(
      drawer.createBox({ x: 1, y: 1, z: 1 }),
      MATERIAL_DEFAULTS,
      HERE,
    );
    drawer.drawBillboard(
      { kind: "texture", path: "t.png", width: 1, height: 1, value: null },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1 },
    );
    drawer.drawLine(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      "#ffffff",
    );
    drawer.render();
    const orders = (fake.passes[0] ?? [])
      .filter((object) => isMesh(object) || isSprite(object) || isLine(object))
      .map((object) => object.renderOrder);
    // Increasing, and increasing in the order the calls arrived: three sorts on
    // `renderOrder` before anything else, in both its lists.
    expect(orders).toEqual([0, 1, 2]);
  });
});

describe("what a verb builds", () => {
  it("builds each producer's geometry at the engines' own tessellation", () => {
    const { drawer } = opened();
    const box = drawer.createBox({ x: 2, y: 3, z: 4 }) as THREE.BoxGeometry;
    expect(box.parameters).toMatchObject({ width: 2, height: 3, depth: 4 });
    const sphere = drawer.createSphere(5) as THREE.SphereGeometry;
    expect(sphere.parameters).toMatchObject({
      radius: 5,
      widthSegments: 32,
      heightSegments: 16,
    });
    const cylinder = drawer.createCylinder(1, 6) as THREE.CylinderGeometry;
    expect(cylinder.parameters).toMatchObject({
      radiusTop: 1,
      radiusBottom: 1,
      height: 6,
      radialSegments: 32,
    });
    // The engines' `height` is the distance between the cap centres, which is
    // what three calls a capsule's length.
    const capsule = drawer.createCapsule(1, 2) as THREE.CapsuleGeometry;
    expect(capsule.parameters).toMatchObject({ radius: 1, height: 2 });
  });

  it("lays a plane on the XZ plane with a +Y normal", () => {
    const { drawer } = opened();
    const plane = drawer.createPlane(4, 4) as THREE.PlaneGeometry;
    const normals = plane.getAttribute("normal");
    expect(normals.getX(0)).toBeCloseTo(0, 6);
    expect(normals.getY(0)).toBeCloseTo(1, 6);
    expect(normals.getZ(0)).toBeCloseTo(0, 6);
  });

  it("places a geometry draw under its whole transform", () => {
    const { drawer, fake } = opened();
    drawer.drawGeometry(
      drawer.createBox({ x: 1, y: 1, z: 1 }),
      MATERIAL_DEFAULTS,
      {
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 0.7071067811865476, z: 0, w: 0.7071067811865476 },
        scale: { x: 2, y: 2, z: 2 },
      },
    );
    drawer.render();
    const mesh = drawn(fake, 0, isMesh)[0];
    expect(mesh?.position.toArray()).toEqual([1, 2, 3]);
    expect(mesh?.scale.toArray()).toEqual([2, 2, 2]);
    expect(mesh?.quaternion.y).toBeCloseTo(0.70710678, 6);
  });

  it("draws nothing at all for a non-finite transform, and does not throw", () => {
    const { drawer, fake } = opened();
    drawer.drawGeometry(
      drawer.createBox({ x: 1, y: 1, z: 1 }),
      MATERIAL_DEFAULTS,
      {
        ...HERE,
        position: { x: Number.NaN, y: 0, z: 0 },
      },
    );
    drawer.render();
    // The build drew nothing for this call and reported nothing; so does this.
    expect(fake.log).not.toContain("render");
  });

  it("draws a billboard as a camera-facing quad of the size it names", () => {
    const { drawer, fake } = opened();
    drawer.drawBillboard(
      { kind: "texture", path: "t.png", width: 4, height: 4, value: null },
      { x: 1, y: 2, z: 3 },
      { x: 5, y: 6 },
    );
    drawer.render();
    const sprite = drawn(fake, 0, isSprite)[0];
    expect(sprite?.position.toArray()).toEqual([1, 2, 3]);
    expect(sprite?.scale.toArray()).toEqual([5, 6, 1]);
    // Every billboard blends, whatever its texture carries.
    expect(sprite?.material.transparent).toBe(true);
    expect(sprite?.material.depthWrite).toBe(false);
  });

  it("draws a polyline through its points, and nothing under two of them", () => {
    const { drawer, fake } = opened();
    drawer.drawLine(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
        { x: 2, y: 0, z: 0 },
      ],
      "#00000080",
    );
    drawer.drawLine([{ x: 0, y: 0, z: 0 }], "#ffffff");
    drawer.render();
    const lines = drawn(fake, 0, isLine);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.geometry.getAttribute("position").count).toBe(3);
    const material = lines[0]?.material as THREE.LineBasicMaterial;
    // A line over a translucent colour blends, and writes no depth.
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(128 / 255, 5);
  });
});

describe("the lights a run is lit by", () => {
  /** The lights the drawer put in the scene for one pass. */
  function lit(
    lights: Parameters<ThreeSceneDrawer["setLights"]>[0],
  ): THREE.Light[] {
    const { drawer, fake } = opened();
    drawer.setLights(lights);
    drawer.drawGeometry(drawer.createSphere(1), MATERIAL_DEFAULTS, HERE);
    drawer.render();
    return drawn(fake, 0, isLight);
  }

  it("builds an ambient light of the colour and intensity it names", () => {
    const [light] = lit([
      { type: "ambient", color: "#ff0000", intensity: 0.25 },
    ]);
    expect((light as THREE.AmbientLight).isAmbientLight).toBe(true);
    expect(light?.intensity).toBe(0.25);
    expect(light?.color.getHex(THREE.LinearSRGBColorSpace)).toBe(0xff0000);
  });

  it("points a directional light the way the recording says it shines", () => {
    const [light] = lit([
      {
        type: "directional",
        color: "#ffffff",
        intensity: 1,
        direction: { x: 0, y: -1, z: 0 },
      },
    ]);
    // three shines from a position towards a target, so a light that shines
    // DOWN sits above the origin.
    expect(light?.position.x).toBeCloseTo(0, 10);
    expect(light?.position.y).toBeCloseTo(1, 10);
    expect(light?.position.z).toBeCloseTo(0, 10);
  });

  it("gives a point light the engines' own falloff over its range", () => {
    const [light] = lit([
      {
        type: "point",
        color: "#ffffff",
        intensity: 2,
        position: { x: 1, y: 2, z: 3 },
        range: 9,
      },
    ]);
    const lamp = light as THREE.PointLight;
    expect(lamp.position.toArray()).toEqual([1, 2, 3]);
    expect(lamp.distance).toBe(9);
    // `pow(saturate(1 − d / range), 2)`, which is the engines' shader.
    expect(lamp.decay).toBe(2);
  });

  it("replaces the whole list rather than adding to it", () => {
    const { drawer, fake } = opened();
    drawer.setLights([{ type: "ambient", color: "#ff0000", intensity: 1 }]);
    drawer.setLights([{ type: "ambient", color: "#00ff00", intensity: 1 }]);
    drawer.drawGeometry(drawer.createSphere(1), MATERIAL_DEFAULTS, HERE);
    drawer.render();
    const lights = drawn(fake, 0, isLight);
    expect(lights).toHaveLength(1);
    expect(lights[0]?.color.getHex(THREE.LinearSRGBColorSpace)).toBe(0x00ff00);
  });
});

describe("what a render mode makes of a material", () => {
  /** The material the drawer drew a geometry with under `mode`. */
  function under(
    mode: Parameters<ThreeSceneDrawer["setMode"]>[0],
    material: ResolvedMaterial = MATERIAL_DEFAULTS,
  ): THREE.Material {
    const { drawer, fake } = opened();
    drawer.setMode(mode);
    drawer.drawGeometry(drawer.createBox({ x: 1, y: 1, z: 1 }), material, HERE);
    drawer.render();
    return drawn(fake, 0, isMesh)[0]?.material as THREE.Material;
  }

  it("shades with a lit material under the standard mode", () => {
    const material = under("standard", {
      ...MATERIAL_DEFAULTS,
      baseColor: "#123456",
      roughness: 0.25,
      metallic: 0.75,
      emissive: "#010203",
    }) as THREE.MeshStandardMaterial;
    expect(material.isMeshStandardMaterial).toBe(true);
    expect(material.color.getHexString(THREE.LinearSRGBColorSpace)).toBe(
      "123456",
    );
    expect(material.roughness).toBe(0.25);
    expect(material.metalness).toBe(0.75);
    expect(material.emissive.getHexString(THREE.LinearSRGBColorSpace)).toBe(
      "010203",
    );
    expect(material.wireframe).toBe(false);
  });

  it("draws the edges under the wireframe mode", () => {
    expect((under("wireframe") as THREE.MeshStandardMaterial).wireframe).toBe(
      true,
    );
  });

  it("drops the lighting under the unlit mode, and for an unlit material", () => {
    expect(
      (under("unlit") as THREE.MeshBasicMaterial).isMeshBasicMaterial,
    ).toBe(true);
    expect(
      (
        under("standard", {
          ...MATERIAL_DEFAULTS,
          unlit: true,
        }) as THREE.MeshBasicMaterial
      ).isMeshBasicMaterial,
    ).toBe(true);
  });

  it("shades by the surface normal under the normals mode", () => {
    expect(
      (under("normals") as THREE.MeshNormalMaterial).isMeshNormalMaterial,
    ).toBe(true);
  });

  it("blends a material whose opacity is below one, and writes no depth", () => {
    const material = under("standard", { ...MATERIAL_DEFAULTS, opacity: 0.5 });
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0.5);
    expect(material.depthWrite).toBe(false);
  });

  it("re-uses one material for one spec under one mode", () => {
    const { drawer, fake } = opened();
    drawer.drawGeometry(
      drawer.createBox({ x: 1, y: 1, z: 1 }),
      MATERIAL_DEFAULTS,
      HERE,
    );
    drawer.drawGeometry(drawer.createSphere(1), MATERIAL_DEFAULTS, HERE);
    drawer.render();
    const meshes = drawn(fake, 0, isMesh);
    // A material is a pure function of (spec, mode), so sharing one is
    // invisible to the picture and saves a shader compile per frame.
    expect(meshes[0]?.material).toBe(meshes[1]?.material);
  });
});

describe("compositing the HUD", () => {
  const REAL_CONTEXT = HTMLCanvasElement.prototype.getContext;

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = REAL_CONTEXT;
  });

  /** A 2D context that writes down what was painted onto it. */
  function fakeContext(): {
    ctx: CanvasRenderingContext2D;
    calls: Array<[string, unknown[]]>;
  } {
    const calls: Array<[string, unknown[]]> = [];
    const ctx = {
      fillStyle: "#000000",
      globalCompositeOperation: "source-over",
      imageSmoothingEnabled: true,
      clearRect: (...args: unknown[]) => calls.push(["clearRect", args]),
      fillRect: (...args: unknown[]) => calls.push(["fillRect", args]),
      drawImage: (...args: unknown[]) => calls.push(["drawImage", args]),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  /** jsdom answers no context at all; the glyph atlas needs one. */
  function stubAtlasCanvas(): Array<[string, unknown[]]> {
    const { ctx, calls } = fakeContext();
    HTMLCanvasElement.prototype.getContext = (() =>
      ctx) as unknown as typeof REAL_CONTEXT;
    return calls;
  }

  it("fills a HUD rectangle at the device pixels the logical one maps to", () => {
    const fake = fakeRenderer();
    const hud = fakeContext();
    const drawer = new ThreeSceneDrawer({
      renderer: fake.renderer,
      hud: hud.ctx,
    });
    // A 1600×1200 surface for an 800×600 field: two device pixels per logical
    // unit, and no letterbox bar on either axis.
    drawer.blank(
      { width: 1600, height: 1200 },
      { width: 800, height: 600 },
      null,
    );
    drawer.drawHudRect({ x: 10, y: 20 }, { x: 30, y: 40 }, "#ff000080");
    expect(hud.calls.at(-1)).toEqual(["fillRect", [20, 40, 60, 80]]);
    expect(hud.ctx.fillStyle).toBe("rgba(255, 0, 0, 0.5019607843137255)");
  });

  it("clears the overlay when the frame opens", () => {
    const fake = fakeRenderer();
    const hud = fakeContext();
    const drawer = new ThreeSceneDrawer({
      renderer: fake.renderer,
      hud: hud.ctx,
    });
    drawer.blank(
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      null,
    );
    expect(hud.calls[0]).toEqual(["clearRect", [0, 0, 800, 600]]);
  });

  it("letters a string one cell per glyph, at half the em size apiece", () => {
    stubAtlasCanvas();
    const fake = fakeRenderer();
    const hud = fakeContext();
    const drawer = new ThreeSceneDrawer({
      renderer: fake.renderer,
      hud: hud.ctx,
    });
    drawer.blank(
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      null,
    );
    drawer.drawHudText("AB", { x: 100, y: 50 }, HUD_TEXT_DEFAULTS);
    const painted = hud.calls.filter(([method]) => method === "drawImage");
    expect(painted).toHaveLength(2);
    // Source: the atlas cell for the code point, 8×16. Destination: the em box,
    // half the size wide and the size tall, at the logical position scaled.
    expect(painted[0]?.[1].slice(1)).toEqual([
      (0x41 - 0x20) * 8,
      0,
      8,
      16,
      100,
      50,
      12,
      24,
    ]);
    expect(painted[1]?.[1].slice(1)).toEqual([
      (0x42 - 0x20) * 8,
      0,
      8,
      16,
      112,
      50,
      12,
      24,
    ]);
  });

  it("letters a character outside the face's coverage from the replacement cell", () => {
    stubAtlasCanvas();
    const fake = fakeRenderer();
    const hud = fakeContext();
    const drawer = new ThreeSceneDrawer({
      renderer: fake.renderer,
      hud: hud.ctx,
    });
    drawer.blank(
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      null,
    );
    drawer.drawHudText("☃", { x: 0, y: 0 }, HUD_TEXT_DEFAULTS);
    const painted = hud.calls.filter(([method]) => method === "drawImage");
    // One past the last covered cell: 95 covered glyphs, then the box.
    expect(painted[0]?.[1][1]).toBe(95 * 8);
  });

  it("draws no HUD at all where the player has no overlay to draw on", () => {
    const { drawer } = opened();
    expect(() =>
      drawer.drawHudText("x", { x: 0, y: 0 }, HUD_TEXT_DEFAULTS),
    ).not.toThrow();
    expect(() =>
      drawer.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff"),
    ).not.toThrow();
  });
});
