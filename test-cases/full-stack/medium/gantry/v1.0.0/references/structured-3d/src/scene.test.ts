import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor, Model, World } from "@test-cabinet/structured-3d";
import {
  DrawComponent,
  ModelComponent,
  Object3DComponent,
  ShapeComponent,
  TextComponent,
} from "@test-cabinet/structured-3d";
import { GantryState } from "./game";
import { MODEL_NAMES, setModels, type Models } from "./assets";
import { GantryView } from "./actor-view";
import { refreshViews, spawnReadouts, spawnScene } from "./scene";
import { addMoveStep, addObstacle, openSite, setScreen } from "./state";
import { project } from "./view";
import * as editor from "./editor";

/** A model of a given voxel size, standing from the origin like `voxel` writes. */
function stubModel(size: number): Model {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
  mesh.position.set(size / 2, size / 2, size / 2);
  scene.add(mesh);
  return { scene, animations: [], nodes: ["root"] };
}

beforeAll(() => {
  const models = {} as Record<string, Model>;
  for (const name of MODEL_NAMES) models[name] = stubModel(16);
  setModels(models as Models);
});

/**
 * Enough of a world to build the level's actors in and hand them a frame. The
 * engine is not stood up — it takes a `webgl2` context the moment it is created
 * and Node has none — so this is the seam the actors actually use.
 */
function fakeWorld(state: GantryState): World {
  const actors: Actor[] = [];
  const world = {
    state,
    spawn<A extends Actor>(type: new () => A): A {
      const actor = new type();
      (actor as { world: World }).world = world as unknown as World;
      actors.push(actor);
      actor.beginPlay();
      for (const component of actor.components) component.beginPlay();
      return actor;
    },
    actors: () => actors,
    ofType<A extends Actor>(type: new () => A): A[] {
      return actors.filter((actor): actor is A => actor instanceof type);
    },
  };
  return world as unknown as World;
}

/** The subtree one `Object3DComponent` in the world owns, by its name. */
function groupNamed(world: World, name: string): THREE.Object3D {
  const found = world
    .actors()
    .flatMap((actor) => [...actor.components])
    .filter((c) => c instanceof Object3DComponent)
    .map((c) => c.object)
    .find((object) => object.name === name);
  if (found === undefined) throw new Error(`no ${name} group`);
  return found;
}

const craneGroup = (world: World): THREE.Object3D => groupNamed(world, "crane");

/** Every render component in the world, however deep. */
const componentsOf = (world: World): readonly unknown[] =>
  world.actors().flatMap((actor) => [...actor.components]);

