/**
 * The draw-command recorder: the flight recorder built into the scene context,
 * armed and disarmed through the `Engine` object, whose `stopRecording()`
 * value is the `Recording` this package's `contract.ts` specifies.
 *
 * Everything here mirrors `docs/engines/simple-3d/apis/recording.md` and
 * `docs/engines/simple-3d/concepts/recording.md` — those pages are the
 * specification, and behavior that disagrees with them is wrong.
 *
 * Five decisions shape the module, and each is what makes a later property
 * true:
 *
 * 1. **The recorder is fed, not wrapping.** The scene context is engine-owned,
 *    so there is no proxy over someone else's surface: the scene calls
 *    `recordCall` beside each call it executes, and arming is a flag in here
 *    rather than a substitution of one context for another. The identity a
 *    game holds is therefore stable for the engine's whole life.
 * 2. **Interning happens at call time, against a per-frame journal.** Every
 *    table entry is deduplicated on its canonical JSON the moment it is
 *    produced, and the journal records exactly what the open frame added.
 *    A frame still open when the recorder is disarmed is dropped by rolling
 *    the journal back, which is what keeps "every entry is one some frame
 *    names" true without a settling pass over the whole document.
 * 3. **Recipes are collected whether or not the recorder is armed.** A build
 *    is free to create a material long before a caller arms the recorder, and
 *    an immutable value's recipe is one producing call however long it waits.
 *    The collection is a WeakMap from the produced value to its call, so the
 *    idle cost is one entry per produced value and nothing that grows with
 *    the length of a run.
 * 4. **Handles are described by the scene, captured here.** The recorder
 *    recognizes a mesh, texture, or material handle through an injected
 *    `describeHandle` rather than by importing the scene, which keeps this
 *    module a leaf over the contract; the byte budget, the base64 and data-URL
 *    encodings, and the identity-keyed capture-once rule all live here so
 *    every handle degrades the same way.
 * 5. **Encoding runs behind a guard wherever the recorder touches a value.**
 *    A cyclic object, a throwing getter, a value whose proxy traps refuse to
 *    say what shape it is, a depth-32 container, and the 65,536-value
 *    expansion bound each record as an opaque marker while the call proceeds,
 *    so a build draws the same pixels whether or not anything is being
 *    captured. The scene records beside every call it executes, so anything
 *    that escaped from here would turn a draw that works into a draw that
 *    throws whenever the recorder happens to be armed.
 */

import type {
  CapturedAsset,
  DrawOp,
  DrawValue,
  LightState,
  MaterialMapSlot,
  ProducingMethod,
  RecordedFrame,
  Recording,
  RenderMode,
  RenderState,
  Resource,
  SceneOpMethod,
} from "./contract";
import {
  ASSET_BYTE_LIMIT,
  LIGHT_LIMIT,
  RECORDING_FORMAT,
  SIGNIFICANT_DIGITS,
  VALUE_DEPTH_LIMIT,
  VALUE_EXPANSION_LIMIT,
} from "./contract";
import type { CameraState } from "./math";

// The format version is re-exported here as well as from the contract, so the
// engine's entry point re-exports one name and the 2D packages' convention —
// `RECORDING_FORMAT` reachable beside the recorder — holds unchanged.
export { RECORDING_FORMAT } from "./contract";

/* -------------------------------------------------------------------------- */
/* The seams the scene supplies                                               */
/* -------------------------------------------------------------------------- */

/**
 * What a handle captures as. `bytes` is a mesh's glb file; `png` is a
 * texture's pixels as a PNG file — the engine's own rasterizations (a
 * `text:`-pathed texture) arrive already encoded, so the recorder never owns
 * an image codec. A material names its textures as the handles themselves and
 * the recorder interns each one, so a map slot resolves to an `assets` index.
 */
export type HandleCapturePayload =
  | { kind: "mesh"; path: string; bytes: Uint8Array }
  | {
      kind: "texture";
      path: string;
      width: number;
      height: number;
      png: Uint8Array;
    }
  | {
      kind: "material";
      path: string;
      maps: ReadonlyArray<readonly [MaterialMapSlot, object]>;
    };

