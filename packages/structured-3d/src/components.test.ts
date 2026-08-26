import { describe, expect, it } from "vitest";
import { Actor } from "./actors";
import type { MeshHandle } from "./assets";
import {
  AmbientLightComponent,
  CameraComponent,
  Component,
  DirectionalLightComponent,
  DrawComponent,
  LightComponent,
  MeshComponent,
  PointLightComponent,
  RenderComponent,
  ShapeComponent,
  TextComponent,
  defaultLightRig,
  lightStateOf,
  scaleShape3,
  textHeightOf,
  type DrawApi,
} from "./components";
import {
  quatFromAxisAngle,
  quatMultiply,
  vec3Normalize,
  type Quat,
  type Vec3,
} from "./math";
import type { World } from "./worlds";

/**
 * This suite covers what each component *is* — options, defaults, the fields
 * they settle into, the offset composition — and the internal seams the
 * pipeline lowers through (`scaleShape3`, `lightStateOf`, `defaultLightRig`,
 * `textHeightOf`). What each component *draws* is asserted over the rendering
 * module, which owns the pipeline.
 */

/**
 * A stand-in mesh: the component only carries the handle, so a plain record
 * with the documented fields is the whole double.
 */
function mesh(clips: readonly string[] = []): MeshHandle {
  return {
    path: "assets/rover.glb",
    bounds: { min: { x: -1, y: 0, z: -2 }, max: { x: 1, y: 2, z: 2 } },
    nodes: ["hull", "wheels"],
    clips,
  };
}

/** An actor placed at a known transform, so composition sums are exact. */
function actorAt(
  position: Vec3,
  rotation: Quat = { x: 0, y: 0, z: 0, w: 1 },
  scale: Vec3 = { x: 1, y: 1, z: 1 },
): Actor {
  const actor = new Actor();
  actor.transform.position = { ...position };
  actor.transform.rotation = { ...rotation };
  actor.transform.scale = { ...scale };
  return actor;
}

/** A quarter turn about the world's +Y — it carries local +X onto −Z. */
const QUARTER_Y = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);

