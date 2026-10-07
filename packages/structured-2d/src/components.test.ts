import { describe, expect, it } from "vitest";
import { Actor } from "./actors";
import {
  CameraComponent,
  Component,
  DrawComponent,
  RenderComponent,
  ShapeComponent,
  SpriteComponent,
  TextComponent,
} from "./components";
import type { DrawApi, World } from "./contract";

/**
 * jsdom has no `ImageBitmap`; a sprite only reads `width` and `height` off its
 * image, so a plain record cast to the type is the whole double.
 */
function bitmap(width: number, height: number): ImageBitmap {
  return { width, height } as ImageBitmap;
}

/** An actor placed at a known transform, so composition sums are exact. */
function actorAt(
  x: number,
  y: number,
  rotation = 0,
  scaleX = 1,
  scaleY = 1,
): Actor {
  const actor = new Actor();
  actor.transform.x = x;
  actor.transform.y = y;
  actor.transform.rotation = rotation;
  actor.transform.scaleX = scaleX;
  actor.transform.scaleY = scaleY;
  return actor;
}

describe("Component", () => {
  it("starts with the identity offset, so an untouched component sits on its actor", () => {
    const component = new Component();

    expect(component.offset).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
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
    const actor = actorAt(30, -12, Math.PI / 3, 2, 0.5);
    const component = actor.attach(new Component());

    expect(component.worldTransform()).toEqual(actor.transform);
  });

  it("returns a snapshot the caller owns rather than a live object", () => {
    const actor = actorAt(10, 20);
    const component = actor.attach(new Component());

    const snapshot = component.worldTransform();
    snapshot.x = 999;
    actor.transform.y = 40;

    expect(actor.transform.x).toBe(10);
    expect(component.worldTransform().x).toBe(10);
    expect(snapshot.y).toBe(20);
  });

  it("translates the offset by the actor's position", () => {
    const actor = actorAt(100, 50);
    const component = actor.attach(new Component());
    component.offset.x = 8;
    component.offset.y = -6;

    const world = component.worldTransform();

    expect(world.x).toBeCloseTo(108, 9);
    expect(world.y).toBeCloseTo(44, 9);
  });

  it("scales the offset into the actor's frame before translating", () => {
    const actor = actorAt(0, 0, 0, 2, 3);
    const component = actor.attach(new Component());
    component.offset.x = 5;
    component.offset.y = 7;

    const world = component.worldTransform();

    expect(world.x).toBeCloseTo(10, 9);
    expect(world.y).toBeCloseTo(21, 9);
  });

  it("rotates the offset by the actor's rotation — clockwise, 0 along +x", () => {
    // A quarter turn clockwise in the y-down world carries +x onto +y.
    const actor = actorAt(0, 0, Math.PI / 2);
    const component = actor.attach(new Component());
    component.offset.x = 10;

    const world = component.worldTransform();

    expect(world.x).toBeCloseTo(0, 9);
    expect(world.y).toBeCloseTo(10, 9);
  });

  it("adds rotations and multiplies scales per axis", () => {
    const actor = actorAt(0, 0, 0.5, 2, 4);
    const component = actor.attach(new Component());
    component.offset.rotation = 0.25;
    component.offset.scaleX = 3;
    component.offset.scaleY = 0.5;

    const world = component.worldTransform();

    expect(world.rotation).toBeCloseTo(0.75, 9);
    expect(world.scaleX).toBeCloseTo(6, 9);
    expect(world.scaleY).toBeCloseTo(2, 9);
  });

  it("composes scale, rotation, and translation together", () => {
    // Offset (4, 0) scaled by 2 is (8, 0); an eighth turn puts it at
    // (8·cos45°, 8·sin45°); the actor's position then translates it.
    const actor = actorAt(10, 20, Math.PI / 4, 2, 2);
    const component = actor.attach(new Component());
    component.offset.x = 4;

    const world = component.worldTransform();

    expect(world.x).toBeCloseTo(10 + 8 * Math.SQRT1_2, 9);
    expect(world.y).toBeCloseTo(20 + 8 * Math.SQRT1_2, 9);
  });
});

describe("RenderComponent", () => {
  it("defaults to layer 0, visible, full opacity, and world space", () => {
    const component = new RenderComponent();

    expect(component.layer).toBe(0);
    expect(component.visible).toBe(true);
    expect(component.opacity).toBe(1);
    expect(component.space).toBe("world");
  });

  it("is a component, so it carries an offset and an enabled bit", () => {
    const component = new RenderComponent();

    expect(component).toBeInstanceOf(Component);
    expect(component.enabled).toBe(true);
  });
});

