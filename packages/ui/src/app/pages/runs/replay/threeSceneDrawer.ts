// The substrate: a `SceneDrawer3d` over three.js, and the asset decoder that
// feeds it.
//
// This is the only module of the player that imports a renderer, which is what
// keeps `drawFrame3d.ts` — the resolution rules, the ordering rules, the
// reporting — testable with no GPU in the room, and what lets the whole of
// three land in a chunk a 2D-only run page never fetches (`Replay3dCanvas.tsx`
// is `React.lazy`-loaded, and `ReplayPlayer` imports this module dynamically
// for the decode).
//
// Why three.js at all. What a 3D recording carries is scene vocabulary, not
// raster commands: `drawMesh`, `drawGeometry`, a camera, a light list. Every
// hard part of turning that back into a picture — parsing a glTF binary,
// sampling an animation clip, PBR materials, the four render modes, sprites,
// lines — is what three already is, and the console already trusts it to show
// reviewers voxel rigs and particle systems. Writing a second WebGL renderer
// here would put thousands of lines of untested raster code between the
// recording and the reviewer, which is the confident-wrong-picture the whole
// format exists to refuse.
//
// What that costs, stated plainly: the engines render through a WebGL2
// renderer of their own, and three is a different one. Colours, the letterbox
// and the composite order are reproduced exactly — they are arithmetic, and
// the arithmetic is copied (see `sceneDrawer3d.ts`) — but shading is not
// byte-identical, because three's standard material is a GGX PBR model and the
// engines' is Blinn-Phong over the same inputs. That is a settled decision:
// player parity with the engines is contract- and call-sequence-level, plus
// cold-seek-equals-in-order determinism, rather than byte-exact pixels across
// two rasterizers.
//
// Three things are pinned against three's defaults so that a value in the
// document reaches the picture unaltered:
//
//   * Colour management is off for this renderer (`outputColorSpace` linear,
//     colours set in linear-sRGB): the engines write the bytes they were given
//     and so does this.
//   * A point light is `decay = 2` over `distance = range`, which is three's
//     `pow(saturate(1 - d / range), 2)` — the engines' falloff exactly.
//   * The HUD is composited on a 2D canvas over the WebGL one rather than as
//     geometry inside it. It is a 2D picture in logical coordinates that
//     composites above everything, the console already owns a battle-tested 2D
//     path, and it keeps the WebGL canvas readable as the 3D picture alone.
//     The lettering is the engines' own face, from the console's copy of their
//     glyph data.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Asset3dDecoder, Replay3dResources } from "./drawFrame3d";
import { prepareRecording3d } from "./drawFrame3d";
import type {
  CameraState,
  Color,
  LightState,
  Recording3d,
  RenderMode,
  Transform,
  Vec2,
  Vec3,
} from "./format3d";
import {
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  fitSurface,
  layoutHudText,
  parseColor3d,
  type DecodedMesh,
  type DecodedTexture,
  type Design3d,
  type Fit3d,
  type ResolvedHudTextOptions,
  type ResolvedMaterial,
  type ResolvedMeshOptions,
  type SceneDrawer3d,
  type Surface3d,
} from "./sceneDrawer3d";
import {
  FONT_FIRST_CODE_POINT,
  FONT_LAST_CODE_POINT,
  glyphRows,
} from "./hudFont";

/* -------------------------------------------------------------------------- */
/* Decoding a recording's assets                                              */
/* -------------------------------------------------------------------------- */

/**
 * How long one captured asset is given to turn back into something drawable.
 *
 * A decode that neither resolves nor rejects would otherwise hold the player on
 * "loading" for as long as the tab is open, with nothing on screen and nothing
 * to read. An expiry is a failed decode, so the replay plays with that one mesh
 * missing and named.
 */
const DECODE_TIMEOUT_MS = 10_000;

/** Fail `work` if it has not settled within `ms`, so no caller waits forever. */
function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** The bytes behind a base64 string. */
function base64Bytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Whether any material a glTF document carries blends. */
function documentBlends(gltf: GLTF): boolean {
  let blends = false;
  gltf.scene.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (material === undefined) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      if (entry.transparent || entry.opacity < 1) blends = true;
    }
  });
  return blends;
}

