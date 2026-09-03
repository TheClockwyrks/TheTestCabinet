// One frame of the picture: the yard built into the engine's retained scene,
// the camera posed through the game's own lens, and the readouts over both.
//
// The engine itself cannot stand up in Node — it takes a `webgl2` context the
// moment it is created — so these drive `drawFrame` directly over a stub
// `RenderApi`, which is exactly what the engine hands `render`. `three` builds
// its scene graph without a renderer, so the objects the yard places can be
// read straight back off the scene.

import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { InitApi, Model, RenderApi } from "@test-cabinet/simple-3d";
import { CAMERA_START_DIST, STAGE_H, STAGE_W } from "./constants";
import { loadProducedAssets, MODEL_NAMES } from "./assets";
import { point, thaw } from "./convert";
import * as edits from "./edits";
import type { GantryState } from "./game";
import { cameraPosition, project } from "./project";
import { drawFrame, pointerHint, poseCamera, yardIn } from "./render";
import {
  addMoveStep,
  beginRun,
  openSite,
  setScreen,
  setTool,
  titleState,
} from "./state";

// ---- A stand-in for the engine's decoded models ----------------------------

/** One decoded model, as the engine's loader hands one over. */
function model(): Model {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(8, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0x808080 }),
  );
  mesh.position.set(0, 4, 0);
  group.add(mesh);
  return { scene: group, animations: [], nodes: [] };
}

const initApi = (): InitApi<GantryState> =>
  ({
    assets: { loadModel: () => Promise.resolve(model()) },
    audio: { load: () => Promise.resolve() },
  }) as unknown as InitApi<GantryState>;

beforeAll(async () => {
  await loadProducedAssets(initApi());
});

// ---- A stand-in for what the engine hands `render` -------------------------

interface Stub {
  api: RenderApi;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  texts: string[];
}

function stub(): Stub {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, STAGE_W / STAGE_H, 0.1, 1000);
  const texts: string[] = [];
  const screen = {
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arcTo: () => undefined,
    stroke: () => undefined,
    strokeRect: () => undefined,
    fill: () => undefined,
    fillRect: () => undefined,
    fillText: (content: string) => texts.push(content),
    measureText: (content: string) => ({ width: content.length * 7 }),
  };
  const api = {
    scene,
    camera,
    screen: screen as unknown as CanvasRenderingContext2D,
    frame: () => ({ count: 0, timeMs: 0, lastDeltaMs: 0 }),
    viewport: () => ({
      width: STAGE_W,
      height: STAGE_H,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }),
    view: () => {
      throw new Error("the stub has no view");
    },
  } as unknown as RenderApi;
  return { api, scene, camera, texts };
}

const yard = (): GantryState => setScreen(openSite(titleState(), 0), "build");

/** A ring and one arm rail, with a tape: what a run will start on. */
function runnable(): GantryState {
  let s = yard();
  s = edits.setRing(s, point(0, 2, 0)).state;
  s = edits.addMember(s, point(2, 4, 0), point(4, 4, 0), "rail").state;
  return addMoveStep(s, "slew", 15, 30);
}

/** Every visible descendant of a named group. */
function visibleUnder(scene: THREE.Scene, name: string): THREE.Object3D[] {
  const parent = scene.getObjectByName(name);
  if (parent === undefined) return [];
  return parent.children.filter((child) => child.visible);
}

// ---- The yard --------------------------------------------------------------