describe("SpriteComponent", () => {
  it("draws the whole image by default, at a world unit per pixel", () => {
    const sprite = new SpriteComponent({ image: bitmap(64, 32) });

    expect(sprite.source).toBeNull();
    expect(sprite.width).toBe(64);
    expect(sprite.height).toBe(32);
  });

  it("sizes itself from the source region when one is given", () => {
    const sprite = new SpriteComponent({
      image: bitmap(64, 32),
      source: { x: 16, y: 0, width: 16, height: 24 },
    });

    expect(sprite.source).toEqual({ x: 16, y: 0, width: 16, height: 24 });
    expect(sprite.width).toBe(16);
    expect(sprite.height).toBe(24);
  });

  it("lets an explicit size override the region's", () => {
    const sprite = new SpriteComponent({
      image: bitmap(64, 32),
      source: { x: 0, y: 0, width: 16, height: 16 },
      width: 40,
      height: 10,
    });

    expect(sprite.width).toBe(40);
    expect(sprite.height).toBe(10);
  });

  it("centers on its transform through the default anchors", () => {
    const sprite = new SpriteComponent({ image: bitmap(8, 8) });

    expect(sprite.anchorX).toBe(0.5);
    expect(sprite.anchorY).toBe(0.5);
  });

  it("carries no tint unless one is given", () => {
    expect(new SpriteComponent({ image: bitmap(8, 8) }).tint).toBeNull();
    expect(
      new SpriteComponent({ image: bitmap(8, 8), tint: "#ff0044" }).tint,
    ).toBe("#ff0044");
  });

  it("accepts the anchors the options name, zero included", () => {
    const sprite = new SpriteComponent({
      image: bitmap(8, 8),
      anchorX: 0,
      anchorY: 1,
    });

    expect(sprite.anchorX).toBe(0);
    expect(sprite.anchorY).toBe(1);
  });

  it("is a render component", () => {
    const sprite = new SpriteComponent({ image: bitmap(8, 8) });

    expect(sprite).toBeInstanceOf(RenderComponent);
    expect(sprite.layer).toBe(0);
  });
});

describe("ShapeComponent", () => {
  it("draws nothing by default — no fill, no stroke, stroke width 1", () => {
    const shape = new ShapeComponent({
      shape: { kind: "circle", radius: 4 },
    });

    expect(shape.fill).toBeNull();
    expect(shape.stroke).toBeNull();
    expect(shape.strokeWidth).toBe(1);
  });

  it("settles its options into the documented fields", () => {
    const shape = new ShapeComponent({
      shape: { kind: "rect", width: 16, height: 72 },
      fill: "#e6edf6",
      stroke: "#101418",
      strokeWidth: 2,
    });

    expect(shape.shape).toEqual({ kind: "rect", width: 16, height: 72 });
    expect(shape.fill).toBe("#e6edf6");
    expect(shape.stroke).toBe("#101418");
    expect(shape.strokeWidth).toBe(2);
  });

  it("carries a polygon's points as given", () => {
    const points = [
      { x: 0, y: -8 },
      { x: 6, y: 8 },
      { x: -6, y: 8 },
    ];
    const shape = new ShapeComponent({ shape: { kind: "polygon", points } });

    expect(shape.shape).toEqual({ kind: "polygon", points });
  });
});

describe("TextComponent", () => {
  it("defaults to 16px sans-serif, white, centered on its transform", () => {
    const text = new TextComponent({ text: "READY" });

    expect(text.text).toBe("READY");
    expect(text.font).toBe("16px sans-serif");
    expect(text.fill).toBe("#ffffff");
    expect(text.align).toBe("center");
    expect(text.baseline).toBe("middle");
  });

  it("settles its options into the documented fields", () => {
    const text = new TextComponent({
      text: "0 : 0",
      font: "24px monospace",
      fill: "#9ad1ff",
      align: "left",
      baseline: "top",
    });

    expect(text.font).toBe("24px monospace");
    expect(text.fill).toBe("#9ad1ff");
    expect(text.align).toBe("left");
    expect(text.baseline).toBe("top");
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
    const api = { mode: "shaded" } as DrawApi;
    component.draw(api);

    expect(component).toBeInstanceOf(RenderComponent);
    expect(seen).toEqual([api]);
  });
});

describe("CameraComponent", () => {
  it("defaults its zoom to 1, with and without an options object", () => {
    expect(new CameraComponent().zoom).toBe(1);
    expect(new CameraComponent({}).zoom).toBe(1);
  });

  it("takes the zoom the options name", () => {
    expect(new CameraComponent({ zoom: 2.5 }).zoom).toBe(2.5);
  });

  it("is a plain component rather than a drawn one", () => {
    const camera = new CameraComponent();

    expect(camera).toBeInstanceOf(Component);
    expect(camera).not.toBeInstanceOf(RenderComponent);
  });
});
