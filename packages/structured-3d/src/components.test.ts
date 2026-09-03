import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Actor } from "./actors";
import {
  advanceModelAnimation,
  CameraComponent,
  Component,
  declarationRevision,
  DrawComponent,
  LightComponent,
  MeshComponent,
  ModelComponent,
  modelObject,
  Object3DComponent,
  RenderComponent,
  ShapeComponent,
  SpriteComponent,
  TextComponent,
} from "./components";
import type { DrawApi, EndPlayReason, Model, Quat, Vec3 } from "./contract";
import {
  composeTransforms,
  quatFromAxisAngle,
  quatMultiply,
  transformToMatrix,
  UP,
} from "./math";
import type { World } from "./worlds";

/* -------------------------------------------------------------------------- */
/* Doubles                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * jsdom has no `ImageBitmap`; a sprite only reads `width` and `height` off its
 * image, so a plain record cast to the type is the whole double.
 */
function bitmap(width: number, height: number): ImageBitmap {
  return { width, height } as ImageBitmap;
}

/**
 * A world reference for the components that read one. Nothing under test calls
 * through it — `Component.world` only has to hand back what the actor holds.
 */
function fakeWorld(): World {
  return {} as World;
}

/** An actor with a world, as the engine hands one to a component. */
function actorInWorld(world: World = fakeWorld()): Actor {
  const actor = new Actor();
  (actor as { world: World }).world = world;
  return actor;
}

/** An actor placed at a known transform, so composition sums are exact. */
function actorAt(position: Vec3, rotation?: Quat, scale?: Vec3): Actor {
  const actor = new Actor();
  actor.transform.position = { ...position };
  if (rotation) actor.transform.rotation = { ...rotation };
  if (scale) actor.transform.scale = { ...scale };
  return actor;
}

/**
 * A rig whose nodes an animation can pose: a named root with a named head and
 * a named arm under it, exactly the shape the voxel exporter writes.
 */
function rig(animations: readonly THREE.AnimationClip[] = []): Model {
  const scene = new THREE.Group();
  scene.name = "rig";
  const head = new THREE.Object3D();
  head.name = "head";
  const arm = new THREE.Object3D();
  arm.name = "arm";
  head.add(arm);
  scene.add(head);
  return { scene, animations, nodes: ["rig", "head", "arm"] };
}

