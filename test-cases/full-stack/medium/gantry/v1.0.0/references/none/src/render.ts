// The picture: the `three` scene the yard is drawn in, the screen layer over
// it, and the projection everything is picked and drawn through.
//
// Rendering reads the state and writes nothing (`specs/state.md`). The scene is
// the build's own — the ground, the sky, the light, the lattice and envelope
// aids, the members as drawn geometry, the hoist cable, the pads, the readouts
// — with the produced models of `specs/assets.md` standing in it.
//
// `project` is the exception to needing a canvas: it is pure camera maths over
// `state.camera`, so the picking of `specs/controls.md`, the `project` reading
// of `specs/instrumentation.md`, and the scene all answer to the one camera. It
// lives in `src/render-project.ts` and is re-exported here, which is the name
// the rest of the build reaches it by.
//
// The layers are drawn on two surfaces. The yard is rendered by WebGL into the
// page's own canvas, letterboxed to the fixed logical stage; the readouts are
// painted on a transparent 2D canvas laid exactly over it, since one canvas
// yields one kind of context and text is far crisper drawn directly than
// uploaded as a texture every frame. The overlay takes no pointer events, so
// input still reaches the runtime layer's canvas untouched.

import * as THREE from "three";
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import type { ModelName } from "./assets";
import { applyClick, pick, type EditOutcome, type Pick } from "./editor";
import type { Vec3 } from "./sim";
import {
  collectedTextRuns,
  drawHud,
  type HudHint,
} from "./render-hud";
import {
  describeFrame,
  measureModel,
  type DrawnEntry,
  type ModelSizes,
} from "./render-drawn";
import { BACKGROUND } from "./render-palette";
import { yardPosture, type YardPosture } from "./render-posture";
import { GROUND_SIZE, YardScene } from "./render-scene";
import { measureStageFit, type StageFit } from "./runtime-stage";
import type { GantryState } from "./state";

export {
  CAMERA_FOV,
  cameraBasis,
  cameraPosition,
  project,
  STAGE_ASPECT,
  type CameraBasis,
  type StagePoint,
} from "./render-project";

/** The scene, held across frames and posed from the state each draw. */
export interface Renderer {
  /**
   * What the last frame drew, as `specs/instrumentation.md` § Readings requires
   * `drawn()` to report it. Empty before the first frame: the reading describes a
   * frame, and none has been drawn.
   */
  lastDrawn(): DrawnEntry[];
  /** Draw one frame of the state. Reads the state and writes nothing. */
  draw(state: GantryState): void;
  /** Release every resource the scene holds. */
  dispose(): void;
}

// ---- What a click would do -------------------------------------------------

const nodeText = (node: Vec3): string => `(${node[0]}, ${node[1]}, ${node[2]})`;

const BAR_TOOLS = new Set(["strut", "cable", "rail"]);

/** What a click would take, which is `null` on every screen but `build`. */
const NOTHING_PICKED: Pick = { node: null, member: null };

/**
 * The line the build screen shows under the pointer.
 *
 * `specs/ui.md` asks that a refused edit be visible in the moment it is
 * refused. The editor's rules are pure, so the cheapest honest way to say why a
 * click will do nothing is to ask them: `applyClick` is run over the state as a
 * reading, its answer is read, and the state it returns is discarded. A player
 * therefore reads the refusal before the click as well as after it.
 */
export function pointerHint(
  state: GantryState,
  picked: Pick = state.screen === "build" ? pick(state) : NOTHING_PICKED,
): HudHint {
  if (state.screen !== "build") return { action: null, refusal: null };
  if (picked.node === null && picked.member === null) {
    return { action: null, refusal: null };
  }
  const outcome: EditOutcome = applyClick(state);
  if (outcome.refusal !== null) {
    return { action: null, refusal: outcome.refusal };
  }
  return { action: actionText(state, outcome, picked), refusal: null };
}