/**
 * The recorder's view of one engine handle: the constructor-style name a
 * degraded capture records as (`{ $opaque: "MeshHandle" }`), and the capture
 * itself, called at most once per handle per recording.
 */
export interface HandleDescription {
  /** The handle's type name, used for the `$opaque` degradation. */
  name: string;
  /** Builds the capture payload. Called once per handle per recording. */
  capture(): HandleCapturePayload;
}

/** What the recorder needs from whoever owns it. */
export interface RecorderDeps {
  /**
   * The envelope figures, read when the recorder is armed — the docs fix the
   * design size and background at arm time rather than at close.
   */
  envelope(): { width: number; height: number; background: string | null };
  /** Recognizes an engine handle; `null` for every other value. */
  describeHandle(value: object): HandleDescription | null;
}

/** The renderer state a frame inherits, as the scene holds it — the light list may exceed the format's bound and is cut here. */
export interface InheritedState {
  camera: CameraState;
  lights: readonly LightState[];
  mode: RenderMode;
}

/** The figures a closing frame carries, exactly as the engine reported them. */
export interface FrameFigures {
  count: number;
  timeMs: number;
  deltaMs: number;
}

/* -------------------------------------------------------------------------- */
/* Value helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The name to report for a value the recorder cannot carry. The constructor
 * name rather than `typeof`, because every interesting case here is an object
 * and "object" tells a reader nothing about which one leaked.
 */
function opaqueName(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    const proto = Object.getPrototypeOf(value) as {
      constructor?: { name?: string };
    } | null;
    return proto?.constructor?.name ?? "object";
  } catch {
    // A proxy may refuse its prototype; no label at all is better than a
    // throw from inside a trap.
    return "object";
  }
}

/**
 * A number as the recording writes it: at most nine significant digits.
 * Non-finite values travel unchanged — `toPrecision` refuses them, and
 * `JSON.stringify` writes `null` for them either way, so rounding would only
 * add a way to fail. The 2D recorder makes the same choice.
 */
function roundNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toPrecision(SIGNIFICANT_DIGITS));
}

/**
 * A value's JSON with object keys in a fixed order — the interning key. It
 * has to be stable against the order fields were produced in: two entries
 * that mean the same thing must be one entry however the objects inside them
 * were built.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.keys(value as object)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    );
  return `{${entries.join(",")}}`;
}

/** The marker a bound-cut container carries its remainder as. */
function remainder(): DrawValue {
  return { $opaque: "truncated" };
}

/** Whether an object is plain data the format can carry field by field. */
function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

/**
 * Which of the three shapes the format expands an object as — and `"opaque"`
 * for one it cannot, a class instance and a value that refuses to say what it
 * is alike. Both questions are asked here, behind one guard, because both can
 * throw: `Array.isArray` refuses a revoked proxy and `Object.getPrototypeOf`
 * refuses one whose trap does.
 */
function classify(value: object): "array" | "plain" | "opaque" {
  try {
    if (Array.isArray(value)) return "array";
    return isPlain(value) ? "plain" : "opaque";
  } catch {
    return "opaque";
  }
}

/**
 * A deep copy of plain data with every number rounded to the format's nine
 * significant digits — how the inherited renderer state is written, since the
 * Numbers rule covers `RenderState` as well as `DrawValue`.
 */
function deepRound<T>(value: T): T {
  if (typeof value === "number") return roundNumber(value) as T;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => deepRound(entry)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as object)) {
    out[key] = deepRound(entry);
  }
  return out as T;
}

/* -------------------------------------------------------------------------- */
/* Base64                                                                     */
/* -------------------------------------------------------------------------- */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Standard base64, written here rather than through `Buffer` or `btoa` so the
 * recorder behaves identically in Node and in a browser, with no host lookup.
 * Output is chunked into strings of bounded length before joining, because a
 * 16 MB capture built one character at a time would be quadratic.
 */