/**
 * Turn one captured entry into something the scene can draw.
 *
 * A mesh is a glTF binary and a texture is a PNG data URL — the two forms the
 * format carries — and both are decoded by the substrate that will draw them,
 * under a bound on how long that may take.
 */
export const decodeAsset3d: Asset3dDecoder = async (asset) => {
  if (asset.kind === "mesh") {
    const bytes = base64Bytes(asset.data);
    const gltf = await withTimeout(
      new GLTFLoader().parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        "",
      ),
      DECODE_TIMEOUT_MS,
      "the mesh did not parse in time",
    );
    const decoded: DecodedMesh = {
      kind: "mesh",
      path: asset.path,
      translucent: documentBlends(gltf),
      clips: gltf.animations.map((clip) => clip.name),
      value: gltf,
    };
    return decoded;
  }
  const image = await withTimeout(
    decodeImage(asset.src),
    DECODE_TIMEOUT_MS,
    "the texture did not decode in time",
  );
  const texture = new THREE.Texture(image);
  // The engines upload a PNG's rows as they stand and sample with the image's
  // first row at the top of a quad; three's default flip is what puts a
  // texture the same way up here.
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const decoded: DecodedTexture = {
    kind: "texture",
    path: asset.path,
    width: asset.width,
    height: asset.height,
    value: texture,
  };
  return decoded;
};

/** Load a data URL into an image element, or reject. */
function decodeImage(src: string): Promise<HTMLImageElement> {
  if (typeof Image === "undefined") {
    return Promise.reject(new Error("this environment has no image decoder"));
  }
  const element = new Image();
  element.src = src;
  if (typeof element.decode === "function") {
    return element.decode().then(() => element);
  }
  return new Promise((resolve, reject) => {
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("the texture did not decode"));
  });
}

/**
 * Decode a whole 3D recording, the way the player's loader wants it.
 *
 * The one-argument form the fetch path calls, so `ReplayPlayer` can pull this
 * module in dynamically and hand the recording straight to it.
 */
export function prepare3dReplay(
  recording: Recording3d,
): Promise<Replay3dResources> {
  return prepareRecording3d(recording, decodeAsset3d);
}

/* -------------------------------------------------------------------------- */
/* Small conversions                                                          */
/* -------------------------------------------------------------------------- */