describe("the retained scene", () => {
  it("is built once and kept, one yard per scene", () => {
    const first = stub();
    const second = stub();
    expect(yardIn(first.scene)).toBe(yardIn(first.scene));
    expect(yardIn(first.scene)).not.toBe(yardIn(second.scene));
  });

  it("carries the standing parts of the picture after one frame", () => {
    const { api, scene } = stub();
    drawFrame(yard(), api);
    expect(scene.getObjectByName("ground")).toBeDefined();
    expect(scene.getObjectByName("sky")).toBeDefined();
    expect(scene.getObjectByName("survey-grid")).toBeDefined();
    expect(scene.getObjectByName("sun")).toBeDefined();
    expect(scene.getObjectByName("crane")).toBeDefined();
    expect(scene.getObjectByName("fixtures")).toBeDefined();
    expect(scene.fog).not.toBeNull();
  });

  it("adds the site's fixtures once and not again on the next frame", () => {
    const { api, scene } = stub();
    drawFrame(yard(), api);
    const first = scene.getObjectByName("fixtures")?.children.length ?? 0;
    drawFrame(yard(), api);
    expect(scene.getObjectByName("fixtures")?.children.length).toBe(first);
    expect(first).toBeGreaterThan(0);
    expect(scene.getObjectByName("envelope")).toBeDefined();
    expect(scene.getObjectByName("lattice")).toBeDefined();
    expect(scene.getObjectByName("anchor-plate")).toBeDefined();
    expect(scene.getObjectByName("pad")).toBeDefined();
    expect(scene.getObjectByName("pad-yaw-mark")).toBeDefined();
  });

  it("rebuilds them when the site under them changes", () => {
    const { api, scene } = stub();
    drawFrame(yard(), api);
    expect(scene.getObjectByName("obstacle")).toBeUndefined();
    // Site 2 carries a wall.
    drawFrame(setScreen(openSite(titleState(), 2), "build"), api);
    expect(scene.getObjectByName("obstacle")).toBeDefined();
    expect(scene.getObjectByName("obstacle-edge")).toBeDefined();
  });

  it("shows the lattice on the two editing screens and not on the run", () => {
    const { api, scene } = stub();
    drawFrame(yard(), api);
    expect(scene.getObjectByName("lattice")?.visible).toBe(true);
    drawFrame(setScreen(yard(), "program"), api);
    expect(scene.getObjectByName("lattice")?.visible).toBe(true);
    drawFrame(setScreen(yard(), "run"), api);
    expect(scene.getObjectByName("lattice")?.visible).toBe(false);
  });

  it("stands a produced model at each anchor and each waiting load", () => {
    const { api, scene } = stub();
    drawFrame(yard(), api);
    const placed = visibleUnder(scene, "crane");
    const names = placed.map((o) => o.name);
    expect(names.filter((n) => n === "mount")).toHaveLength(4);
    expect(names).toContain("crate");
    for (const name of names) {
      if (MODEL_NAMES.includes(name as (typeof MODEL_NAMES)[number])) {
        expect(placed.find((o) => o.name === name)?.children).toHaveLength(1);
      }
    }
  });

  it("marks the node under the pointer and the node being held", () => {
    const { api, scene } = stub();
    const s = thaw(yard());
    const at = project({ ...s.camera }, point(0, 4, 0));
    s.pointer.x = at.x;
    s.pointer.y = at.y;
    drawFrame(s, api);
    const oneMarker = visibleUnder(scene, "crane").filter(
      (o) => o.name === "marker",
    );
    expect(oneMarker).toHaveLength(1);

    s.pendingNode = point(2, 4, 0);
    drawFrame(s, api);
    expect(
      visibleUnder(scene, "crane").filter((o) => o.name === "marker"),
    ).toHaveLength(2);
  });

  it("draws no marker where the pointer takes nothing", () => {
    const { api, scene } = stub();
    drawFrame(yard(), api);
    expect(
      visibleUnder(scene, "crane").filter((o) => o.name === "marker"),
    ).toHaveLength(0);
  });

  it("draws a rail as its beam and its head, and a cable as rope", () => {
    const { api, scene } = stub();
    drawFrame(runnable(), api);
    const bars = visibleUnder(scene, "crane");
    // One rail: a beam and a head, both from the member pool.
    expect(bars.filter((o) => o.name === "member")).toHaveLength(2);
    // The hoist cable hangs from the trolley, drawn as rope.
    expect(bars.filter((o) => o.name === "rope")).toHaveLength(1);
    expect(bars.some((o) => o.name === "trolley")).toBe(true);
    expect(bars.some((o) => o.name === "hook")).toBe(true);
    expect(bars.some((o) => o.name === "ring")).toBe(true);
  });

  it("draws a broken member apart from the ones still carrying", () => {
    const { api, scene } = stub();
    const started = beginRun(runnable());
    if (started === null) throw new Error("the crane should have run");
    started.run.broken = [started.sites[0].structure.members[0].id];
    drawFrame(started, api);
    const drawn = visibleUnder(scene, "crane");
    expect(drawn.filter((o) => o.name === "broken")).toHaveLength(1);
    expect(drawn.filter((o) => o.name === "member")).toHaveLength(0);
  });
});

// ---- The camera ------------------------------------------------------------

