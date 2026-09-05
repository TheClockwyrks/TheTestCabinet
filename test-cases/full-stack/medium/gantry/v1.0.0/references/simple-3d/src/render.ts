// The picture: the yard in the engine's scene, and the readouts over it on the
// engine's screen layer.
//
// `drawFrame` runs once per frame, after `update`, over the state that update
// returned. It reads the state and writes nothing (`specs/state.md`).
//
// Two things the engine owns are reached from here. The scene is retained —
// what one frame adds is still there the next — so the yard is built once, on
// the first frame, and posed from then on; it is kept per scene, so an engine
// built afresh gets a yard of its own. And the camera is the engine's: it is
// posed from `state.camera` through `cameraPosition` and given `CAMERA_FOV` as
// its vertical field of view, both from `src/project.ts`, which is the same
// lens `pick` measures through, so what is picked is what is drawn.

import type { RenderApi } from "@clockwyrks/simple-3d";
import * as THREE from "three";
import { thaw, type ReadonlyPoint } from "./convert";
import { applyClick } from "./editor";
import type { ReadonlyGantryState, Tool, Vec3 } from "./game";
import { pick, type Pick } from "./pick";
import { CAMERA_FOV, cameraPosition, TARGET } from "./project";
import {
  collectedTextRuns,
  drawHud,
  type HudHint,
} from "./render-hud";
import {
  describeFrame,
  measureModelObject,
  type DrawnEntry,
  type ModelSizes,
} from "./render-drawn";
import { MODEL_NAMES, placeModel } from "./assets";
import { yardPosture } from "./render-posture";
import { YardScene, GROUND_SIZE } from "./render-scene";

/**
 * What the last frame drew (`specs/instrumentation.md`).
 *
 * The frame is drawn by a free function rather than by something the game holds,
 * so the description it produced is kept here, beside the drawing, and the debug
 * surface reads it back through `lastDrawnEntries`.
 */
let lastDrawn: DrawnEntry[] = [];

/** What the last frame drew, for the surface's `drawn()` reading. */
export function lastDrawnEntries(): DrawnEntry[] {
  return lastDrawn;
}

/** Every model's drawn extent and colour, measured once and kept. */
let measured: ModelSizes | null = null;

function modelSizes(): ModelSizes {
  if (measured !== null) return measured;
  const sizes: ModelSizes = {};
  for (const name of MODEL_NAMES) {
    sizes[name] = measureModelObject(placeModel(name));
  }
  measured = sizes;
  return sizes;
}

/** One yard per scene, built on the first frame drawn into that scene. */
const yards = new WeakMap<THREE.Scene, YardScene>();

/** The yard standing in a scene, built the first time it is asked for. */
export function yardIn(scene: THREE.Scene): YardScene {
  let yard = yards.get(scene);
  if (yard === undefined) {
    yard = new YardScene(scene);
    yards.set(scene, yard);
  }
  return yard;
}

// ---- What a click would do -------------------------------------------------

const nodeText = (node: Vec3): string => `(${node.x}, ${node.y}, ${node.z})`;

const BAR_TOOLS = new Set<Tool>(["strut", "cable", "rail"]);

/** What a click would take, which is `null` on every screen but `build`. */
const NOTHING_PICKED: Pick = { node: null, member: null };

/**
 * The line the build screen shows under the pointer.
 *
 * `specs/ui.md` asks that a refused edit be visible in the moment it is
 * refused. The editor's rules are pure, so the cheapest honest way to say why a
 * click will do nothing is to ask them: `applyClick` is run over a copy of the
 * state as a reading, its answer is read, and the copy is discarded. A player
 * therefore reads the refusal before the click as well as after it.
 */
export function pointerHint(
  state: ReadonlyGantryState,
  picked: Pick = state.screen === "build" ? pick(state) : NOTHING_PICKED,
): HudHint {
  if (state.screen !== "build") return { action: null, refusal: null };
  if (picked.node === null && picked.member === null) {
    return { action: null, refusal: null };
  }
  const before = state.cues.length;
  const outcome = applyClick(thaw(state));
  if (outcome.refusal !== null) {
    return { action: null, refusal: outcome.refusal };
  }
  return {
    action: actionText(state, outcome.state.cues[before]?.cue ?? null, picked),
    refusal: null,
  };
}