describe("Component", () => {
  it("starts with the identity offset, so an untouched component sits on its actor", () => {
    const component = new Component();

    expect(component.offset).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it("is enabled by default", () => {
    expect(new Component().enabled).toBe(true);
  });

  it("has do-nothing base lifecycle methods", () => {
    const component = new Component();

    expect(() => component.beginPlay()).not.toThrow();
    expect(() => component.tick(1 / 60)).not.toThrow();
    expect(() => component.endPlay("level-closed")).not.toThrow();
  });

  it("reads its world through the actor it is attached to", () => {
    const world = {} as World;
    const actor = new Actor();
    (actor as { world: World }).world = world;
    const component = actor.attach(new Component());

    expect(component.world).toBe(world);
  });
});

describe("Component.worldTransform", () => {
  it("equals the actor's transform under the identity offset", () => {
    const actor = actorAt({ x: 30, y: -12, z: 8 }, QUARTER_Y, {
      x: 2,
      y: 0.5,
      z: 1,
    });
    const component = actor.attach(new Component());

    expect(component.worldTransform()).toEqual(actor.transform);
  });

  it("returns a snapshot the caller owns rather than a live object", () => {
    const actor = actorAt({ x: 10, y: 20, z: 30 });
    const component = actor.attach(new Component());

    const snapshot = component.worldTransform();
    snapshot.position.x = 999;
    actor.transform.position.y = 40;

    expect(actor.transform.position.x).toBe(10);
    expect(component.worldTransform().position.x).toBe(10);
    expect(snapshot.position.y).toBe(20);
  });

  it("translates the offset by the actor's position", () => {
    const actor = actorAt({ x: 100, y: 50, z: -20 });
    const component = actor.attach(new Component());
    component.offset.position = { x: 8, y: -6, z: 2 };

    const world = component.worldTransform();

    expect(world.position.x).toBeCloseTo(108, 9);
    expect(world.position.y).toBeCloseTo(44, 9);
    expect(world.position.z).toBeCloseTo(-18, 9);
  });

  it("scales the offset into the actor's frame before translating", () => {
    const actor = actorAt(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 2, y: 3, z: 4 },
    );
    const component = actor.attach(new Component());
    component.offset.position = { x: 5, y: 7, z: -1 };

    const world = component.worldTransform();

    expect(world.position.x).toBeCloseTo(10, 9);
    expect(world.position.y).toBeCloseTo(21, 9);
    expect(world.position.z).toBeCloseTo(-4, 9);
  });

  it("rotates the offset by the actor's rotation — a quarter turn about +Y carries +X onto −Z", () => {
    const actor = actorAt({ x: 0, y: 0, z: 0 }, QUARTER_Y);
    const component = actor.attach(new Component());
    component.offset.position = { x: 10, y: 0, z: 0 };

    const world = component.worldTransform();

    expect(world.position.x).toBeCloseTo(0, 9);
    expect(world.position.y).toBeCloseTo(0, 9);
    expect(world.position.z).toBeCloseTo(-10, 9);
  });

  it("composes the rotations with the offset's turning first, in the actor's frame", () => {
    const actor = actorAt({ x: 0, y: 0, z: 0 }, QUARTER_Y);
    const component = actor.attach(new Component());
    component.offset.rotation = QUARTER_Y;

    const world = component.worldTransform();

    // Two quarter turns about the same axis are a half turn; the composition
    // is quatMultiply(actor, offset), the order the docs pin.
    const half = quatMultiply(QUARTER_Y, QUARTER_Y);
    expect(world.rotation.x).toBeCloseTo(half.x, 9);
    expect(world.rotation.y).toBeCloseTo(half.y, 9);
    expect(world.rotation.z).toBeCloseTo(half.z, 9);
    expect(world.rotation.w).toBeCloseTo(half.w, 9);
  });

  it("multiplies the scales componentwise", () => {
    const actor = actorAt(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 2, y: 4, z: 8 },
    );
    const component = actor.attach(new Component());
    component.offset.scale = { x: 3, y: 0.5, z: 0.25 };

    expect(component.worldTransform().scale).toEqual({ x: 6, y: 2, z: 2 });
  });

  it("composes scale, rotation, and translation together", () => {
    // Offset (4, 0, 0) scaled by 2 is (8, 0, 0); the quarter turn about +Y
    // carries it to (0, 0, −8); the actor's position then translates it.
    const actor = actorAt({ x: 10, y: 20, z: 30 }, QUARTER_Y, {
      x: 2,
      y: 2,
      z: 2,
    });
    const component = actor.attach(new Component());
    component.offset.position = { x: 4, y: 0, z: 0 };

    const world = component.worldTransform();

    expect(world.position.x).toBeCloseTo(10, 9);
    expect(world.position.y).toBeCloseTo(20, 9);
    expect(world.position.z).toBeCloseTo(22, 9);
  });
});

describe("RenderComponent", () => {
  it("defaults to layer 0, visible, and full opacity", () => {
    const component = new RenderComponent();

    expect(component.layer).toBe(0);
    expect(component.visible).toBe(true);
    expect(component.opacity).toBe(1);
  });

  it("is a component, so it carries an offset and an enabled bit", () => {
    const component = new RenderComponent();

    expect(component).toBeInstanceOf(Component);
    expect(component.enabled).toBe(true);
  });
});

describe("MeshComponent", () => {
  it("draws the file's own materials at the bind pose by default", () => {
    const handle = mesh(["idle"]);
    const component = new MeshComponent({ mesh: handle });

    expect(component.mesh).toBe(handle);
    expect(component.material).toBeNull();
    expect(component.color).toBeNull();
    expect(component.clip).toBeNull();
    expect(component.clipTime).toBe(0);
  });

  it("settles its options into the documented fields", () => {
    const component = new MeshComponent({
      mesh: mesh(["run"]),
      color: "#9ad1ff",
      clip: "run",
      clipTime: 0.25,
    });

    expect(component.color).toBe("#9ad1ff");
    expect(component.clip).toBe("run");
    expect(component.clipTime).toBe(0.25);
  });

  it("is a render component, with the clip fields left mutable for a tick to advance", () => {
    const component = new MeshComponent({ mesh: mesh(["walk"]) });

    expect(component).toBeInstanceOf(RenderComponent);

    // The engine never advances clipTime; a game animates by writing it.
    component.clip = "walk";
    component.clipTime += 1 / 60;
    expect(component.clipTime).toBeCloseTo(1 / 60, 12);
  });
});