function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    chunk +=
      B64[a >> 2]! +
      B64[((a & 3) << 4) | (b >> 4)]! +
      B64[((b & 15) << 2) | (c >> 6)]! +
      B64[c & 63]!;
    if (chunk.length >= 0x8000) {
      parts.push(chunk);
      chunk = "";
    }
  }
  if (i < n) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < n ? (bytes[i + 1] ?? 0) : null;
    chunk += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    chunk += b === null ? "==" : `${B64[(b & 15) << 2]!}=`;
  }
  parts.push(chunk);
  return parts.join("");
}

/* -------------------------------------------------------------------------- */
/* The recorder                                                               */
/* -------------------------------------------------------------------------- */

/** A mutable expansion budget, threaded through one encoded value's walk. */
interface Budget {
  left: number;
}

/** Where the asset tables stood before one composite capture began. */
interface AssetMark {
  assets: number;
  bytes: number;
  contentKeys: number;
  identities: number;
}

/** What the open frame added, so a dropped frame leaves no unnamed entry behind. */
interface FrameJournal {
  state: number;
  surface: { width: number; height: number };
  truncated: boolean;
  ops: number[];
  opsLength: number;
  statesLength: number;
  resourcesLength: number;
  assetsLength: number;
  assetBytes: number;
  opKeys: string[];
  stateKeys: string[];
  resourceKeys: string[];
  assetContentKeys: string[];
  assetIdentities: object[];
}

/**
 * The recorder. One instance lives inside each engine's scene context for the
 * engine's whole life; `start`/`stop` are what `engine.startRecording()` and
 * `engine.stopRecording()` delegate to.
 */
export class SceneRecorder {
  private readonly deps: RecorderDeps;

  /** Producing calls, collected from creation whether or not armed. */
  private readonly recipes = new WeakMap<
    object,
    { method: ProducingMethod; args: readonly unknown[] }
  >();

  private armed = false;
  private envelope: {
    width: number;
    height: number;
    background: string | null;
  } = {
    width: 0,
    height: 0,
    background: null,
  };

  private ops: DrawOp[] = [];
  private states: RenderState[] = [];
  private resources: Resource[] = [];
  private assets: CapturedAsset[] = [];
  private frames: RecordedFrame[] = [];

  private opIndex = new Map<string, number>();
  private stateIndex = new Map<string, number>();
  private resourceIndex = new Map<string, number>();
  private assetContentIndex = new Map<string, number>();
  /** Handle identity → its table index, or `null` once the handle degraded. */
  private assetByIdentity = new Map<object, number | null>();
  private assetBytes = 0;

  private journal: FrameJournal | null = null;

  constructor(deps: RecorderDeps) {
    this.deps = deps;
  }

  /** Whether operations are being captured. */
  active(): boolean {
    return this.armed;
  }

  /**
   * Arms the recorder. Capture begins at the next frame — a frame already
   * open when this is called is not captured, so an arm from inside `update`
   * or `render` yields whole frames only.
   */
  start(): void {
    if (this.armed) {
      throw new Error(
        "startRecording was called while the recorder is already armed: call stopRecording to close the current recording first",
      );
    }
    this.armed = true;
    // The design size and background are fixed now, at arm time, rather than
    // read back at close — the documented rule.
    this.envelope = this.deps.envelope();
    this.ops = [];
    this.states = [];
    this.resources = [];
    this.assets = [];
    this.frames = [];
    this.opIndex = new Map();
    this.stateIndex = new Map();
    this.resourceIndex = new Map();
    this.assetContentIndex = new Map();
    this.assetByIdentity = new Map();
    this.assetBytes = 0;
    this.journal = null;
  }

  /**
   * Disarms the recorder and returns everything captured since `start`. A
   * frame still open is dropped by rolling its journal back, so every table
   * entry the document holds is one some closed frame names.
   */
  stop(): Recording {
    if (!this.armed) {
      throw new Error(
        "stopRecording was called while the recorder is not armed: call startRecording to arm it first",
      );
    }
    this.rollback();
    this.armed = false;
    return {
      format: RECORDING_FORMAT,
      space: "3d",
      width: this.envelope.width,
      height: this.envelope.height,
      background: this.envelope.background,
      assets: this.assets,
      resources: this.resources,
      ops: this.ops,
      states: this.states,
      frames: this.frames,
    };
  }