/** What the click would be called, from the cue the trial edit raised. */
function actionText(
  state: ReadonlyGantryState,
  cue: string | null,
  picked: Pick,
): string | null {
  const tool = state.tool;
  if (cue === "place") {
    if (tool === "ring") return "CLICK TO SET THE SLEW RING HERE";
    if (tool === "counterweight") return "CLICK TO HANG A COUNTERWEIGHT HERE";
    return `CLICK TO PLACE A ${tool.toUpperCase()}`;
  }
  if (cue === "delete") {
    if (tool === "counterweight") return "CLICK TO TAKE THIS COUNTERWEIGHT OFF";
    return "CLICK TO DELETE WHAT IS UNDER THE POINTER";
  }
  if (picked.node !== null && BAR_TOOLS.has(tool)) {
    return state.pendingNode === null
      ? `CLICK TO HOLD ${nodeText(picked.node)}`
      : "CLICK AGAIN TO DROP THE HELD NODE";
  }
  return null;
}

// ---- The camera ------------------------------------------------------------

/**
 * Pose the engine's camera from the state's orbit, through the one lens
 * `src/project.ts` owns. The engine holds the aspect at the stage's own and
 * updates the projection matrix before it renders, so writing `fov` here takes
 * effect on this frame's picture.
 *
 * THE PERSPECTIVE CAMERA IS RECOGNIZED BY ITS OWN MARKER RATHER THAN BY
 * `instanceof`. The camera is the ENGINE's object, built by the engine's copy of
 * three, and this module is compiled against the copy the build resolves; an
 * `instanceof` across two copies of a library is false however perspective the
 * camera is, and the lens would then silently stay at the engine's default while
 * `src/project.ts` picked through `CAMERA_FOV`. `isPerspectiveCamera` is the
 * marker three itself carries for exactly this reason, so what is drawn and what
 * is picked cannot come apart.
 */
export function poseCamera(
  camera: RenderApi["camera"],
  state: ReadonlyGantryState,
): void {
  const eye = cameraPosition({ ...state.camera });
  camera.position.set(eye.x, eye.y, eye.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(TARGET.x, TARGET.y, TARGET.z);
  if ("isPerspectiveCamera" in camera) {
    camera.fov = CAMERA_FOV;
    camera.near = 0.5;
    camera.far = 600;
  }
}

// ---- The frame -------------------------------------------------------------

/**
 * Draw one frame: populate the scene with the yard, pose the camera the player
 * orbits, and draw the screen's readouts over the picture in the fixed
 * 1280x720 logical stage.
 */
export function drawFrame(state: ReadonlyGantryState, api: RenderApi): void {
  const build = state.screen === "build";
  const picked = build ? pick(state) : NOTHING_PICKED;

  poseCamera(api.camera, state);

  const yard = yardIn(api.scene);
  const posture = yardPosture(state);
  const lattice = build || state.screen === "program";
  yard.sync(
    posture,
    {
      lattice,
      pick: picked.node === null ? null : toTriple(picked.node),
      pending:
        build && state.pendingNode !== null
          ? toTriple(state.pendingNode)
          : null,
    },
    state.simTime,
  );

  drawHud(api.screen, state, pointerHint(state, picked));

  // The reading is taken last, from the same posture the yard was just drawn
  // from and the text the layer just wrote, so it can never describe a different
  // frame from the one on screen.
  lastDrawn = describeFrame({
    posture,
    sizes: modelSizes(),
    aids: { lattice, envelope: true },
    marks: {
      anchors: true,
      loadStarts: true,
      pads: true,
      pendingNode:
        build && state.pendingNode !== null ? toTriple(state.pendingNode) : null,
      pickedNode: picked.node === null ? null : toTriple(picked.node),
    },
    texts: collectedTextRuns().map((text, index) => ({
      name: `run-${index}`,
      text,
    })),
    readouts: {
      // `specs/ui.md` fixes both by name; see the engineless reference.
      selectedTool: build,
      rampLegend: state.screen === "run",
    },
    groundSize: GROUND_SIZE,
  });
}

/** A state position as the scene's own triple. */
const toTriple = (p: ReadonlyPoint): [number, number, number] => [
  p.x,
  p.y,
  p.z,
];