describe("ShapeComponent", () => {
  it("defaults to a white surface with no material", () => {
    const component = new ShapeComponent({
      shape: { kind: "sphere", radius: 4 },
    });

    expect(component.color).toBe("#ffffff");
    expect(component.material).toBeNull();
  });

  it("settles its options into the documented fields", () => {
    const component = new ShapeComponent({
      shape: { kind: "box", size: { x: 16, y: 4, z: 72 } },
      color: "#e6edf6",
    });

    expect(component.shape).toEqual({
      kind: "box",
      size: { x: 16, y: 4, z: 72 },
    });
    expect(component.color).toBe("#e6edf6");
  });

  it("carries a capsule as given — radius, and height between the cap centers", () => {
    const component = new ShapeComponent({
      shape: { kind: "capsule", radius: 0.5, height: 2 },
    });

    expect(component.shape).toEqual({
      kind: "capsule",
      radius: 0.5,
      height: 2,
    });
  });
});

describe("TextComponent", () => {
  it("defaults to 16px in the engine's face, white, centered on its transform", () => {
    const text = new TextComponent({ text: "READY" });

    expect(text.text).toBe("READY");
    expect(text.font).toBe("16px monospace");
    expect(text.fill).toBe("#ffffff");
    expect(text.align).toBe("center");
    expect(text.baseline).toBe("middle");
  });

  it("settles its options into the documented fields", () => {
    const text = new TextComponent({
      text: "0 : 0",
      font: "2px monospace",
      fill: "#9ad1ff",
      align: "left",
      baseline: "top",
    });

    expect(text.font).toBe("2px monospace");
    expect(text.fill).toBe("#9ad1ff");
    expect(text.align).toBe("left");
    expect(text.baseline).toBe("top");
  });
});

describe("textHeightOf", () => {
  it("reads the pixel size out of the shorthand, as world units of text height", () => {
    expect(textHeightOf("16px monospace")).toBe(16);
    expect(textHeightOf("24px monospace")).toBe(24);
    expect(textHeightOf("0.5px serif")).toBe(0.5);
  });

  it("finds the size behind style and weight prefixes", () => {
    expect(textHeightOf("italic 700 12px 'Fira Code'")).toBe(12);
  });

  it("answers the default size for a shorthand naming none, rather than refusing", () => {
    expect(textHeightOf("monospace")).toBe(16);
    expect(textHeightOf("")).toBe(16);
  });
});

describe("DrawComponent", () => {
  it("is subclassed with a draw the pipeline calls in layer order", () => {
    const seen: DrawApi[] = [];

    class Starfield extends DrawComponent {
      draw(api: DrawApi): void {
        seen.push(api);
      }
    }

    const component = new Starfield();
    const api = { mode: "standard" } as DrawApi;
    component.draw(api);

    expect(component).toBeInstanceOf(RenderComponent);
    expect(seen).toEqual([api]);
  });
});

describe("CameraComponent", () => {
  it("defaults its field of view to π/3, with and without an options object", () => {
    expect(new CameraComponent().fovY).toBe(Math.PI / 3);
    expect(new CameraComponent({}).fovY).toBe(Math.PI / 3);
  });

  it("takes the fovY the options name", () => {
    expect(new CameraComponent({ fovY: Math.PI / 2 }).fovY).toBe(Math.PI / 2);
  });

  it("is a plain component rather than a drawn one", () => {
    const camera = new CameraComponent();

    expect(camera).toBeInstanceOf(Component);
    expect(camera).not.toBeInstanceOf(RenderComponent);
  });
});

describe("light components", () => {
  it("default to white at full intensity", () => {
    const ambient = new AmbientLightComponent();

    expect(ambient.color).toBe("#ffffff");
    expect(ambient.intensity).toBe(1);
  });

  it("take the color and intensity the options name", () => {
    const light = new DirectionalLightComponent({
      color: "#ffe8c0",
      intensity: 0.6,
    });

    expect(light.color).toBe("#ffe8c0");
    expect(light.intensity).toBe(0.6);
  });

  it("give a point light a range reaching everywhere by default", () => {
    expect(new PointLightComponent().range).toBe(0);
    expect(new PointLightComponent({ range: 12 }).range).toBe(12);
  });

  it("are lights, and plain components rather than drawn ones", () => {
    for (const light of [
      new AmbientLightComponent(),
      new DirectionalLightComponent(),
      new PointLightComponent(),
    ]) {
      expect(light).toBeInstanceOf(LightComponent);
      expect(light).toBeInstanceOf(Component);
      expect(light).not.toBeInstanceOf(RenderComponent);
    }
  });
});