describe("spawnScene", () => {
  it("puts the yard in the world as render components", () => {
    const world = fakeWorld(new GantryState());
    spawnScene(world);
    expect(world.actors()).toHaveLength(4);
    const parts = componentsOf(world);
    expect(parts.some((c) => c instanceof Object3DComponent)).toBe(true);
    expect(
      parts.filter((c) => c instanceof Object3DComponent).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("stands a model where each of the site's subjects is", () => {
    const state = new GantryState();
    const world = fakeWorld(state);
    spawnScene(world);
    refreshViews(world);
    const models = componentsOf(world).filter(
      (c) => c instanceof ModelComponent,
    );
    // Site 0 carries four anchors and one waiting load, and an empty crane
    // carries no ring, no trolley, and no hook.
    expect(models).toHaveLength(5);
    expect(models.every((m) => m.visible)).toBe(true);
  });

  it("hides the copies a quieter frame does not take", () => {
    const state = new GantryState();
    const world = fakeWorld(state);
    spawnScene(world);
    refreshViews(world);
    openSite(state, 0);
    state.site = { loads: [], obstacles: [] };
    refreshViews(world);
    const models = componentsOf(world).filter(
      (c) => c instanceof ModelComponent,
    );
    expect(models.filter((m) => m.visible)).toHaveLength(4);
    expect(models.filter((m) => !m.visible)).toHaveLength(1);
  });

  it("draws every member the structure carries", () => {
    const state = new GantryState();
    setScreen(state, "build");
    const world = fakeWorld(state);
    spawnScene(world);
    editor.addMember(state, [0, 0, 0], [0, 2, 0], "strut");
    editor.addMember(state, [2, 0, 0], [2, 2, 0], "cable");
    refreshViews(world);
    const visible = craneGroup(world).children.filter((child) => child.visible);
    expect(visible).toHaveLength(2);
  });
});

describe("the crane and the site as the yard draws them", () => {
  /** A rail, a cable, a strut, and a broken member, all at once. */
  function mixed(state: GantryState): void {
    setScreen(state, "build");
    editor.addMember(state, [0, 0, 0], [0, 2, 0], "strut");
    editor.addMember(state, [2, 0, 0], [2, 2, 0], "cable");
    editor.setRing(state, [0, 2, 0]);
    editor.addMember(state, [0, 4, 0], [2, 4, 0], "rail");
    editor.addMember(state, [2, 4, 0], [4, 4, 0], "rail");
  }

  it("draws a rail with a head, a cable as rope, and a strut as a bar", () => {
    const state = new GantryState();
    const world = fakeWorld(state);
    spawnScene(world);
    mixed(state);
    refreshViews(world);
    const crane = craneGroup(world);
    const named = crane.children
      .filter((child) => child.visible)
      .map((child) => child.name)
      .sort();
    // A strut and two rails, each rail under its own head, are bars; the
    // cable member and the hoist cable are ropes.
    expect(named.filter((name) => name === "member")).toHaveLength(5);
    expect(named.filter((name) => name === "rope")).toHaveLength(2);
  });

  it("draws a broken member apart from the standing ones", () => {
    const state = new GantryState();
    const world = fakeWorld(state);
    spawnScene(world);
    mixed(state);
    state.run.phase = "running";
    state.run.broken = [0];
    state.run.intact = [];
    refreshViews(world);
    const named = craneGroup(world)
      .children.filter((child) => child.visible)
      .map((child) => child.name)
      .sort();
    expect(named.filter((name) => name === "broken")).toHaveLength(4);
    expect(named).not.toContain("member");
  });

  it("rebuilds the fixtures when the site changes and not before", () => {
    const state = new GantryState();
    const world = fakeWorld(state);
    spawnScene(world);
    refreshViews(world);
    const fixtures = groupNamed(world, "fixtures");
    const before = [...fixtures.children];
    refreshViews(world);
    expect(fixtures.children).toEqual(before);
    addObstacle(state, { x: 4, y: 0, z: 4 }, { x: 2, y: 4, z: 2 });
    refreshViews(world);
    // An obstacle adds its solid and its edges to what the site already drew.
    expect(fixtures.children.length).toBe(before.length + 2);
  });

  it("shows the lattice on the build screen and hides it on the run", () => {
    const state = new GantryState();
    setScreen(state, "build");
    const world = fakeWorld(state);
    spawnScene(world);
    refreshViews(world);
    const lattice = () =>
      groupNamed(world, "aids").children.find(
        (child) => child.name === "lattice",
      );
    expect(lattice()?.visible).toBe(true);
    setScreen(state, "run");
    refreshViews(world);
    expect(lattice()?.visible).toBe(false);
  });

  it("marks the node under the pointer and the node being held", () => {
    const state = new GantryState();
    setScreen(state, "build");
    const world = fakeWorld(state);
    spawnScene(world);
    const at = project(state.camera, [0, 2, 0]);
    state.pointer.x = at.x;
    state.pointer.y = at.y;
    state.pendingNode = { x: 2, y: 0, z: 0 };
    refreshViews(world);
    const markers = groupNamed(world, "aids").children.filter(
      (child) => child.name === "marker" && child.visible,
    );
    expect(markers).toHaveLength(2);
    setScreen(state, "program");
    refreshViews(world);
    expect(
      groupNamed(world, "aids").children.filter(
        (child) => child.name === "marker" && child.visible,
      ),
    ).toHaveLength(0);
  });
});

describe("spawnReadouts", () => {
  it("puts one actor on the screen layer per screen, and the chrome", () => {
    const world = fakeWorld(new GantryState());
    spawnReadouts(world);
    expect(world.actors()).toHaveLength(9);
    const parts = componentsOf(world);
    expect(parts.some((c) => c instanceof TextComponent)).toBe(true);
    expect(parts.some((c) => c instanceof ShapeComponent)).toBe(true);
    expect(parts.some((c) => c instanceof DrawComponent)).toBe(true);
  });

  it("shows exactly the screen the state is on", () => {
    const state = new GantryState();
    const world = fakeWorld(state);
    spawnReadouts(world);
    refreshViews(world);

    const shown = (): string[] =>
      world
        .actors()
        .filter((actor) =>
          actor.components.some(
            (component) =>
              component instanceof TextComponent && component.visible,
          ),
        )
        .map((actor) => actor.constructor.name);

    expect(shown()).toEqual(["TitleActor"]);
    setScreen(state, "select");
    state.cleared[0] = true;
    state.best[0] = { cost: 2400, time: 18 };
    refreshViews(world);
    expect(shown()).toEqual(["SelectActor"]);
    setScreen(state, "program");
    refreshViews(world);
    expect(shown()).toEqual(["ProgramActor"]);
    setScreen(state, "howto");
    refreshViews(world);
    // The how-to page is drawn rather than laid out, so it shows no text
    // component at all: the `DrawComponent` gates itself at the draw.
    expect(shown()).toEqual([]);
    setScreen(state, "build");
    refreshViews(world);
    expect(shown()).toEqual(["BuildActor"]);
    setScreen(state, "run");
    refreshViews(world);
    expect(shown()).toEqual(["RunActor"]);
    setScreen(state, "results");
    refreshViews(world);
    expect(shown()).toEqual(["ResultsActor"]);
  });

  it("switches the muted flag with the state's own bit", () => {
    const state = new GantryState();
    const world = fakeWorld(state);
    spawnReadouts(world);
    refreshViews(world);
    const flags = () =>
      world
        .ofType(GantryView)
        .filter((actor) => actor.constructor.name === "MutedActor")
        .flatMap((actor) => [...actor.components])
        .filter((c) => c instanceof TextComponent && c.visible);
    expect(flags()).toHaveLength(0);
    state.muted = true;
    refreshViews(world);
    expect(flags()).toHaveLength(1);
  });

  it("reads the tape's step count onto the program screen's strip", () => {
    const state = new GantryState();
    setScreen(state, "program");
    addMoveStep(state, "slew", 90, 30);
    const world = fakeWorld(state);
    spawnReadouts(world);
    refreshViews(world);
    const lines = world
      .actors()
      .flatMap((actor) => [...actor.components])
      .filter((c): c is TextComponent => c instanceof TextComponent)
      .filter((c) => c.visible)
      .map((c) => c.text);
    expect(lines).toContain("TAPE 1 STEPS");
  });
});