describe("the camera", () => {
  it("stands where the state's orbit puts it, through the game's own lens", () => {
    const { api, camera } = stub();
    const state = yard();
    drawFrame(state, api);
    const eye = cameraPosition({ ...state.camera });
    expect(camera.position.x).toBeCloseTo(eye.x, 9);
    expect(camera.position.y).toBeCloseTo(eye.y, 9);
    expect(camera.position.z).toBeCloseTo(eye.z, 9);
    expect(camera.fov).toBe(45);
    expect(state.camera.dist).toBe(CAMERA_START_DIST);
  });

  it("looks back at the target the orbit turns about", () => {
    const { camera } = stub();
    poseCamera(camera, yard());
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(
      camera.quaternion,
    );
    const eye = cameraPosition(yard().camera);
    const toTarget = new THREE.Vector3(
      0 - eye.x,
      6 - eye.y,
      0 - eye.z,
    ).normalize();
    expect(ahead.dot(toTarget)).toBeCloseTo(1, 9);
  });

  it("leaves an orthographic camera's own fields alone", () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    expect(() => poseCamera(camera, yard())).not.toThrow();
    expect(camera.position.length()).toBeGreaterThan(0);
  });
});

// ---- What a click would do -------------------------------------------------

describe("the pointer hint", () => {
  const aimed = (state: GantryState, x: number, y: number): GantryState => {
    const s = thaw(state);
    const at = project({ ...s.camera }, { x, y, z: 0 });
    s.pointer.x = at.x;
    s.pointer.y = at.y;
    return s;
  };

  it("is empty off the build screen", () => {
    expect(pointerHint(setScreen(yard(), "program"))).toEqual({
      action: null,
      refusal: null,
    });
  });

  it("is empty where the pointer takes nothing", () => {
    const s = thaw(yard());
    s.pointer.x = 2;
    s.pointer.y = 2;
    expect(pointerHint(s)).toEqual({ action: null, refusal: null });
  });

  it("names the node a first click would hold", () => {
    const hint = pointerHint(aimed(yard(), 0, 4));
    expect(hint.action).toBe("CLICK TO HOLD (0, 4, 0)");
  });

  it("names what a second click would place", () => {
    const held = { ...aimed(yard(), 0, 4), pendingNode: point(2, 4, 0) };
    expect(pointerHint(held).action).toBe("CLICK TO PLACE A STRUT");
  });

  it("names the rule that would refuse the click", () => {
    const s = setTool(yard(), "ring");
    const hint = pointerHint(aimed(s, 0, 0));
    expect(hint.refusal).toBe("ring-on-ground");
    expect(hint.action).toBeNull();
  });

  it("names the ring and the counterweight in their own words", () => {
    const ring = pointerHint(aimed(setTool(yard(), "ring"), 0, 2));
    expect(ring.action).toBe("CLICK TO SET THE SLEW RING HERE");
    let built = edits.addMember(
      yard(),
      point(0, 4, 0),
      point(2, 4, 0),
      "strut",
    ).state;
    built = setTool(built, "counterweight");
    expect(pointerHint(aimed(built, 0, 4)).action).toBe(
      "CLICK TO HANG A COUNTERWEIGHT HERE",
    );
  });

  it("names a deletion", () => {
    const built = edits.addMember(
      yard(),
      point(0, 4, 0),
      point(2, 4, 0),
      "strut",
    ).state;
    const hint = pointerHint(aimed(setTool(built, "delete"), 0, 4));
    expect(hint.action).toBe("CLICK TO DELETE WHAT IS UNDER THE POINTER");
  });

  it("leaves the state it read exactly as it was", () => {
    const before = aimed(yard(), 0, 4);
    const copy = thaw(before);
    pointerHint(before);
    expect(before).toEqual(copy);
  });
});

// ---- The whole frame -------------------------------------------------------

describe("one frame", () => {
  it("draws the readouts over the picture", () => {
    const s = stub();
    drawFrame(yard(), s.api);
    expect(s.texts.join("\n")).toContain("FIRST LIFT");
  });

  it("draws every screen without a scene of its own", () => {
    const s = stub();
    for (const screen of [
      "title",
      "howto",
      "select",
      "build",
      "program",
      "run",
      "results",
    ] as const) {
      expect(() =>
        drawFrame(setScreen(runnable(), screen), s.api),
      ).not.toThrow();
    }
  });
});