describe("lightStateOf", () => {
  it("snapshots an ambient as its color and intensity alone", () => {
    const actor = actorAt({ x: 3, y: 4, z: 5 });
    const light = actor.attach(
      new AmbientLightComponent({ color: "#202030", intensity: 0.4 }),
    );

    expect(lightStateOf(light)).toEqual({
      type: "ambient",
      color: "#202030",
      intensity: 0.4,
    });
  });

  it("aims a directional along the world rotation applied to local −Z", () => {
    const actor = actorAt(
      { x: 0, y: 0, z: 0 },
      quatFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2),
    );
    const light = actor.attach(new DirectionalLightComponent());

    const state = lightStateOf(light);
    if (state.type !== "directional") throw new Error("expected directional");

    // A quarter turn about +X carries −Z onto +Y: the actor aimed its light up.
    expect(state.direction.x).toBeCloseTo(0, 9);
    expect(state.direction.y).toBeCloseTo(1, 9);
    expect(state.direction.z).toBeCloseTo(0, 9);
  });

  it("shines an unrotated directional straight down the −Z a camera looks", () => {
    const light = actorAt({ x: 0, y: 0, z: 0 }).attach(
      new DirectionalLightComponent(),
    );

    const state = lightStateOf(light);
    if (state.type !== "directional") throw new Error("expected directional");

    expect(state.direction.x).toBeCloseTo(0, 9);
    expect(state.direction.y).toBeCloseTo(0, 9);
    expect(state.direction.z).toBeCloseTo(-1, 9);
  });

  it("places a point light at its world position with its range unscaled", () => {
    const actor = actorAt(
      { x: 3, y: 4, z: 5 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 2, y: 2, z: 2 },
    );
    const light = actor.attach(new PointLightComponent({ range: 7 }));
    light.offset.position = { x: 1, y: 0, z: 0 };

    const state = lightStateOf(light);
    if (state.type !== "point") throw new Error("expected point");

    // The offset scales into the actor's frame (1 · 2), the range does not.
    expect(state.position.x).toBeCloseTo(5, 9);
    expect(state.position.y).toBeCloseTo(4, 9);
    expect(state.position.z).toBeCloseTo(5, 9);
    expect(state.range).toBe(7);
  });
});

describe("defaultLightRig", () => {
  it("is one ambient at 0.4 and one directional at 0.8, aimed down (−1, −2, −1)", () => {
    expect(defaultLightRig()).toEqual([
      { type: "ambient", color: "#ffffff", intensity: 0.4 },
      {
        type: "directional",
        color: "#ffffff",
        intensity: 0.8,
        direction: vec3Normalize({ x: -1, y: -2, z: -1 }),
      },
    ]);
  });

  it("aims through a unit direction", () => {
    const rig = defaultLightRig();
    const directional = rig[1];
    if (directional?.type !== "directional") throw new Error("expected rig");
    const { x, y, z } = directional.direction;

    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
  });

  it("hands out a fresh list the caller owns, so recordings stay canonical", () => {
    const kept = defaultLightRig();
    const directional = kept[1];
    if (directional?.type !== "directional") throw new Error("expected rig");
    directional.direction.x = 9;

    expect(defaultLightRig()).toEqual([
      { type: "ambient", color: "#ffffff", intensity: 0.4 },
      {
        type: "directional",
        color: "#ffffff",
        intensity: 0.8,
        direction: vec3Normalize({ x: -1, y: -2, z: -1 }),
      },
    ]);
  });
});

describe("scaleShape3", () => {
  it("scales a box's size per axis, as magnitudes", () => {
    expect(
      scaleShape3(
        { kind: "box", size: { x: 2, y: 4, z: 6 } },
        { x: 2, y: -3, z: 0.5 },
      ),
    ).toEqual({ kind: "box", size: { x: 4, y: 12, z: 3 } });
  });

  it("scales a sphere's radius by the largest of the three factors' magnitudes", () => {
    expect(
      scaleShape3({ kind: "sphere", radius: 2 }, { x: -3, y: 1, z: 2 }),
    ).toEqual({ kind: "sphere", radius: 6 });
  });

  it("scales a capsule's radius by the largest magnitude and its height by the y factor", () => {
    expect(
      scaleShape3(
        { kind: "capsule", radius: 1, height: 4 },
        { x: 0.5, y: -2, z: 1 },
      ),
    ).toEqual({ kind: "capsule", radius: 2, height: 8 });
  });
});