  /**
   * Collects a produced value's recipe, from the moment the scene context
   * creates it and whether or not the recorder is armed. The arguments are
   * the scene's own validated copies, so holding them raw is safe; they are
   * encoded at the moment of use, against the recording then open, because
   * `$asset` indices belong to one recording's tables.
   */
  registerResource(
    value: object,
    method: ProducingMethod,
    args: readonly unknown[],
  ): void {
    this.recipes.set(value, { method, args });
  }

  /**
   * Opens a frame: snapshots the renderer state the frame inherited, before
   * its first operation, and remembers the backing store it draws into.
   * Ignored while disarmed.
   */
  openFrame(
    state: InheritedState,
    surface: { width: number; height: number },
  ): void {
    if (!this.armed) return;
    this.rollback();
    const journal: FrameJournal = {
      state: 0,
      surface: { width: surface.width, height: surface.height },
      truncated: state.lights.length > LIGHT_LIMIT,
      ops: [],
      opsLength: this.ops.length,
      statesLength: this.states.length,
      resourcesLength: this.resources.length,
      assetsLength: this.assets.length,
      assetBytes: this.assetBytes,
      opKeys: [],
      stateKeys: [],
      resourceKeys: [],
      assetContentKeys: [],
      assetIdentities: [],
    };
    this.journal = journal;
    // The inherited light list is cut to the format's bound here; the frame
    // says so through `truncated`, computed above from the uncut list.
    const entry: RenderState = deepRound({
      camera: state.camera,
      lights: state.lights.slice(0, LIGHT_LIMIT),
      mode: state.mode,
    });
    journal.state = this.internState(entry, journal);
  }

  /** Records one scene-context call into the open frame; one flag test while idle. */
  recordCall(method: SceneOpMethod, args: readonly unknown[]): void {
    const journal = this.journal;
    if (journal === null) return;
    const encoded = args.map((arg) => this.encodeValue(arg, journal));
    const op: DrawOp = { op: "call", method, args: encoded };
    journal.ops.push(this.internOp(op, journal));
  }

  /** Closes the open frame with the engine's own figures, which are carried exact. */
  closeFrame(figures: FrameFigures): void {
    const journal = this.journal;
    if (journal === null) return;
    const frame: RecordedFrame = {
      count: figures.count,
      timeMs: figures.timeMs,
      deltaMs: figures.deltaMs,
      surface: journal.surface,
      state: journal.state,
      ops: journal.ops,
    };
    if (journal.truncated) frame.truncated = true;
    this.frames.push(frame);
    this.journal = null;
  }

  /* ---------------------------------------------------------------------- */
  /* Interning                                                              */
  /* ---------------------------------------------------------------------- */

  /** Discards the open frame and everything it interned. */
  private rollback(): void {
    const journal = this.journal;
    if (journal === null) return;
    this.ops.length = journal.opsLength;
    this.states.length = journal.statesLength;
    this.resources.length = journal.resourcesLength;
    this.assets.length = journal.assetsLength;
    this.assetBytes = journal.assetBytes;
    for (const key of journal.opKeys) this.opIndex.delete(key);
    for (const key of journal.stateKeys) this.stateIndex.delete(key);
    for (const key of journal.resourceKeys) this.resourceIndex.delete(key);
    for (const key of journal.assetContentKeys)
      this.assetContentIndex.delete(key);
    for (const identity of journal.assetIdentities)
      this.assetByIdentity.delete(identity);
    this.journal = null;
  }

  private internOp(op: DrawOp, journal: FrameJournal): number {
    const key = canonical(op);
    const found = this.opIndex.get(key);
    if (found !== undefined) return found;
    const at = this.ops.length;
    this.ops.push(op);
    this.opIndex.set(key, at);
    journal.opKeys.push(key);
    return at;
  }

  private internState(state: RenderState, journal: FrameJournal): number {
    const key = canonical(state);
    const found = this.stateIndex.get(key);
    if (found !== undefined) return found;
    const at = this.states.length;
    this.states.push(state);
    this.stateIndex.set(key, at);
    journal.stateKeys.push(key);
    return at;
  }