/** A clip that raises the rig's head from `y = 0` to `y = 2` over `duration`. */
function headClip(name: string, duration = 1): THREE.AnimationClip {
  const track = new THREE.VectorKeyframeTrack(
    "head.position",
    [0, duration],
    [0, 0, 0, 0, 2, 0],
  );
  return new THREE.AnimationClip(name, duration, [track]);
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

describe("Component", () => {
  it("starts with the identity offset, so an untouched component sits on its actor", () => {
    expect(new Component().offset).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it("gives every component its own nested records, so writing one moves one", () => {
    const first = new Component();
    const second = new Component();

    first.offset.position.x = 5;
    first.offset.rotation.w = 0;
    first.offset.scale.z = 3;

    expect(second.offset.position.x).toBe(0);
    expect(second.offset.rotation.w).toBe(1);
    expect(second.offset.scale.z).toBe(1);
    expect(Object.isFrozen(first.offset.position)).toBe(false);
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

  it("is handed its actor by attach, before beginPlay runs", () => {
    const seen: (Actor | undefined)[] = [];

    class Watcher extends Component {
      override beginPlay(): void {
        seen.push(this.actor);
      }
    }

    const actor = actorInWorld();
    const component = actor.attach(new Watcher());

    expect(component.actor).toBe(actor);
    expect(seen).toEqual([]);
  });

  it("reads its world through the actor it is attached to", () => {
    const world = fakeWorld();
    const actor = actorInWorld(world);

    expect(actor.attach(new Component()).world).toBe(world);
  });

  it("ticks after its actor, in attachment order", () => {
    const order: string[] = [];

    class Note extends Component {
      constructor(private readonly label: string) {
        super();
      }
      override tick(dt: number): void {
        order.push(`${this.label}:${dt}`);
      }
    }

    const actor = actorInWorld();
    const first = actor.attach(new Note("first"));
    const second = actor.attach(new Note("second"));

    expect(actor.components).toEqual([first, second]);
    for (const component of actor.components) component.tick(0.5);
    expect(order).toEqual(["first:0.5", "second:0.5"]);
  });

  it("is told why its play ended", () => {
    const reasons: EndPlayReason[] = [];

    class Note extends Component {
      override endPlay(reason: EndPlayReason): void {
        reasons.push(reason);
      }
    }

    const actor = actorInWorld();
    const component = actor.attach(new Note());
    actor.detach(component);

    expect(reasons).toEqual(["destroyed"]);
  });

  it("is selected off its actor by class", () => {
    const actor = actorInWorld();
    const mesh = actor.attach(
      new MeshComponent({ geometry: { kind: "sphere", radius: 1 } }),
    );
    const text = actor.attach(new TextComponent({ text: "hi" }));

    expect(actor.component(MeshComponent)).toBe(mesh);
    expect(actor.componentsOf(RenderComponent)).toEqual([mesh, text]);
    expect(actor.component(LightComponent)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Component.worldTransform                                                   */
/* -------------------------------------------------------------------------- */

describe("Component.worldTransform", () => {
  it("equals the actor's transform under the identity offset", () => {
    const actor = actorAt(
      { x: 30, y: -12, z: 4 },
      quatFromAxisAngle(UP, Math.PI / 3),
      { x: 2, y: 0.5, z: 1.5 },
    );
    const component = actor.attach(new Component());

    expect(component.worldTransform()).toEqual(actor.transform);
  });

  it("returns a fresh record the caller owns, nested vectors included", () => {
    const actor = actorAt({ x: 10, y: 20, z: 30 });
    const component = actor.attach(new Component());

    const snapshot = component.worldTransform();
    expect(snapshot).not.toBe(actor.transform);
    expect(snapshot.position).not.toBe(actor.transform.position);

    snapshot.position.x = 999;
    actor.transform.position.y = 40;

    expect(actor.transform.position.x).toBe(10);
    expect(component.worldTransform().position.x).toBe(10);
    expect(snapshot.position.y).toBe(20);
  });

  it("translates the offset by the actor's position", () => {
    const actor = actorAt({ x: 100, y: 50, z: -20 });
    const component = actor.attach(new Component());
    component.offset.position = { x: 8, y: -6, z: 1 };

    expect(component.worldTransform().position).toEqual({
      x: 108,
      y: 44,
      z: -19,
    });
  });

  it("scales the offset into the actor's frame before translating", () => {
    const actor = actorAt({ x: 0, y: 0, z: 0 }, undefined, {
      x: 2,
      y: 3,
      z: 4,
    });
    const component = actor.attach(new Component());
    component.offset.position = { x: 5, y: 7, z: 1 };

    const world = component.worldTransform().position;

    expect(world.x).toBeCloseTo(10, 9);
    expect(world.y).toBeCloseTo(21, 9);
    expect(world.z).toBeCloseTo(4, 9);
  });

  it("rotates the offset by the actor's rotation — a yaw about +Y carries +X onto -Z", () => {
    const actor = actorAt(
      { x: 0, y: 0, z: 0 },
      quatFromAxisAngle(UP, Math.PI / 2),
    );
    const component = actor.attach(new Component());
    component.offset.position = { x: 2, y: 0, z: 0 };

    const world = component.worldTransform().position;

    expect(world.x).toBeCloseTo(0, 9);
    expect(world.y).toBeCloseTo(0, 9);
    expect(world.z).toBeCloseTo(-2, 9);
  });

  it("composes rotations as quatMultiply(actor, offset) and multiplies scales per axis", () => {
    const actorRotation = quatFromAxisAngle(UP, 0.5);
    const offsetRotation = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.25);
    const actor = actorAt({ x: 0, y: 0, z: 0 }, actorRotation, {
      x: 2,
      y: 4,
      z: 0.5,
    });
    const component = actor.attach(new Component());
    component.offset.rotation = offsetRotation;
    component.offset.scale = { x: 3, y: 0.5, z: 2 };

    const world = component.worldTransform();
    const expected = quatMultiply(actorRotation, offsetRotation);

    expect(world.rotation.x).toBeCloseTo(expected.x, 12);
    expect(world.rotation.y).toBeCloseTo(expected.y, 12);
    expect(world.rotation.z).toBeCloseTo(expected.z, 12);
    expect(world.rotation.w).toBeCloseTo(expected.w, 12);
    expect(world.scale).toEqual({ x: 6, y: 2, z: 1 });
  });

  it("composes scale, then rotation, then translation together", () => {
    // Offset (3, 0, 0) scaled by 2 is (6, 0, 0); a quarter turn about +Y puts
    // it at (0, 0, -6); the actor's position then translates it.
    const actor = actorAt(
      { x: 10, y: 0, z: 0 },
      quatFromAxisAngle(UP, Math.PI / 2),
      { x: 2, y: 2, z: 2 },
    );
    const component = actor.attach(new Component());
    component.offset.position = { x: 3, y: 0, z: 0 };

    const world = component.worldTransform().position;

    expect(world.x).toBeCloseTo(10, 9);
    expect(world.y).toBeCloseTo(0, 9);
    expect(world.z).toBeCloseTo(-6, 9);
  });

  it("is composeTransforms of the actor's transform and the offset", () => {
    const actor = actorAt(
      { x: -4, y: 7, z: 2 },
      quatFromAxisAngle({ x: 0.3, y: 0.6, z: 0.2 }, 1.1),
      { x: 1.5, y: 0.75, z: 2 },
    );
    const component = actor.attach(new Component());
    component.offset.position = { x: 1, y: -2, z: 3 };
    component.offset.rotation = quatFromAxisAngle(UP, -0.4);
    component.offset.scale = { x: 2, y: 2, z: 2 };

    expect(component.worldTransform()).toEqual(
      composeTransforms(actor.transform, component.offset),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Component.worldMatrix                                                      */
/* -------------------------------------------------------------------------- */

describe("Component.worldMatrix", () => {
  it("is the identity for a component on an actor at the identity", () => {
    const component = actorInWorld().attach(new Component());

    expect(component.worldMatrix()).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
  });

  it("is the same placement as worldTransform, column-major", () => {
    const actor = actorAt({ x: 3, y: -1, z: 8 }, quatFromAxisAngle(UP, 0.9), {
      x: 2,
      y: 1,
      z: 0.5,
    });
    const component = actor.attach(new Component());
    component.offset.position = { x: 0, y: 1, z: 0 };
    component.offset.rotation = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.2);

    expect(component.worldMatrix()).toEqual(
      transformToMatrix(component.worldTransform()),
    );
  });

  it("carries the world position in entries 12 to 14", () => {
    const actor = actorAt({ x: 5, y: 6, z: 7 });
    const component = actor.attach(new Component());
    component.offset.position = { x: 1, y: 1, z: 1 };

    const m = component.worldMatrix();

    expect(m).toHaveLength(16);
    expect(m[12]).toBeCloseTo(6, 9);
    expect(m[13]).toBeCloseTo(7, 9);
    expect(m[14]).toBeCloseTo(8, 9);
  });
});

/* -------------------------------------------------------------------------- */
/* RenderComponent                                                            */
/* -------------------------------------------------------------------------- */

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

  it("leaves opacity as written — the pipeline is what clamps it to 0..1", () => {
    const component = new RenderComponent();
    component.opacity = 1.5;

    expect(component.opacity).toBe(1.5);
  });

  it("fixes the drawing space by class: world for volumes, screen for the layer over them", () => {
    const image = bitmap(8, 8);

    class Direct extends DrawComponent {
      draw(): void {}
    }

    expect(
      new MeshComponent({ geometry: { kind: "sphere", radius: 1 } }).space,
    ).toBe("world");
    expect(new ModelComponent({ model: rig() }).space).toBe("world");
    expect(new LightComponent({ light: { kind: "ambient" } }).space).toBe(
      "world",
    );
    expect(new Object3DComponent({ object: new THREE.Object3D() }).space).toBe(
      "world",
    );
    expect(new SpriteComponent({ image }).space).toBe("screen");
    expect(
      new ShapeComponent({ shape: { kind: "circle", radius: 2 } }).space,
    ).toBe("screen");
    expect(new TextComponent({ text: "hi" }).space).toBe("screen");
    expect(new Direct().space).toBe("screen");
  });
});

/* -------------------------------------------------------------------------- */
/* MeshComponent                                                              */
/* -------------------------------------------------------------------------- */

describe("MeshComponent", () => {
  it("holds the geometry it was given", () => {
    const geometry = { kind: "box", width: 2, height: 0.6, depth: 3 } as const;
    const mesh = new MeshComponent({ geometry });

    expect(mesh.geometry).toBe(geometry);
  });

  it("defaults its material to an empty spec, which is every MaterialSpec default", () => {
    expect(
      new MeshComponent({ geometry: { kind: "capsule", radius: 1, height: 2 } })
        .material,
    ).toEqual({});
  });

  it("holds the material spec the game handed over, unmerged", () => {
    const material = { color: "#7fd1ff", roughness: 0.4 };
    const mesh = new MeshComponent({
      geometry: { kind: "sphere", radius: 0.5 },
      material,
    });

    expect(mesh.material).toBe(material);
  });

  it("is not a billboard and casts and receives no shadow by default", () => {
    const mesh = new MeshComponent({
      geometry: { kind: "plane", width: 4, height: 4 },
    });

    expect(mesh.billboard).toBe(false);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
  });

  it("takes the billboard flag the options name", () => {
    const mesh = new MeshComponent({
      geometry: { kind: "plane", width: 1, height: 1 },
      billboard: true,
    });

    expect(mesh.billboard).toBe(true);
  });

  it("carries a custom geometry as given", () => {
    const geometry = new THREE.BufferGeometry();
    const mesh = new MeshComponent({ geometry: { kind: "custom", geometry } });

    expect(mesh.geometry).toEqual({ kind: "custom", geometry });
  });

  it("is a render component in the world pass", () => {
    const mesh = new MeshComponent({
      geometry: { kind: "cylinder", radiusTop: 1, radiusBottom: 1, height: 2 },
    });

    expect(mesh).toBeInstanceOf(RenderComponent);
    expect(mesh.layer).toBe(0);
    expect(mesh.space).toBe("world");
  });

  it("starts at declaration revision 0, so a fresh component asks for no rebuild", () => {
    expect(
      declarationRevision(
        new MeshComponent({ geometry: { kind: "sphere", radius: 1 } }),
      ),
    ).toBe(0);
  });

  it("counts every assignment to geometry and material as a change", () => {
    const mesh = new MeshComponent({
      geometry: { kind: "sphere", radius: 1 },
    });

    mesh.geometry = { kind: "box", width: 1, height: 1, depth: 1 };
    expect(declarationRevision(mesh)).toBe(1);

    mesh.material = { color: "#ff0044" };
    expect(declarationRevision(mesh)).toBe(2);
  });

  it("counts a reassignment of the same object, so a mutated spec is picked up", () => {
    const material = { color: "#ffffff" };
    const mesh = new MeshComponent({
      geometry: { kind: "sphere", radius: 1 },
      material,
    });

    material.color = "#000000";
    expect(declarationRevision(mesh)).toBe(0);

    mesh.material = material;
    expect(declarationRevision(mesh)).toBe(1);
    expect(mesh.material).toBe(material);
  });

  it("counts nothing for a spec mutated in place and left unassigned", () => {
    const mesh = new MeshComponent({
      geometry: { kind: "sphere", radius: 1 },
      material: { color: "#ffffff" },
    });

    mesh.material.color = "#123456";
    mesh.visible = false;
    mesh.opacity = 0.5;
    mesh.layer = 10;

    expect(declarationRevision(mesh)).toBe(0);
  });

  it("counts its own revisions, not a sibling's", () => {
    const first = new MeshComponent({
      geometry: { kind: "sphere", radius: 1 },
    });
    const second = new MeshComponent({
      geometry: { kind: "sphere", radius: 1 },
    });

    first.geometry = { kind: "sphere", radius: 2 };

    expect(declarationRevision(first)).toBe(1);
    expect(declarationRevision(second)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* ModelComponent                                                             */
/* -------------------------------------------------------------------------- */

describe("ModelComponent", () => {
  it("holds the model it was built from and clones its scene", () => {
    const model = rig();
    const component = new ModelComponent({ model });

    expect(component.model).toBe(model);
    expect(modelObject(component)).not.toBe(model.scene);
    expect(modelObject(component).getObjectByName("head")).not.toBeUndefined();
  });

  it("gives every component its own clone, so one model backs many placements", () => {
    const model = rig();
    const first = new ModelComponent({ model });
    const second = new ModelComponent({ model });

    expect(modelObject(first)).not.toBe(modelObject(second));
    expect(modelObject(first).getObjectByName("head")).not.toBe(
      modelObject(second).getObjectByName("head"),
    );
  });

  it("casts and receives no shadow by default, and draws in the world pass", () => {
    const component = new ModelComponent({ model: rig() });

    expect(component.castShadow).toBe(false);
    expect(component.receiveShadow).toBe(false);
    expect(component).toBeInstanceOf(RenderComponent);
    expect(component.space).toBe("world");
  });

  it("plays nothing until asked", () => {
    const component = new ModelComponent({ model: rig([headClip("walk")]) });

    expect(component.animation()).toBeNull();
    expect(component.time).toBe(0);
  });

  it("plays an animation named at construction, looping from the first frame", () => {
    const component = new ModelComponent({
      model: rig([headClip("idle"), headClip("walk")]),
      animation: "walk",
    });

    expect(component.animation()).toBe("walk");
    expect(component.time).toBe(0);
  });

  it("throws naming the animation when the model lacks it", () => {
    const component = new ModelComponent({ model: rig([headClip("walk")]) });

    expect(() => component.play("sprint")).toThrow(/sprint/);
    expect(() => component.play("sprint")).toThrow(/walk/);
  });

  it("throws from the constructor for an animation named there that the model lacks", () => {
    expect(
      () => new ModelComponent({ model: rig(), animation: "walk" }),
    ).toThrow(/walk/);
  });

  it("reports the clip that is playing, and null once it is stopped", () => {
    const component = new ModelComponent({
      model: rig([headClip("idle"), headClip("walk")]),
    });

    component.play("walk");
    expect(component.animation()).toBe("walk");

    component.play("idle");
    expect(component.animation()).toBe("idle");

    component.stop();
    expect(component.animation()).toBeNull();
    expect(component.time).toBe(0);
  });

  it("advances the playing clip by the delta the pipeline hands it", () => {
    const component = new ModelComponent({
      model: rig([headClip("walk", 2)]),
      animation: "walk",
    });

    advanceModelAnimation(component, 0.25);
    expect(component.time).toBeCloseTo(0.25, 9);

    advanceModelAnimation(component, 0.5);
    expect(component.time).toBeCloseTo(0.75, 9);
  });

  it("advances nothing on a paused world, which hands over a delta of zero", () => {
    const component = new ModelComponent({
      model: rig([headClip("walk", 2)]),
      animation: "walk",
    });

    advanceModelAnimation(component, 0.5);
    advanceModelAnimation(component, 0);

    expect(component.time).toBeCloseTo(0.5, 9);
  });

  it("multiplies the clip's own rate by speed", () => {
    const component = new ModelComponent({
      model: rig([headClip("walk", 4)]),
    });

    component.play("walk", { speed: 2 });
    advanceModelAnimation(component, 0.5);

    expect(component.time).toBeCloseTo(1, 9);
  });

  it("loops by default, so a clip past its duration wraps rather than stopping", () => {
    const component = new ModelComponent({
      model: rig([headClip("walk", 1)]),
      animation: "walk",
    });

    advanceModelAnimation(component, 1.25);

    expect(component.animation()).toBe("walk");
    expect(component.time).toBeCloseTo(0.25, 6);
  });

  it("plays once and holds the final pose under loop: false", () => {
    const component = new ModelComponent({ model: rig([headClip("jump", 1)]) });

    component.play("jump", { loop: false });
    advanceModelAnimation(component, 0.75);
    expect(component.time).toBeCloseTo(0.75, 9);

    advanceModelAnimation(component, 1);
    expect(component.time).toBeCloseTo(1, 9);
    expect(component.animation()).toBe("jump");

    advanceModelAnimation(component, 1);
    expect(component.time).toBeCloseTo(1, 9);
  });

  it("restarts a clip from its first frame when it is played again", () => {
    const component = new ModelComponent({
      model: rig([headClip("walk", 2)]),
      animation: "walk",
    });

    advanceModelAnimation(component, 1);
    component.play("walk");

    expect(component.time).toBe(0);
  });

  it("seeks through time, which a write of 0 restarts", () => {
    const component = new ModelComponent({
      model: rig([headClip("walk", 4)]),
      animation: "walk",
    });

    component.time = 1.5;
    expect(component.time).toBeCloseTo(1.5, 9);

    component.time = 0;
    expect(component.time).toBe(0);
  });

  it("has nothing to seek with no clip playing", () => {
    const component = new ModelComponent({ model: rig([headClip("walk")]) });

    component.time = 2;

    expect(component.time).toBe(0);
  });

  it("hands back a live handle onto a named node, and null for a name the model lacks", () => {
    const model = rig();
    const component = new ModelComponent({ model });

    const head = component.node("head");

    expect(head).not.toBeNull();
    expect(component.node("tail")).toBeNull();
    expect(component.node("head")).toBe(head);
    expect(head?.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(head?.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(head?.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("poses the clone's node when the handle's fields are written", () => {
    const component = new ModelComponent({ model: rig() });
    const head = component.node("head");
    if (!head) throw new Error("the rig has a head");

    head.position = { x: 1, y: 2, z: 3 };
    head.rotation = quatFromAxisAngle(UP, Math.PI / 2);
    head.scale = { x: 2, y: 2, z: 2 };

    const node = modelObject(component).getObjectByName("head");
    if (!node) throw new Error("the clone has a head");

    expect(node.position.toArray()).toEqual([1, 2, 3]);
    expect(node.scale.toArray()).toEqual([2, 2, 2]);
    expect(node.quaternion.y).toBeCloseTo(Math.SQRT1_2, 9);
    expect(head.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("hands back a fresh record on every read, so a value read is the caller's", () => {
    const component = new ModelComponent({ model: rig() });
    const head = component.node("head");
    if (!head) throw new Error("the rig has a head");

    const first = head.position;
    first.x = 99;

    expect(head.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(head.position).not.toBe(first);
  });

  it("finds a node anywhere in the tree, the root included", () => {
    const component = new ModelComponent({ model: rig() });

    expect(component.node("arm")).not.toBeNull();
    expect(component.node("rig")).not.toBeNull();
  });

  it("poses the nodes the playing clip animates when the mixer advances", () => {
    const model = rig([headClip("walk", 1)]);
    const component = new ModelComponent({ model, animation: "walk" });
    const head = component.node("head");
    if (!head) throw new Error("the rig has a head");

    advanceModelAnimation(component, 0.5);

    expect(head.position.y).toBeCloseTo(1, 6);
    // The template stays at its rest pose; only the clone was posed.
    expect(model.scene.getObjectByName("head")?.position.y).toBe(0);
  });

  it("animates each component of one model on its own", () => {
    const model = rig([headClip("walk", 1)]);
    const first = new ModelComponent({ model, animation: "walk" });
    const second = new ModelComponent({ model, animation: "walk" });

    advanceModelAnimation(first, 0.5);

    expect(first.node("head")?.position.y).toBeCloseTo(1, 6);
    expect(second.node("head")?.position.y).toBeCloseTo(0, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* LightComponent                                                             */
/* -------------------------------------------------------------------------- */

describe("LightComponent", () => {
  it("holds the spec it was given and draws in the world pass", () => {
    const light = {
      kind: "hemisphere",
      sky: "#cfe3ff",
      intensity: 0.6,
    } as const;
    const component = new LightComponent({ light });

    expect(component.light).toBe(light);
    expect(component).toBeInstanceOf(RenderComponent);
    expect(component.space).toBe("world");
    expect(component.visible).toBe(true);
    expect(component.enabled).toBe(true);
  });

  it("counts every assignment to light as a change", () => {
    const component = new LightComponent({
      light: { kind: "directional", intensity: 1.2, castShadow: true },
    });

    expect(declarationRevision(component)).toBe(0);

    component.light = { kind: "point", distance: 12 };
    expect(declarationRevision(component)).toBe(1);
    expect(component.light).toEqual({ kind: "point", distance: 12 });
  });
});

/* -------------------------------------------------------------------------- */
/* Object3DComponent                                                          */
/* -------------------------------------------------------------------------- */

describe("Object3DComponent", () => {
  it("carries the game's own subtree by identity, into the world pass", () => {
    const object = new THREE.Object3D();
    object.add(new THREE.Object3D());
    const component = new Object3DComponent({ object });

    expect(component.object).toBe(object);
    expect(component.object.children).toHaveLength(1);
    expect(component).toBeInstanceOf(RenderComponent);
    expect(component.space).toBe("world");
  });
});

/* -------------------------------------------------------------------------- */
/* SpriteComponent                                                            */
/* -------------------------------------------------------------------------- */

describe("SpriteComponent", () => {
  it("draws the whole image by default, at a logical unit per pixel", () => {
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

  it("accepts the anchors the options name, zero included", () => {
    const sprite = new SpriteComponent({
      image: bitmap(8, 8),
      anchorX: 0,
      anchorY: 1,
    });

    expect(sprite.anchorX).toBe(0);
    expect(sprite.anchorY).toBe(1);
  });

  it("carries no tint unless one is given", () => {
    expect(new SpriteComponent({ image: bitmap(8, 8) }).tint).toBeNull();
    expect(
      new SpriteComponent({ image: bitmap(8, 8), tint: "#ff0044" }).tint,
    ).toBe("#ff0044");
  });

  it("is a render component on the screen layer", () => {
    const sprite = new SpriteComponent({ image: bitmap(8, 8) });

    expect(sprite).toBeInstanceOf(RenderComponent);
    expect(sprite.layer).toBe(0);
    expect(sprite.space).toBe("screen");
  });
});

/* -------------------------------------------------------------------------- */
/* ShapeComponent                                                             */
/* -------------------------------------------------------------------------- */

describe("ShapeComponent", () => {
  it("draws nothing by default — no fill, no stroke, stroke width 1", () => {
    const shape = new ShapeComponent({ shape: { kind: "circle", radius: 4 } });

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

  it("carries a polygon's points as given, in logical units", () => {
    const points = [
      { x: 0, y: -8 },
      { x: 6, y: 8 },
      { x: -6, y: 8 },
    ];
    const shape = new ShapeComponent({ shape: { kind: "polygon", points } });

    expect(shape.shape).toEqual({ kind: "polygon", points });
    expect(shape.space).toBe("screen");
  });
});

/* -------------------------------------------------------------------------- */
/* TextComponent                                                              */
/* -------------------------------------------------------------------------- */

describe("TextComponent", () => {
  it("defaults to 16px sans-serif, white, centered on its transform", () => {
    const text = new TextComponent({ text: "READY" });

    expect(text.text).toBe("READY");
    expect(text.font).toBe("16px sans-serif");
    expect(text.fill).toBe("#ffffff");
    expect(text.align).toBe("center");
    expect(text.baseline).toBe("middle");
    expect(text.space).toBe("screen");
  });

  it("settles its options into the documented fields", () => {
    const text = new TextComponent({
      text: "0 - 0",
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

/* -------------------------------------------------------------------------- */
/* DrawComponent                                                              */
/* -------------------------------------------------------------------------- */

describe("DrawComponent", () => {
  it("is subclassed with a draw the pipeline calls in the screen pass", () => {
    const seen: DrawApi[] = [];

    class Marker extends DrawComponent {
      draw(api: DrawApi): void {
        seen.push(api);
      }
    }

    const component = new Marker();
    const api = { mode: "shaded" } as DrawApi;
    component.draw(api);

    expect(component).toBeInstanceOf(RenderComponent);
    expect(component.space).toBe("screen");
    expect(seen).toEqual([api]);
  });
});

/* -------------------------------------------------------------------------- */
/* CameraComponent                                                            */
/* -------------------------------------------------------------------------- */

describe("CameraComponent", () => {
  it("defaults its fov to 60 degrees, with and without an options object", () => {
    expect(new CameraComponent().fov).toBe(60);
    expect(new CameraComponent({}).fov).toBe(60);
  });

  it("takes the fov the options name", () => {
    expect(new CameraComponent({ fov: 50 }).fov).toBe(50);
  });

  it("is a plain component rather than a drawn one", () => {
    const camera = new CameraComponent();

    expect(camera).toBeInstanceOf(Component);
    expect(camera).not.toBeInstanceOf(RenderComponent);
  });

  it("is placed by its offset like any other component, so a chase view is an offset", () => {
    const actor = actorAt(
      { x: 0, y: 0, z: 0 },
      quatFromAxisAngle(UP, Math.PI / 2),
    );
    const view = actor.attach(new CameraComponent({ fov: 50 }));
    view.offset.position = { x: 0, y: 2.5, z: 7 };

    const world = view.worldTransform().position;

    expect(world.x).toBeCloseTo(7, 9);
    expect(world.y).toBeCloseTo(2.5, 9);
    expect(world.z).toBeCloseTo(0, 9);
  });
});