/** A colour as three holds one, with no colour management in the way. */
function color3(css: Color): THREE.Color {
  const [r, g, b] = parseColor3d(css);
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

/** A colour as a canvas fill, alpha included. */
function fillStyle(css: Color): string {
  const [r, g, b, a] = parseColor3d(css);
  const byte = (channel: number): number =>
    Math.max(0, Math.min(255, Math.round(channel * 255)));
  return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${a})`;
}

/** Whether every number of a point is one a renderer can draw at. */
function finiteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Whether a placement is one a renderer can draw under. */
function finiteTransform(t: Transform): boolean {
  return (
    finiteVec3(t.position) &&
    finiteVec3(t.scale) &&
    Number.isFinite(t.rotation.x) &&
    Number.isFinite(t.rotation.y) &&
    Number.isFinite(t.rotation.z) &&
    Number.isFinite(t.rotation.w)
  );
}

/** Put a recorded placement on an object. */
function place(object: THREE.Object3D, transform: Transform): void {
  object.position.set(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  object.quaternion.set(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.rotation.w,
  );
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

/** A decoded texture as three holds one. */
function textureOf(decoded: DecodedTexture | null): THREE.Texture | null {
  return decoded === null ? null : (decoded.value as THREE.Texture);
}

/* -------------------------------------------------------------------------- */
/* The drawer                                                                 */
/* -------------------------------------------------------------------------- */

/** What a three-backed drawer draws into. */
export interface ThreeSceneTarget {
  /** The WebGL2 renderer the 3D picture is drawn with. */
  readonly renderer: THREE.WebGLRenderer;
  /** The 2D context of the overlay canvas the HUD composites onto. */
  readonly hud: CanvasRenderingContext2D | null;
}

/**
 * A `SceneDrawer3d` over three.js.
 *
 * The frame arrives already ordered, so the implementation is nearly free of
 * decisions: it accumulates the draws of the run in force, and renders that run
 * the moment something ends it — a state setter, a depth clear, or the end of
 * the frame. Runs render into the same buffers with `autoClear` off, so the
 * colour and depth a run leaves are what the next run draws over, which is the
 * whole point of a depth clear being a verb.
 *
 * The order the drawer computed survives three's own sorting because every
 * object carries an increasing `renderOrder`, which three sorts on before
 * anything else — in both its opaque and its transparent list.
 */
export class ThreeSceneDrawer implements SceneDrawer3d {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly hud: CanvasRenderingContext2D | null;
  private readonly scene = new THREE.Scene();
  private readonly lightGroup = new THREE.Group();
  private readonly drawGroup = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera();

  /** The render mode in force, which decides what a material is made of. */
  private mode: RenderMode = "standard";
  /** How many objects have been queued this frame: the composite order. */
  private order = 0;
  /** Where the logical field sits inside the surface. */
  private fit: Fit3d = { scale: 1, offsetX: 0, offsetY: 0 };

  /** Everything this drawer made for the frame being drawn, to free next frame. */
  private frameOwned: Array<{ dispose: () => void }> = [];
  /** Materials built from a spec, kept between frames because they are pure. */
  private readonly materials = new Map<string, THREE.Material>();
  /** The glyph atlas per colour, built on demand. */
  private readonly atlases = new Map<string, HTMLCanvasElement>();
  /** The white glyph atlas every tinted one is drawn from. */
  private atlas: HTMLCanvasElement | null = null;

  constructor(target: ThreeSceneTarget) {
    this.renderer = target.renderer;
    this.hud = target.hud;
    this.renderer.autoClear = false;
    // The engines write the colour bytes they were given, so nothing is
    // converted on the way out either.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene.add(this.lightGroup);
    this.scene.add(this.drawGroup);
  }

  blank(surface: Surface3d, design: Design3d, background: Color | null): void {
    this.release();
    this.fit = fitSurface(design, surface);
    this.order = 0;

    const renderer = this.renderer;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, surface.width, surface.height);
    const [r, g, b, a] = parseColor3d(background ?? "transparent");
    renderer.setClearColor(
      new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace),
      background === null ? 0 : a,
    );
    // The whole canvas, letterbox bars included, then the picture's own
    // rectangle as viewport and scissor: a draw cannot reach the bars.
    renderer.clear(true, true, false);
    const width = Math.round(design.width * this.fit.scale);
    const height = Math.round(design.height * this.fit.scale);
    const x = Math.round(this.fit.offsetX);
    const y = surface.height - Math.round(this.fit.offsetY) - height;
    if (width > 0 && height > 0) {
      renderer.setViewport(x, y, width, height);
      renderer.setScissor(x, y, width, height);
      renderer.setScissorTest(true);
    }

    this.camera.aspect = design.height > 0 ? design.width / design.height : 1;
    this.hud?.clearRect(0, 0, surface.width, surface.height);
  }

  setCamera(camera: CameraState): void {
    this.flush();
    this.camera.position.set(
      camera.position.x,
      camera.position.y,
      camera.position.z,
    );
    this.camera.quaternion.set(
      camera.rotation.x,
      camera.rotation.y,
      camera.rotation.z,
      camera.rotation.w,
    );
    // The frustum's aspect is the design aspect, never the pane's, which is
    // what makes the picture identical on every canvas it is drawn onto.
    this.camera.fov = (camera.fovY * 180) / Math.PI;
    this.camera.near = camera.near;
    this.camera.far = camera.far;
    this.camera.updateProjectionMatrix();
  }

  setLights(lights: readonly LightState[]): void {
    this.flush();
    for (const light of [...this.lightGroup.children]) {
      this.lightGroup.remove(light);
      (light as THREE.Light).dispose?.();
    }
    for (const light of lights) {
      this.lightGroup.add(this.lightOf(light));
    }
  }

  setMode(mode: RenderMode): void {
    this.flush();
    this.mode = mode;
  }

  clearDepth(): void {
    this.flush();
    this.renderer.clearDepth();
  }

  drawMesh(
    mesh: DecodedMesh,
    transform: Transform,
    options: ResolvedMeshOptions,
  ): void {
    if (!finiteTransform(transform) || !Number.isFinite(options.clipTime)) {
      return;
    }
    const gltf = mesh.value as GLTF;
    const posed = cloneSkinned(gltf.scene);
    if (options.clip !== null) {
      const clip = gltf.animations.find((entry) => entry.name === options.clip);
      if (clip !== undefined) {
        // Sampled looping, and a pure function of the arguments: the same
        // `clipTime` poses the same way whichever frame a reviewer lands on.
        const mixer = new THREE.AnimationMixer(posed);
        mixer.clipAction(clip).play();
        mixer.setTime(clip.duration > 0 ? options.clipTime % clip.duration : 0);
      }
    }
    if (options.material !== null || this.mode !== "standard") {
      const override =
        options.material === null ? null : this.materialFor(options.material);
      posed.traverse((object) => {
        const target = object as THREE.Mesh;
        if (target.isMesh !== true) return;
        target.material =
          override ?? this.modeShift(target.material as THREE.Material);
      });
    }
    place(posed, transform);
    this.queue(posed);
  }

  drawGeometry(
    geometry: unknown,
    material: ResolvedMaterial,
    transform: Transform,
  ): void {
    if (!finiteTransform(transform)) return;
    const mesh = new THREE.Mesh(
      geometry as THREE.BufferGeometry,
      this.materialFor(material),
    );
    place(mesh, transform);
    this.queue(mesh);
  }

  drawBillboard(texture: DecodedTexture, position: Vec3, size: Vec2): void {
    if (
      !finiteVec3(position) ||
      !Number.isFinite(size.x) ||
      !Number.isFinite(size.y)
    ) {
      return;
    }
    // Camera-facing, unlit and alpha-blended, whatever the render mode: the
    // mode governs mesh and geometry draws alone.
    const material = new THREE.SpriteMaterial({
      map: textureOf(texture),
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(position.x, position.y, position.z);
    sprite.scale.set(size.x, size.y, 1);
    this.frameOwned.push(material);
    this.queue(sprite);
  }

  drawLine(points: readonly Vec3[], color: Color): void {
    if (points.length < 2) return;
    for (const point of points) if (!finiteVec3(point)) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
    );
    const alpha = parseColor3d(color)[3] ?? 1;
    const material = new THREE.LineBasicMaterial({
      color: color3(color),
      transparent: alpha < 1,
      opacity: alpha,
      depthWrite: alpha >= 1,
    });
    this.frameOwned.push(geometry, material);
    this.queue(new THREE.Line(geometry, material));
  }

  drawHudText(
    text: string,
    position: Vec2,
    options: ResolvedHudTextOptions,
  ): void {
    const hud = this.hud;
    if (hud === null) return;
    const atlas = this.tintedAtlas(options.color);
    hud.imageSmoothingEnabled = false;
    for (const glyph of layoutHudText(text, position, options)) {
      const cell = cellOf(glyph.code);
      const x = this.deviceX(glyph.x);
      const y = this.deviceY(glyph.y);
      const width = glyph.width * this.fit.scale;
      const height = glyph.height * this.fit.scale;
      if (width <= 0 || height <= 0) continue;
      hud.drawImage(
        atlas,
        cell * GLYPH_WIDTH,
        0,
        GLYPH_WIDTH,
        GLYPH_HEIGHT,
        x,
        y,
        width,
        height,
      );
    }
  }

  drawHudRect(position: Vec2, size: Vec2, color: Color): void {
    const hud = this.hud;
    if (hud === null) return;
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(size.x) ||
      !Number.isFinite(size.y)
    ) {
      return;
    }
    hud.fillStyle = fillStyle(color);
    hud.fillRect(
      this.deviceX(position.x),
      this.deviceY(position.y),
      size.x * this.fit.scale,
      size.y * this.fit.scale,
    );
  }

  createBox(size: Vec3): unknown {
    return this.own(new THREE.BoxGeometry(size.x, size.y, size.z));
  }

  createSphere(radius: number): unknown {
    return this.own(new THREE.SphereGeometry(radius, 32, 16));
  }

  createCylinder(radius: number, height: number): unknown {
    return this.own(new THREE.CylinderGeometry(radius, radius, height, 32));
  }

  createCapsule(radius: number, height: number): unknown {
    // three's `length` is the distance between the cap centres, which is what
    // the engines' `height` is.
    return this.own(new THREE.CapsuleGeometry(radius, height, 8, 32));
  }

  createPlane(width: number, depth: number): unknown {
    const geometry = new THREE.PlaneGeometry(width, depth);
    // On the local XZ plane with a +Y normal, as the engines' plane is.
    geometry.rotateX(-Math.PI / 2);
    return this.own(geometry);
  }

  createMaterial(material: ResolvedMaterial): unknown {
    // The spec itself is the handle. What three material it becomes depends on
    // the render mode in force where it is DRAWN, and one produced value may be
    // drawn under two modes in one frame.
    return material;
  }

  render(): void {
    this.flush();
  }

  /** Free everything this drawer holds on the GPU. */
  dispose(): void {
    this.release();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.atlases.clear();
    this.atlas = null;
    for (const light of [...this.lightGroup.children]) {
      this.lightGroup.remove(light);
      (light as THREE.Light).dispose?.();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  /** Queue an object into the run in force, keeping the drawer's own order. */
  private queue(object: THREE.Object3D): void {
    object.renderOrder = this.order;
    this.order += 1;
    this.drawGroup.add(object);
  }

  /** Render the run in force, if it drew anything, and empty it. */
  private flush(): void {
    if (this.drawGroup.children.length === 0) return;
    this.renderer.render(this.scene, this.camera);
    this.drawGroup.clear();
  }

  /** Remember something to free when the next frame opens. */
  private own<T extends { dispose: () => void }>(value: T): T {
    this.frameOwned.push(value);
    return value;
  }

  /** Free what the frame just drawn made. */
  private release(): void {
    this.drawGroup.clear();
    for (const owned of this.frameOwned) owned.dispose();
    this.frameOwned = [];
  }

  /** A logical x in device pixels. */
  private deviceX(x: number): number {
    return this.fit.offsetX + x * this.fit.scale;
  }

  /** A logical y in device pixels. */
  private deviceY(y: number): number {
    return this.fit.offsetY + y * this.fit.scale;
  }

  /** One light of a frame's list, as three holds one. */
  private lightOf(light: LightState): THREE.Light {
    if (light.type === "ambient") {
      return new THREE.AmbientLight(color3(light.color), light.intensity);
    }
    if (light.type === "directional") {
      const lamp = new THREE.DirectionalLight(
        color3(light.color),
        light.intensity,
      );
      // The recording names the direction the light SHINES IN; three shines
      // from a position towards a target, so the lamp sits the other way.
      lamp.position.set(
        -light.direction.x,
        -light.direction.y,
        -light.direction.z,
      );
      lamp.target.position.set(0, 0, 0);
      lamp.add(lamp.target);
      return lamp;
    }
    const lamp = new THREE.PointLight(
      color3(light.color),
      light.intensity,
      light.range,
      // `pow(saturate(1 - d / range), 2)`, which is the engines' falloff.
      2,
    );
    lamp.position.set(light.position.x, light.position.y, light.position.z);
    return lamp;
  }

  /** What a resolved material is made of under the mode in force. */
  private materialFor(material: ResolvedMaterial): THREE.Material {
    const key = [
      this.mode,
      material.baseColor,
      material.emissive,
      material.roughness,
      material.metallic,
      material.opacity,
      material.unlit,
      material.baseColorMap?.path ?? "",
      material.normalMap?.path ?? "",
    ].join("|");
    const memo = this.materials.get(key);
    if (memo !== undefined) return memo;

    const translucent = material.opacity < 1;
    const common = {
      transparent: translucent,
      opacity: material.opacity,
      depthWrite: !translucent,
    };
    let built: THREE.Material;
    if (this.mode === "normals") {
      built = new THREE.MeshNormalMaterial({ ...common });
    } else if (this.mode === "unlit" || material.unlit) {
      built = new THREE.MeshBasicMaterial({
        ...common,
        color: color3(material.baseColor),
        map: textureOf(material.baseColorMap),
        wireframe: this.mode === "wireframe",
      });
    } else {
      built = new THREE.MeshStandardMaterial({
        ...common,
        color: color3(material.baseColor),
        map: textureOf(material.baseColorMap),
        normalMap: textureOf(material.normalMap),
        emissive: color3(material.emissive),
        roughness: material.roughness,
        metalness: material.metallic,
        wireframe: this.mode === "wireframe",
      });
    }
    // Kept for the drawer's life rather than the frame's: a material is a pure
    // function of (spec, mode), so re-using one is invisible to the picture and
    // saves a shader compile on every frame that draws with it.
    this.materials.set(key, built);
    return built;
  }

  /**
   * A file's own material, under a mode that overrides how it shades.
   *
   * The colours are read back in the space they were written in — the loader
   * put them there as linear values and this drawer manages no colour — so a
   * mesh drawn under `wireframe` or `unlit` keeps the colour it had under
   * `standard` rather than being converted twice on the way through.
   */
  private modeShift(material: THREE.Material): THREE.Material {
    if (this.mode === "standard") return material;
    const base = material as THREE.MeshStandardMaterial;
    const linear = THREE.LinearSRGBColorSpace;
    return this.materialFor({
      baseColor: `#${base.color?.getHexString(linear) ?? "ffffff"}`,
      roughness: base.roughness ?? 0.8,
      metallic: base.metalness ?? 0,
      emissive: `#${base.emissive?.getHexString(linear) ?? "000000"}`,
      opacity: material.opacity,
      unlit: false,
      baseColorMap: null,
      normalMap: null,
    });
  }

  /** The white glyph atlas: every covered glyph plus the replacement box. */
  private whiteAtlas(): HTMLCanvasElement {
    if (this.atlas !== null) return this.atlas;
    const cells = FONT_LAST_CODE_POINT - FONT_FIRST_CODE_POINT + 2;
    const canvas = document.createElement("canvas");
    canvas.width = cells * GLYPH_WIDTH;
    canvas.height = GLYPH_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("this browser has no 2D canvas");
    ctx.fillStyle = "#ffffff";
    for (let cell = 0; cell < cells; cell += 1) {
      const code =
        cell < cells - 1
          ? FONT_FIRST_CODE_POINT + cell
          : FONT_LAST_CODE_POINT + 1;
      const rows = glyphRows(code);
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        const bits = rows[row] ?? 0;
        for (let col = 0; col < GLYPH_WIDTH; col += 1) {
          if ((bits & (0x80 >> col)) === 0) continue;
          ctx.fillRect(cell * GLYPH_WIDTH + col, row, 1, 1);
        }
      }
    }
    this.atlas = canvas;
    return canvas;
  }

  /** The atlas in one colour, built once per colour a replay letters in. */
  private tintedAtlas(color: Color): HTMLCanvasElement {
    const memo = this.atlases.get(color);
    if (memo !== undefined) return memo;
    const white = this.whiteAtlas();
    const canvas = document.createElement("canvas");
    canvas.width = white.width;
    canvas.height = white.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("this browser has no 2D canvas");
    ctx.drawImage(white, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = fillStyle(color);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.atlases.set(color, canvas);
    return canvas;
  }
}

/** Which cell of the atlas a code point letters from. */
function cellOf(code: number): number {
  const cells = FONT_LAST_CODE_POINT - FONT_FIRST_CODE_POINT + 2;
  return code >= FONT_FIRST_CODE_POINT && code <= FONT_LAST_CODE_POINT
    ? code - FONT_FIRST_CODE_POINT
    : cells - 1;
}