  /**
   * A produced value's table index. The recipe is its `make` with an empty
   * `then` — produced values are immutable — and two producing calls with the
   * same arguments share one entry, keyed on the canonical encoded make.
   */
  private internResource(
    recipe: { method: ProducingMethod; args: readonly unknown[] },
    journal: FrameJournal,
  ): number {
    const make = {
      method: recipe.method,
      args: recipe.args.map((arg) => this.encodeValue(arg, journal)),
    };
    const key = canonical(make);
    const found = this.resourceIndex.get(key);
    if (found !== undefined) return found;
    const at = this.resources.length;
    this.resources.push({ make, then: [] });
    this.resourceIndex.set(key, at);
    journal.resourceKeys.push(key);
    return at;
  }

  /**
   * A handle's table index, or `null` once it degraded. Keyed on identity so
   * a handle is captured once however many frames draw it; keyed again on the
   * entry's canonical form so two handles carrying the same bytes share one
   * entry. New captures are refused once the byte budget — counted over
   * `data` and `src`, holdings never exceeding the bound — would be passed.
   */
  private internAsset(
    handle: object,
    description: HandleDescription,
    journal: FrameJournal,
  ): number | null {
    const known = this.assetByIdentity.get(handle);
    if (known !== undefined) return known;
    let payload: HandleCapturePayload;
    try {
      payload = description.capture();
    } catch {
      // A capture that throws is a value the recorder could not carry.
      this.rememberIdentity(handle, null, journal);
      return null;
    }
    let entry: CapturedAsset | null = null;
    let cost = 0;
    if (payload.kind === "mesh") {
      const data = toBase64(payload.bytes);
      cost = data.length;
      entry = { kind: "mesh", path: payload.path, data };
    } else if (payload.kind === "texture") {
      const src = `data:image/png;base64,${toBase64(payload.png)}`;
      cost = src.length;
      entry = {
        kind: "texture",
        path: payload.path,
        width: payload.width,
        height: payload.height,
        src,
      };
    } else {
      // A material carries no bytes of its own — its cost is its textures',
      // each interned on its own. A texture that cannot be captured degrades
      // the whole material, because a maps table silently missing a slot
      // would misreport what the build drew with.
      //
      // The maps captured before the failure are rolled back with it. A
      // degraded material names none of them, so leaving them in the table
      // would leave entries no frame names — the one invariant the tables
      // promise — and would spend the byte budget on pixels nothing can
      // resolve. A map some *other* draw already captured is untouched: it
      // was interned before the mark and this capture only read it back.
      const mark = this.markAssets(journal);
      const maps: Partial<Record<MaterialMapSlot, number>> = {};
      let failed = false;
      for (const [slot, texture] of payload.maps) {
        const nested = this.deps.describeHandle(texture);
        const index =
          nested === null ? null : this.internAsset(texture, nested, journal);
        if (index === null) {
          failed = true;
          break;
        }
        maps[slot] = index;
      }
      if (failed) this.restoreAssets(mark, journal);
      entry = failed ? null : { kind: "material", path: payload.path, maps };
    }
    if (entry === null) {
      this.rememberIdentity(handle, null, journal);
      return null;
    }
    const key = canonical(entry);
    const existing = this.assetContentIndex.get(key);
    if (existing !== undefined) {
      this.rememberIdentity(handle, existing, journal);
      return existing;
    }
    if (this.assetBytes + cost > ASSET_BYTE_LIMIT) {
      this.rememberIdentity(handle, null, journal);
      return null;
    }
    const at = this.assets.length;
    this.assets.push(entry);
    this.assetBytes += cost;
    this.assetContentIndex.set(key, at);
    journal.assetContentKeys.push(key);
    this.rememberIdentity(handle, at, journal);
    return at;
  }

  private rememberIdentity(
    handle: object,
    index: number | null,
    journal: FrameJournal,
  ): void {
    this.assetByIdentity.set(handle, index);
    journal.assetIdentities.push(handle);
  }