function actionText(
  state: GantryState,
  outcome: EditOutcome,
  picked: Pick,
): string | null {
  const tool = state.tool;
  if (outcome.cue === "place") {
    if (tool === "ring") return "CLICK TO SET THE SLEW RING HERE";
    if (tool === "counterweight") return "CLICK TO HANG A COUNTERWEIGHT HERE";
    return `CLICK TO PLACE A ${tool.toUpperCase()}`;
  }
  if (outcome.cue === "delete") {
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

// ---- The screen layer's own canvas -----------------------------------------

/**
 * The transparent 2D surface the readouts are painted on, laid exactly over the
 * page's canvas and fitted to the same letterboxed stage.
 */
class HudLayer {
  private readonly surface: HTMLCanvasElement | null;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(private readonly host: HTMLCanvasElement) {
    if (typeof document === "undefined") {
      this.surface = null;
      this.ctx = null;
      return;
    }
    const surface = document.createElement("canvas");
    surface.setAttribute("aria-hidden", "true");
    const style = surface.style;
    style.position = "fixed";
    style.left = "0";
    style.top = "0";
    style.pointerEvents = "none";
    style.zIndex = "2";
    (host.parentElement ?? document.body).appendChild(surface);
    this.surface = surface;
    this.ctx = surface.getContext("2d");
  }

  draw(state: GantryState, hint: HudHint, fit: StageFit): void {
    const surface = this.surface;
    const ctx = this.ctx;
    if (surface === null || ctx === null) return;
    if (fit.scale <= 0) return;
    const rect = this.host.getBoundingClientRect();

    if (surface.width !== fit.pixelWidth) surface.width = fit.pixelWidth;
    if (surface.height !== fit.pixelHeight) surface.height = fit.pixelHeight;
    const style = surface.style;
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.width = `${fit.cssWidth}px`;
    style.height = `${fit.cssHeight}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, fit.pixelWidth, fit.pixelHeight);
    // The same fit the runtime maps a pointer through, so a readout and the
    // pointer position it answers to are laid out on one grid.
    const pixels = fit.scale * fit.dpr;
    ctx.setTransform(
      pixels,
      0,
      0,
      pixels,
      fit.offsetX * fit.dpr,
      fit.offsetY * fit.dpr,
    );
    drawHud(ctx, state, hint);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  dispose(): void {
    this.surface?.remove();
  }
}

// ---- The renderer ----------------------------------------------------------

/**
 * Build the scene over the page's canvas, with the produced models decoded and
 * ready to place.
 *
 * The canvas's own size is the runtime layer's (`specs/overview.md`), so this
 * reads it rather than setting it, and fits the `STAGE_W x STAGE_H` stage
 * inside whatever it finds — the whole stage on screen at every window size and
 * pixel density, with the letterbox bars cleared to the yard's own background.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  models: Readonly<Record<ModelName, PartMesh>>,
): Renderer {
  const gl = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  gl.setPixelRatio(1);
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  gl.setClearColor(new THREE.Color(BACKGROUND), 1);

  const yard = new YardScene(models);
  const hud = new HudLayer(canvas);

  // Measured once: what a model came out as does not change between frames, and
  // every frame's reading needs it.
  const measured: ModelSizes = {};
  for (const [name, mesh] of Object.entries(models)) {
    measured[name as ModelName] = measureModel(mesh);
  }

  let drawn: DrawnEntry[] = [];
  // What the yard was last posed from. A frame whose viewport is too small to
  // render leaves them as they were, and the reading then describes the last
  // frame that actually drew — which is what it says it describes.
  let lastPosture: YardPosture | null = null;
  let lastLattice = false;

  return {
    lastDrawn: () => drawn,

    draw(state: GantryState): void {
      const fit = measureStageFit(canvas);
      const width = Math.max(1, canvas.width);
      const height = Math.max(1, canvas.height);
      const view = fit.viewport;
      const build = state.screen === "build";
      const picked = build ? pick(state) : NOTHING_PICKED;

      gl.setScissorTest(false);
      gl.setViewport(0, 0, width, height);
      gl.clear(true, true, true);

      if (view.width >= 1 && view.height >= 1) {
        gl.setViewport(view.x, view.y, view.width, view.height);
        gl.setScissor(view.x, view.y, view.width, view.height);
        gl.setScissorTest(true);

        yard.poseCamera(state.camera);
        const posture = yardPosture(state);
        const lattice = build || state.screen === "program";
        lastPosture = posture;
        lastLattice = lattice;
        yard.sync(
          posture,
          {
            lattice,
            pick: picked.node,
            pending: build ? state.pendingNode : null,
          },
          state.simTime,
        );
        gl.render(yard.scene, yard.camera);
        gl.setScissorTest(false);
      }

      hud.draw(state, pointerHint(state, picked), fit);

      // The reading is taken last, from the same posture the yard was just drawn
      // from and the text the layer just wrote, so it can never describe a
      // different frame from the one on screen.
      drawn = describeFrame({
        posture: lastPosture ?? yardPosture(state),
        sizes: measured,
        aids: { lattice: lastLattice, envelope: true },
        marks: {
          anchors: true,
          loadStarts: true,
          pads: true,
          pendingNode: build ? state.pendingNode : null,
          pickedNode: picked.node,
        },
        texts: collectedTextRuns().map((text, index) => ({
          name: `run-${index}`,
          text,
        })),
        readouts: {
          // `specs/ui.md` fixes both by name: the build screen's readouts show
          // "the tool palette with each tool's binding and the selected tool
          // marked", and the run screen carries "a legend for the utilization
          // ramp".
          selectedTool: build,
          rampLegend: state.screen === "run",
        },
        groundSize: GROUND_SIZE,
      });
    },

    dispose(): void {
      hud.dispose();
      yard.dispose();
      gl.dispose();
    },
  };
}