  /**
   * Where the asset tables stand, so a capture made of several others can be
   * undone whole. The frame journal is the coarse version of the same idea —
   * this is the same rollback at the grain of one composite handle.
   */
  private markAssets(journal: FrameJournal): AssetMark {
    return {
      assets: this.assets.length,
      bytes: this.assetBytes,
      contentKeys: journal.assetContentKeys.length,
      identities: journal.assetIdentities.length,
    };
  }

  /** Undoes every asset interned since `mark`, tables and journal alike. */
  private restoreAssets(mark: AssetMark, journal: FrameJournal): void {
    this.assets.length = mark.assets;
    this.assetBytes = mark.bytes;
    for (const key of journal.assetContentKeys.splice(mark.contentKeys)) {
      this.assetContentIndex.delete(key);
    }
    for (const identity of journal.assetIdentities.splice(mark.identities)) {
      this.assetByIdentity.delete(identity);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Encoding                                                               */
  /* ---------------------------------------------------------------------- */

  /** One encoded value: fresh depth, fresh expansion budget, fresh cycle trail. */
  private encodeValue(value: unknown, journal: FrameJournal): DrawValue {
    return this.walk(
      value,
      0,
      { left: VALUE_EXPANSION_LIMIT },
      new Set(),
      journal,
    );
  }

  private walk(
    value: unknown,
    depth: number,
    budget: Budget,
    trail: Set<object>,
    journal: FrameJournal,
  ): DrawValue {
    budget.left -= 1;
    if (value === null) return null;
    const kind = typeof value;
    if (kind === "number") return roundNumber(value as number);
    if (kind === "boolean" || kind === "string") return value as DrawValue;
    if (kind !== "object") {
      // undefined, functions, symbols, bigints: values JSON cannot carry.
      return { $opaque: opaqueName(value) };
    }
    const subject = value as object;
    const described = this.deps.describeHandle(subject);
    if (described !== null) {
      const index = this.internAsset(subject, described, journal);
      return index === null ? { $opaque: described.name } : { $asset: index };
    }
    const recipe = this.recipes.get(subject);
    if (recipe !== undefined) {
      return { $res: this.internResource(recipe, journal) };
    }
    if (trail.has(subject)) return { $opaque: opaqueName(subject) };
    if (depth >= VALUE_DEPTH_LIMIT) return { $opaque: opaqueName(subject) };
    // Asking a value what shape it is can itself throw: `Array.isArray`
    // refuses a revoked proxy, and `Object.getPrototypeOf` refuses one whose
    // trap says so. A value that will not answer is a value the recorder
    // cannot carry, and it records as a marker rather than escaping — the
    // scene records beside every call it executes, so a throw from here would
    // turn a draw that works into a draw that throws whenever the recorder
    // happens to be armed, and the whole point of the guards is that a build
    // draws the same pixels either way.
    const shape = classify(subject);
    if (shape === "opaque") return { $opaque: opaqueName(subject) };
    if (shape === "array") {
      trail.add(subject);
      try {
        const out: DrawValue[] = [];
        for (const entry of subject as readonly unknown[]) {
          if (budget.left <= 0) {
            out.push(remainder());
            break;
          }
          out.push(this.walk(entry, depth + 1, budget, trail, journal));
        }
        return out;
      } catch {
        // An array-shaped value whose elements refuse to be read at all.
        return { $opaque: opaqueName(subject) };
      } finally {
        trail.delete(subject);
      }
    }
    // The whole object records as a marker when a getter throws: the value
    // could not be read, and half an object would misstate what was supplied.
    let entries: [string, unknown][];
    try {
      entries = Object.keys(subject).map((key) => [
        key,
        (subject as Record<string, unknown>)[key],
      ]);
    } catch {
      return { $opaque: opaqueName(subject) };
    }
    trail.add(subject);
    const out: Record<string, DrawValue> = {};
    try {
      for (const [key, entry] of entries) {
        if (budget.left <= 0) {
          out["$rest"] = remainder();
          break;
        }
        out[key] = this.walk(entry, depth + 1, budget, trail, journal);
      }
    } finally {
      trail.delete(subject);
    }
    return out;
  }
}
