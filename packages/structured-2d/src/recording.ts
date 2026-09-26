/**
 * Draw-command recording: an opt-in flight recorder over the context the
 * rendering pipeline draws through.
 *
 * A recording is the list of operations the pipeline issued against its 2D
 * context, frame by frame, in the order it issued them. Replaying it re-issues
 * those operations against another context and reproduces the picture the build
 * drew — so the evidence a reviewer sees is the build's own drawing rather than
 * a re-shoot of it. The recorder wraps that context once, at engine
 * construction, and never swaps it: the built-in render components and a
 * `DrawComponent`'s `DrawApi.ctx` all draw through the wrapper, so the whole
 * picture is recorded.
 *
 * Six decisions shape the format, and each of them is what makes a later
 * property true:
 *
 * 1. **Every frame carries the context state it inherited.** A frame's own
 *    operations are not enough to draw it: a game that sets `font` once on its
 *    first frame relies on the context still carrying it a thousand frames
 *    later. Recording the inherited state at the top of each frame makes every
 *    frame independently renderable, which is what lets a player seek to frame
 *    900 without replaying the 899 before it. That is the whole reason two
 *    recordings can be scrubbed side by side in step.
 * 2. **The state a frame inherited includes the parts a context will not
 *    report.** A build may `save` on one frame and `restore` on the next, it
 *    may set a clip that is still in force a hundred frames later, and it may
 *    open a path on one frame and fill it on the next. None of the three can be
 *    read back, so the recorder shadows all of them: a frame names the states
 *    the context had saved when it opened, and each state carries the clip
 *    segments in force and the path that was current.
 * 3. **What a frame draws with lives in tables the whole recording shares.** A
 *    gradient is created through the context and then mutated through the
 *    object the context returned, so a recorder that only watched the context
 *    would record the creation and miss every colour stop. The four producing
 *    calls are wrapped, their mutations are collected as that value's recipe,
 *    and a *use* of the value records as an index into the recording's resource
 *    table. Recording the recipe against the frame that happened to create the
 *    value would leave an inherited fill naming an operation a later frame does
 *    not contain, and frame independence would be a claim rather than a
 *    property. Bitmap sources are carried the same way, as captured pixels in
 *    an image table, because a sprite-based build's picture is mostly what it
 *    blits.
 * 4. **A value is resolved when it is observed and interned when it is used.**
 *    A style property holds a live reference, so what a gradient paints is
 *    decided at the paint and not at the assignment; `createPattern`, in the
 *    other direction, copies its source at the call, so what a pattern holds is
 *    decided at the producing call and not at the use. Encoding therefore runs
 *    in two stages: a value is turned into a portable form the moment the
 *    recorder sees it — host objects become captured bytes, nested recipes or
 *    markers, and numbers are rounded — and that form is interned into the
 *    running recording's tables at the moment of use. Only the table indices
 *    are deferred.
 * 5. **Each distinct entry is written once.** Consecutive frames issue very
 *    nearly the same operations under very nearly the same state, and a sprite
 *    that sits still is the identical call every frame. Operations, states,
 *    resources and images are interned on their canonical JSON and named by
 *    index, which bounds what a recording costs to store and what a reviewer's
 *    browser pays to hold it.
 * 6. **Recording is bracketed by the frame, not by the engine's lifetime.** The
 *    recorder is armed and disarmed by whoever holds the engine, so a check
 *    records the section of a scenario it is about and pays nothing for the
 *    setup that got there. What is shadowed — the produced values, the save
 *    stack, the clip and the path — is maintained whether or not the recorder
 *    is armed, because a build establishes all four long before a caller arms
 *    anything. Each is bounded, so an engine that is never asked to record
 *    holds what its own drawing is worth and nothing per frame, and a frame
 *    that inherited a shadow cut down to its bound says so rather than
 *    replaying under a state close to the build's in silence.
 *
 * Every bound here — the 64-entry save stack, the 1024-op clip and path
 * shadows, the 1024-step recipes, the 32-deep / 65,536-value encoding bounds,
 * nine significant digits, the 16 MB image budget, and `RECORDING_FORMAT`
 * itself — is part of the format rather than a choice this recorder makes. Two
 * recorders write the format, the engine's and the one a validator injects into
 * an engineless build, and a bound they disagreed on would have them answer the
 * same drawing with two different documents.
 *
 * The recorder must never disturb what the build draws. Every value it encodes
 * is something the build handed over, so encoding runs behind a guard, carries
 * a visited set and a depth bound, and degrades to an opaque marker rather than
 * throwing out of a trap the build is standing in.
 *
 * What is deliberately outside a recording: the diagnostics overlay, which is
 * chrome drawn over the finished picture rather than part of it, and anything a
 * game draws to a surface of its own rather than through the context the engine
 * handed it. The second is not preventable — a game may reach `ctx.canvas` and
 * get an unwrapped context back — but it is detectable, because a frame that
 * emits no operations while its pixels change is a frame that drew somewhere
 * else. The one thing done *to* that canvas element that the recorder cannot
 * let pass is a write to its backing store size, which resets the context and
 * everything shadowed with it, so the element carries the recorder's own
 * accessors for `width` and `height`.
 */

import type {
  CapturedImage,
  DrawOp,
  DrawState,
  DrawValue,
  FrameInfo,
  PathSegment,
  RecordedFrame,
  Recording,
  Resource,
} from "./contract";

/**
 * The integer this engine writes as `Recording.format`.
 *
 * A reader takes it first and can then refuse a document that is not a
 * recording, rather than drawing a wrong picture confidently. There is one
 * recording format and it is version `1`: the engine reads no other shape and
 * writes no other shape, so a recording that states anything else was not
 * written by a recorder.
 */
export const RECORDING_FORMAT = 1;

/**
 * A captured entry as this recorder writes one: carrying its own pixels.
 *
 * {@link CapturedImage} also names the forms whose pixels live in a file beside
 * the recording, written by a writer that has a directory to put them in. A
 * recording this engine hands back is assembled in memory and travels alone, so
 * every entry in it is inline and the reads below say so.
 */
type InlineImage = Extract<CapturedImage, { src: string } | { data: string }>;

/** What a recording is armed with — fixed at arming, from `EngineOptions`. */
export interface RecorderStartOptions {
  /** The logical design width the operations are issued in. */
  width: number;
  /** The logical design height the operations are issued in. */
  height: number;
  /** The CSS color each frame clears to, or `null` for transparency. */
  background: string | null;
}

/**
 * The 2D context properties a frame inherits from the one before it.
 *
 * This is the whole of the canvas state that survives a frame boundary, minus
 * the transform, the dash pattern and the clip, which are read through their
 * own accessors below. The list is explicit rather than derived from the
 * context object because enumerating a `CanvasRenderingContext2D` yields its
 * methods too, and because the set has to mean the same thing on a browser
 * context and on the native canvas a validator runs against — where several of
 * these are simply absent.
 */
const STATE_PROPERTIES = [
  "globalAlpha",
  "globalCompositeOperation",
  "filter",
  "imageSmoothingEnabled",
  "imageSmoothingQuality",
  "strokeStyle",
  "fillStyle",
  "shadowOffsetX",
  "shadowOffsetY",
  "shadowBlur",
  "shadowColor",
  "lineWidth",
  "lineCap",
  "lineJoin",
  "miterLimit",
  "lineDashOffset",
  "font",
  "textAlign",
  "textBaseline",
  "direction",
  "letterSpacing",
  "wordSpacing",
  "fontKerning",
] as const;

/**
 * The significant digits a recorded number keeps.
 *
 * A double's decimal expansion past the ninth digit is a fact about the
 * arithmetic that produced a coordinate rather than about the picture it draws:
 * nine digits over a design space of a thousand-odd units resolves to about a
 * millionth of a pixel. The full expansion of a physics position costs
 * seventeen characters, on every argument of every operation of every frame,
 * and it is what stops two operations a frame apart from being the same
 * operation.
 */
const SIGNIFICANT_DIGITS = 9;

/**
 * The image bytes one recording captures before it stops capturing new ones.
 *
 * A build that blits a full-screen offscreen canvas whose contents change every
 * frame is worth one image per frame, and left unbounded that is a replay of
 * tens of megabytes no reviewer can load. Past the cap a new capture degrades
 * to the opaque marker a player already reports and skips, which is a
 * partly-drawn replay rather than no replay at all. Counted on the payload the
 * recording carries, because the document those strings land in is the thing
 * the cap protects.
 */
const CAPTURE_BUDGET = 16 * 1024 * 1024;

/**
 * The mutations one produced value keeps before it degrades to a marker.
 *
 * A value is tracked from the moment the context makes it and for as long as
 * the engine lives, so its recipe is the one thing that grows without a frame
 * boundary to bound it. A build that adds a colour stop every frame would grow
 * it without limit; past the bound the value records as opaque, which a player
 * reports, rather than the recorder holding a list nobody can replay anyway.
 */
const RECIPE_STEPS = 1024;

/**
 * The states a frame's inherited stack carries, innermost kept.
 *
 * A build that saves more often than it restores runs deeper and deeper, and
 * every frame open would re-encode the whole of it — a cost that grows without
 * bound for the rest of the recording. Past the bound the outermost entries are
 * dropped, because a `restore` pops the innermost first and those are the ones
 * a frame's own operations can still reach.
 */
const SAVE_STACK = 64;

/**
 * The path operations the current path and the clip in force each keep.
 *
 * Neither has a frame boundary to bound it. `beginPath` empties the path buffer
 * and `reset` empties both, so a build that calls neither accumulates
 * operations for the rest of the recording — and every one of them is
 * re-encoded into the state each frame inherits. Past the bound what is already
 * kept is kept and a further operation is refused, so a frame carries a prefix
 * of the path the build built, and says so through
 * {@link RecordedFrame.truncated}: a picture the format could not carry has to
 * be distinguishable from one it carried.
 */
const SHADOW_OPS = 1024;

/**
 * What one marker stands for when it stands for everything past a bound.
 *
 * The remainder of a value the encoder refused to follow any further, carried
 * as a single marker rather than as one marker per value dropped.
 */
const REMAINDER = "truncated";

/**
 * The key the remainder of an object's fields is carried under.
 *
 * An array's remainder is its last element and needs no name; an object's needs
 * one, and it has to be a name a player reads as one more field rather than as
 * a marker standing for the whole object.
 */
const REMAINDER_KEY = "$rest";

/**
 * How far encoding follows a value the build supplied.
 *
 * The arguments a build passes are its own objects, and a deeply nested one is
 * either data no player needs or a structure that has no business in a draw
 * call. The bound is what stops a recursive encode from overflowing the stack
 * inside a trap the build is standing in; a value past it records as opaque.
 */
const ENCODE_DEPTH = 32;

/**
 * How many values one encoded value is allowed to expand into.
 *
 * A depth bound alone does not bound the work. A structure whose nodes are
 * shared — twenty levels of a graph where each node names the same next one
 * twice — is shallower than the bound and expands to a million values, because
 * JSON has no way to say "the same one again". Sharing is resolved once and
 * counted every time it is reached, and the remainder of whatever container the
 * bound falls inside records as one marker.
 */
const ENCODE_NODES = 65536;

/**
 * The context methods whose answer the recording rebuilds from a recipe.
 *
 * Named rather than inferred from "the call returned an object", because a
 * recipe is re-issued against the context a player is drawing into and that is
 * faithful only for a value whose content does not depend on context state.
 * Treating `getTransform` as a producer would replay every following operation
 * under whatever transform the player's canvas happened to hold.
 */
const PRODUCERS = new Set([
  "createLinearGradient",
  "createRadialGradient",
  "createConicGradient",
  "createPattern",
]);

/**
 * The calls that paint through the style properties.
 *
 * A style property holds a live reference to what was assigned to it, so a
 * gradient given another colour stop after the assignment paints under that
 * stop without ever being assigned again. These are the calls where that
 * matters: before one is recorded, a property whose value has moved on since
 * the encoding last written for it is re-stated, so the operations that follow
 * say what the context is about to paint.
 */
const PAINTERS = new Set([
  "fill",
  "stroke",
  "fillRect",
  "strokeRect",
  "fillText",
  "strokeText",
]);

/**
 * The calls that build the current path.
 *
 * A canvas reports neither its current path nor the clip taken from it, so both
 * are kept as the calls that built them: a `clip` records as the path that
 * produced it, and the path itself travels in the state a frame inherits. The
 * buffer is emptied by `beginPath`, so it grows exactly as far as the context's
 * own current path does.
 */
const PATH_METHODS = new Set([
  "beginPath",
  "closePath",
  "moveTo",
  "lineTo",
  "bezierCurveTo",
  "quadraticCurveTo",
  "arc",
  "arcTo",
  "ellipse",
  "rect",
  "roundRect",
]);

/**
 * The calls whose arguments are needed whether or not the recorder is armed.
 *
 * The current path and the clip are shadowed for the whole life of the
 * recorder, because a build establishes both long before a caller arms
 * anything. Everything else the context does is an operation of a frame, and an
 * operation needs a frame open to belong to.
 */
const SHADOWED = new Set([...PATH_METHODS, "clip"]);

/**
 * The calls that leave the context under a different transform.
 *
 * The transform is read back rather than shadowed, but it is read on every path
 * operation — a path is given in user space, so each run of path operations
 * carries the transform it was issued under. Asking the context for it once per
 * `lineTo` would allocate a matrix per point of every path a build draws, so
 * the answer is held until one of these says it has moved.
 */
const TRANSFORM_METHODS = new Set([
  "setTransform",
  "resetTransform",
  "transform",
  "translate",
  "rotate",
  "scale",
  "restore",
  "reset",
]);

/**
 * The host types a canvas can draw from.
 *
 * Named rather than sniffed for a `width` and a `height`, because a plain
 * object with those fields is data a build passed by hand and belongs in the
 * recording as itself. A name a host does not define simply never matches.
 */
const BITMAP_SOURCES = [
  "HTMLImageElement",
  "SVGImageElement",
  "HTMLCanvasElement",
  "OffscreenCanvas",
  "ImageBitmap",
  "HTMLVideoElement",
  "VideoFrame",
] as const;

/**
 * The bitmap sources whose content changes under a running recording.
 *
 * These are captured at every use and shared on the bytes that came back. An
 * `ImageBitmap` is immutable and an `<img>` announces a change through its
 * `currentSrc`, but a canvas or a video frame that is repainted looks exactly
 * like the one that is not — and reusing an earlier capture for one is a
 * silently wrong picture, which is worse than the opaque marker it replaces.
 */
const MUTABLE_SOURCES = [
  "HTMLCanvasElement",
  "OffscreenCanvas",
  "HTMLVideoElement",
  "VideoFrame",
] as const;

/** Whether a value can be carried as-is, with no encoding at all. */
function isPrimitive(
  value: unknown,
): value is null | boolean | number | string {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

/**
 * The name to report for a value the recorder cannot carry.
 *
 * The constructor name rather than `typeof`, because every interesting case
 * here is an object and "object" tells a reader nothing about which one leaked.
 * A value with no constructor at all still yields a usable label.
 */
function opaqueName(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    const proto = Object.getPrototypeOf(value) as {
      constructor?: { name?: string };
    } | null;
    return proto?.constructor?.name ?? "object";
  } catch {
    // A proxy may refuse its prototype. The label is a courtesy to a reader
    // either way, and no label at all is better than a throw from inside a trap.
    return "object";
  }
}

/**
 * A number as the recording writes it.
 *
 * Non-finite values travel unchanged: `toPrecision` refuses them, and
 * `JSON.stringify` writes `null` for them either way, so rounding would only
 * add a way to fail.
 */
function round(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toPrecision(SIGNIFICANT_DIGITS));
}

/**
 * A value's JSON with object keys in a fixed order.
 *
 * The interning key, and it has to be stable against the order fields were
 * produced in: two operations that mean the same thing must be one entry
 * however the objects inside them were built. Sorting is done here rather than
 * by constructing every recorded object in a canonical order, because the
 * arguments a build passes are its own objects and their key order is its own
 * business.
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

/** A value's canonical form, or `null` when there is no building it. */
function fits(value: unknown): string | null {
  try {
    return canonical(value);
  } catch {
    // A build that assigns a hundred megabytes of string to a property is a
    // value whose canonical form the engine refuses to build: `Invalid string
    // length`, or a stack the recursion above ran out of.
    return null;
  }
}

/**
 * An entry the recording can carry, and the key it interns under.
 *
 * Only the part that cannot be written is given up. An entry whose canonical
 * form the engine refuses to build is rebuilt field by field, and whatever is
 * still too large is replaced by a marker — which a player reports, where the
 * alternative is an operation dropped from the frame with nothing said about
 * it.
 */
function shrink(value: unknown): { value: unknown; key: string } {
  const key = fits(value);
  if (key !== null) return { value, key };
  if (Array.isArray(value)) {
    const kept = value.map((entry) => shrink(entry).value);
    const shorter = fits(kept);
    if (shorter !== null) return { value: kept, key: shorter };
  } else if (value !== null && typeof value === "object") {
    const kept: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(value)) {
      Object.defineProperty(kept, name, {
        value: shrink(entry).value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    const shorter = fits(kept);
    if (shorter !== null) return { value: kept, key: shorter };
  }
  const marker = { $opaque: opaqueName(value) };
  return { value: marker, key: canonical(marker) };
}

/** Add `entry` to a shared table if it is new, and answer where it lives. */
function intern<T>(table: T[], index: Map<string, number>, entry: T): number {
  const { value, key } = shrink(entry);
  const found = index.get(key);
  if (found !== undefined) return found;
  const at = table.length;
  table.push(value as T);
  index.set(key, at);
  return at;
}

/** Whether `value` is an instance of a host constructor of this name, if one exists. */
function isHostInstance(value: object, name: string): boolean {
  const ctor = (globalThis as Record<string, unknown>)[name];
  if (typeof ctor !== "function") return false;
  try {
    return value instanceof (ctor as new (...args: never[]) => unknown);
  } catch {
    // A callable that is not a constructor throws on the right-hand side of
    // `instanceof`. A host that defines such a thing under one of these names
    // is not a host that has the type.
    return false;
  }
}

/**
 * The descriptor for a property, from wherever on the prototype chain it is
 * defined.
 *
 * `Object.getOwnPropertyDescriptor` answers only for the object it is handed,
 * and the accessors a canvas element carries for its backing store size live on
 * its prototype. Walking the chain is what lets the recorder install its own
 * pair in front of them and still forward to them.
 */
function describeProperty(
  subject: object,
  name: string,
): PropertyDescriptor | null {
  let level: object | null = subject;
  while (level !== null) {
    const found = Object.getOwnPropertyDescriptor(level, name);
    if (found !== undefined) return found;
    level = Object.getPrototypeOf(level) as object | null;
  }
  return null;
}

/**
 * The six numbers a matrix a context answered is worth, or `null` for anything
 * else.
 *
 * That is the `DOMMatrix2DInit` `setTransform` accepts, so a build that reads
 * its transform, changes it, and later puts the original back replays under the
 * transform it drew with. Carrying the matrix as a recipe instead would
 * re-issue `getTransform` against the player's canvas and answer whatever that
 * canvas held.
 */
function readMatrix(value: object): Readonly<Record<string, number>> | null {
  if (
    !isHostInstance(value, "DOMMatrixReadOnly") &&
    !isHostInstance(value, "DOMMatrix")
  ) {
    return null;
  }
  const matrix = value as DOMMatrixReadOnly;
  return {
    a: round(matrix.a),
    b: round(matrix.b),
    c: round(matrix.c),
    d: round(matrix.d),
    e: round(matrix.e),
    f: round(matrix.f),
  };
}

/**
 * The pixel size to capture a source at.
 *
 * The accessors are tried in the order that names the source's own resolution
 * before its layout size: an `<img>` sized down by CSS still holds the pixels
 * its file has, and capturing at the smaller figure would throw them away. A
 * source that reports no usable pair is not captured at all.
 */
function sourceSize(value: object): { width: number; height: number } | null {
  const fields = value as Record<string, unknown>;
  const pairs = [
    ["naturalWidth", "naturalHeight"],
    ["videoWidth", "videoHeight"],
    ["displayWidth", "displayHeight"],
    ["codedWidth", "codedHeight"],
    ["width", "height"],
  ] as const;
  for (const [wide, high] of pairs) {
    const width = fields[wide];
    const height = fields[high];
    if (typeof width !== "number" || typeof height !== "number") continue;
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (width < 1 || height < 1) continue;
    return { width: Math.floor(width), height: Math.floor(height) };
  }
  // An `<image>` inside an SVG document reports its size as an animated length
  // rather than as a number, and it is the one bitmap source that does.
  const wide = animatedLength(fields["width"]);
  const high = animatedLength(fields["height"]);
  if (wide === null || high === null || wide < 1 || high < 1) return null;
  return { width: Math.floor(wide), height: Math.floor(high) };
}

/** The number behind an SVG animated length, if this is one. */
function animatedLength(value: unknown): number | null {
  const length = (value as { baseVal?: { value?: unknown } } | undefined)
    ?.baseVal?.value;
  return typeof length === "number" && Number.isFinite(length) ? length : null;
}

/**
 * What a fixed source is recognized by, beyond being itself.
 *
 * An image element is an element that outlives what it is pointing at, so the
 * file and the size that file turned out to have are part of the identity: a
 * build that re-points one at another sprite sheet gets the new sheet captured,
 * and one whose image has not arrived yet is captured again once it has. An
 * `<img>` names the file in `currentSrc` and an `<image>` inside an SVG
 * document in `href.baseVal`, and reading only the first leaves a re-pointed
 * SVG image resolving to the bytes it used to hold.
 *
 * The size is the one the capture used rather than the element's natural size.
 * For an `<img>` the two are the same, because a capture reads an `<img>` at
 * its natural size. For an `<image>` in an SVG document they are not: it
 * reports no natural size at all and is captured at its layout size, so a
 * drawing that scales it up wants the pixels that larger box is worth rather
 * than the ones the first capture read.
 */
function identity(
  value: object,
  size: { width: number; height: number },
): string {
  const element = value as {
    currentSrc?: unknown;
    href?: { baseVal?: unknown };
  };
  const src = element.currentSrc ?? element.href?.baseVal;
  const named = typeof src === "string" ? src : "";
  return `${named}|${size.width}x${size.height}`;
}

/**
 * A pixel buffer as the recording carries it: its own bytes, base64 encoded.
 *
 * Not a PNG, because the canvas round trip a PNG needs is lossy — drawing an
 * image into a canvas premultiplies each colour channel by the pixel's alpha
 * and reading the pixels back un-premultiplies them, so a partially transparent
 * pixel is quantized to eight bits twice and comes back a different colour.
 * `ImageData` is the one kind of image a check compares byte for byte.
 *
 * A buffer whose bytes do not match its dimensions is refused rather than
 * carried short: a player rebuilds a `width × height` buffer from what it is
 * handed, and half a picture is a wrong picture.
 */
function readPixels(value: object): InlineImage | null {
  const buffer = value as { width?: unknown; height?: unknown; data?: unknown };
  const { width, height } = buffer;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    return null;
  const view = buffer.data;
  // `ArrayBuffer.isView` rather than `instanceof Uint8ClampedArray`, because an
  // `ImageData` handed over from another realm answers to neither this realm's
  // constructor nor its prototype.
  if (!ArrayBuffer.isView(view)) return null;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (bytes.length !== width * height * 4) return null;
  const data = base64(bytes);
  return data === null ? null : { kind: "pixels", width, height, data };
}

/**
 * Bytes as base64, through whichever of the two worlds this is.
 *
 * A browser has `btoa`, which takes a binary string; the chunking is what keeps
 * a multi-megapixel buffer from being spread as a million arguments.
 * In-process, where a validator runs, `Buffer` does it directly.
 */
function base64(bytes: Uint8Array): string | null {
  const host = globalThis as {
    btoa?: (binary: string) => string;
    Buffer?: {
      from(bytes: Uint8Array): { toString(encoding: string): string };
    };
  };
  try {
    if (typeof host.btoa === "function") {
      let binary = "";
      const chunk = 8192;
      for (let at = 0; at < bytes.length; at += chunk) {
        binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
      }
      return host.btoa(binary);
    }
    return host.Buffer === undefined
      ? null
      : host.Buffer.from(bytes).toString("base64");
  } catch {
    // A host with neither, or one that refuses the string: the buffer records
    // as a marker, which a player reports.
    return null;
  }
}

/** Whether two transforms a segment could carry are the same one. */
function sameTransform(
  left: readonly number[] | null,
  right: readonly number[] | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length &&
    left.every((entry, at) => entry === right[at])
  );
}

/**
 * A value resolved into a form the recording can hold, before it names a
 * table.
 *
 * The first of the two encoding stages. Everything that depends on *when* the
 * recorder saw the value is decided here — bytes are captured, a nested
 * produced value is snapshotted, numbers are rounded, and anything that cannot
 * be carried becomes a marker. What is left is the index a table entry lands
 * at, which only a running recording can say.
 */
type Portable =
  | null
  | boolean
  | number
  | string
  | readonly Portable[]
  | CapturedBytes
  | ProducedValue
  | { readonly [key: string]: Portable };

/** One resolved operation: a mutation of a produced value, or a path call. */
type PortableOp =
  | {
      readonly op: "call";
      readonly method: string;
      readonly args: readonly Portable[];
    }
  | { readonly op: "set"; readonly property: string; readonly value: Portable };

/**
 * The pixels of one source, read at the moment the recorder saw it.
 *
 * A class rather than a tagged object, because the tag would collide with a
 * field of the same name in an object the build assembled itself.
 */
class CapturedBytes {
  constructor(
    readonly image: CapturedImage,
    /** What to call the source if the recording cannot afford to hold it. */
    readonly name: string,
    /** What holding it costs, against {@link CAPTURE_BUDGET}. */
    readonly cost: number,
  ) {}
}

/**
 * A produced value as of the moment it was observed.
 *
 * The mutations are a snapshot rather than the recipe's own list, because the
 * list goes on growing: a gradient given a colour stop between two fills is two
 * resources, and each holds the stops that fill actually had.
 */
class ProducedValue {
  constructor(
    readonly method: string,
    readonly args: readonly Portable[],
    readonly then: readonly PortableOp[],
  ) {}
}

/**
 * A value the context produced, as it is being assembled.
 *
 * Collected from the moment the context makes the value and for as long as the
 * engine lives, because a build is free to create its gradients once at startup
 * and fill with them for the rest of its life — the case this whole format
 * exists to carry.
 *
 * The arguments are resolved at the producing call and the mutations as each
 * one is made, because both are answers to "what did this value hold at that
 * moment": `createPattern` copies its source when it is called, so a pattern
 * made from a scratch canvas keeps the picture that canvas carried then however
 * often the canvas is repainted afterwards.
 */
interface Recipe {
  readonly method: string;
  readonly args: readonly Portable[];
  readonly then: PortableOp[];
  /** What to call the value once its recipe can no longer be completed. */
  readonly name: string;
  /** Whether a mutation was dropped, past which the value is a marker rather than a recipe. */
  broken: boolean;
}

/** The canvas state as the recorder shadows it, before anything is encoded. */
interface ShadowState {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly transform: readonly number[] | null;
  readonly lineDash: readonly number[] | null;
  readonly clip: Shadow;
}

/** One run of path operations, and the transform they were issued under. */
interface ShadowSegment {
  readonly transform: readonly number[] | null;
  readonly ops: PortableOp[];
}

/**
 * A run of path operations the recorder keeps, and whether it is all of them.
 *
 * The count is carried rather than summed on demand, because it is consulted on
 * every path operation a build issues. The flag travels with the segments, so a
 * clip a `restore` puts back is as truncated as it was when it was saved, and a
 * whole structure is replaced rather than mutated, so an entry on the save
 * stack is not changed by what happens after it was saved.
 */
interface Shadow {
  readonly segments: ShadowSegment[];
  /** How many operations the segments hold, against {@link SHADOW_OPS}. */
  ops: number;
  /** Whether an operation was refused because the bound was reached. */
  truncated: boolean;
}

/** A run of path operations with nothing in it yet. */
function emptyShadow(): Shadow {
  return { segments: [], ops: 0, truncated: false };
}

/**
 * One entry of the save stack.
 *
 * The canvas state, and what the recorder had last said about each style
 * property holding a produced value. A `restore` puts back a reference rather
 * than a copy, so the player's context returns to the encoding that was in
 * force at the `save` and the recorder has to be looking at the same figure to
 * know when it has gone stale.
 */
interface Saved {
  readonly state: ShadowState;
  readonly emitted: Map<string, Emission> | null;
}

/** The encoding the recording last stated for one style property. */
interface Emission {
  /** The produced value the property holds. */
  readonly subject: object;
  readonly recipe: Recipe;
  /** How far along the recipe was when the encoding was written. */
  readonly steps: number;
  /** Whether the recipe was already past rebuilding when it was written. */
  readonly broken: boolean;
}

/** Where a fixed source was captured to, and under what identity. */
interface Captured {
  readonly key: string;
  readonly image: InlineImage;
}

/**
 * One walk over a value the build supplied.
 *
 * `seen` is the path currently being followed, so a cycle is caught and a value
 * that simply appears twice is not. `memo` is everything already resolved, so a
 * shared substructure is resolved once however many paths reach it, and `spent`
 * is how many values the walk has expanded into against {@link ENCODE_NODES} —
 * which a memo hit adds to, because the recording writes the sharing out in
 * full.
 */
interface Walk {
  readonly seen: Set<object>;
  readonly memo: Map<
    object,
    { readonly value: Portable; readonly size: number }
  >;
  spent: number;
}

/** The resolved arguments of a call nothing is going to hold. */
const NO_ARGS: readonly Portable[] = [];

/** A frame's stack entries carry no path: the path is outside the saved state. */
const NO_PATH: Shadow = { segments: [], ops: 0, truncated: false };

/**
 * The wrapper over the pipeline's 2D context, and the recorder behind it: one
 * instance per engine, armed and disarmed by its owner.
 *
 * It wraps the engine's context once, at construction, and hands out that
 * wrapper for the engine's whole life. A wrapper installed only while recording
 * would be a different object from the one a game may have held on to from an
 * earlier frame, and the game would keep drawing through the unwrapped context
 * it captured — so the identity is stable and the arming is a flag inside it.
 *
 * While disarmed the wrapper forwards, keeps each produced value's recipe, and
 * shadows the state a context will not report; it collects no frames and
 * interns nothing, because a table index is only meaningful inside a running
 * recording.
 *
 * Internal: the engine alone constructs it, once, over the raw context the
 * canvas yielded; `engine.startRecording` / `stopRecording` / `recording()` are
 * the public face.
 */
export class ContextRecorder {
  /** The wrapper the engine draws through and hands to the game. */
  private readonly wrapper: CanvasRenderingContext2D;

  private readonly target: CanvasRenderingContext2D;

  /**
   * Method wrappers, cached by property name.
   *
   * A trap that built a fresh closure per read would allocate one for every
   * draw call of every frame, which for a game issuing a few hundred operations
   * at sixty frames a second is tens of thousands of closures a second thrown
   * away. The wrapper for a given name never varies, so it is built once.
   */
  private readonly methods = new Map<string, (...args: unknown[]) => unknown>();

  /** Wrappers for values the context produced, so mutations of them are recorded. */
  private readonly wrappers = new WeakMap<object, object>();

  /** The inverse of {@link wrappers}: a wrapper to the object it stands for. */
  private readonly unwrapped = new WeakMap<object, object>();

  /**
   * The recipe of each value the context produced, keyed on the value itself.
   *
   * Never rebuilt. A gradient made before the recorder was ever armed is the
   * case the format exists for, and a recipe reset at arming would record every
   * fill with it as opaque — so a recipe holds resolved values and is interned
   * into whichever recording is running when the value is used.
   */
  private readonly recipes = new WeakMap<object, Recipe>();

  /** Where each fixed bitmap source was captured to, and under what identity. */
  private fixedImages = new WeakMap<object, Captured>();

  /**
   * Where one set of captured bytes landed in this recording's table.
   *
   * A sprite sheet is one capture and hundreds of uses a frame, and interning
   * is keyed on canonical JSON — which for a captured image is the whole data
   * URL. The bytes that came back from one capture are one object, however many
   * uses resolve to it, so where they landed is remembered against that object
   * rather than rebuilt from megabytes of string every time something draws it.
   */
  private placed = new WeakMap<CapturedImage, number>();

  /** The image bytes this recording holds, against {@link CAPTURE_BUDGET}. */
  private captured = 0;

  /**
   * The context images are captured through: absent until asked for, `null`
   * once asked for and unavailable.
   */
  private scratch: CanvasRenderingContext2D | null | undefined;

  private images: CapturedImage[] = [];
  private resources: Resource[] = [];
  private operations: DrawOp[] = [];
  private states: DrawState[] = [];

  private imageIndex = new Map<string, number>();
  private resourceIndex = new Map<string, number>();
  private operationIndex = new Map<string, number>();
  private stateIndex = new Map<string, number>();

  /** The states the context has saved, outermost first. */
  private saved: Saved[] = [];

  /**
   * Whether the save stack is missing entries the bound dropped.
   *
   * Cleared only by a reset of the context, which empties the stack outright. A
   * build that overflowed the bound and then restored back out of it is no
   * longer missing anything, and the recorder cannot tell that from a build
   * still inside the entries it dropped — so every frame from the overflow to
   * the next reset says it was cut down, which over-reports where the
   * alternative under-reports.
   */
  private stackTruncated = false;

  /** The clip in force, as the segments that built it. */
  private clip: Shadow = emptyShadow();

  /** The path operations issued since the last `beginPath`, by transform. */
  private path: Shadow = emptyShadow();

  /** What the recording last said each style property holds, for the produced ones. */
  private emitted = new Map<string, Emission>();

  /** The transform in force, or `undefined` when a call may have moved it. */
  private transform: readonly number[] | null | undefined;

  /** The backing store the shadowed state describes, or `null` before the first read. */
  private surface: { width: number; height: number } | null = null;

  /** The frames closed so far, or `null` while the recorder is disarmed. */
  private frames: RecordedFrame[] | null = null;

  /** The operations of the frame in progress, by index, or `null` between frames. */
  private pending: number[] | null = null;

  /** The state the open frame inherited, captured when the frame opened. */
  private pendingState: DrawState | null = null;

  /** The states saved under the open frame, captured when the frame opened. */
  private pendingStack: DrawState[] | null = null;

  /** Whether anything the open frame inherited was cut down to a bound. */
  private pendingTruncated = false;

  /** What the recording says it was drawn at, fixed when the recorder is armed. */
  private design: RecorderStartOptions = {
    width: 0,
    height: 0,
    background: null,
  };

  constructor(raw: CanvasRenderingContext2D) {
    this.target = raw;
    // The wrapper is built here even while disarmed, so a game that holds on to
    // the context it was handed on its first frame keeps drawing through the
    // object the recorder watches.
    this.wrapper = this.wrap(raw, false) as CanvasRenderingContext2D;
    this.watch();
  }

  /**
   * The context the pipeline (and a `DrawComponent`) draws through: the
   * recorder's wrapper, built once and never swapped.
   */
  get context(): CanvasRenderingContext2D {
    return this.wrapper;
  }

  /** Whether operations are being captured. */
  get active(): boolean {
    return this.frames !== null;
  }

  /**
   * Arms the recorder. Capture begins at the next frame.
   *
   * The design size and background are taken here rather than read back from
   * the canvas later, because a recording states the coordinate system its
   * operations were issued in and that is the engine's fixed logical size, not
   * whatever the element happens to be sized to when the recording is closed.
   * The engine refuses an unbalanced call before reaching this.
   *
   * What the recorder shadows — the recipes, the save stack, the clip, the
   * path — is not touched: it describes the context as it stands, which arming
   * does not change.
   */
  start(options: RecorderStartOptions): void {
    this.design = { ...options };
    this.frames = [];
    this.pending = null;
    this.pendingState = null;
    this.pendingStack = null;
    this.pendingTruncated = false;
    this.resetTables();
  }

  /**
   * Disarms the recorder and returns everything captured since {@link start},
   * with the shared tables settled from the frames it holds. A frame still open
   * is dropped.
   */
  stop(): Recording {
    const tables = this.retable(this.frames ?? []);
    const recording: Recording = {
      format: RECORDING_FORMAT,
      width: this.design.width,
      height: this.design.height,
      background: this.design.background,
      images: tables.images,
      resources: tables.resources,
      ops: tables.operations,
      states: tables.states,
      frames: tables.frames,
    };
    this.frames = null;
    this.pending = null;
    this.pendingState = null;
    this.pendingStack = null;
    this.pendingTruncated = false;
    this.resetTables();
    return recording;
  }

  /**
   * The frames re-expressed against tables holding only what those frames
   * name.
   *
   * An operation is interned when it is recorded and a frame may lose it
   * afterwards. A canvas wiped part-way through a frame erases the pixels the
   * operations before it drew, so {@link wiped} drops them from the frame — and
   * what they interned into `ops`, `resources` and `images` stays behind, named
   * by nothing. `Recording.ops` states every distinct operation the recording
   * holds, so the tables are built from the frames rather than the frames from
   * the tables: the close is the first moment at which what a frame holds is
   * settled.
   *
   * Every entry here is reached from a frame, and every reference inside one is
   * rewritten as it is reached, transitively: a frame names its own state and
   * the states saved under it, whose style properties and clip and path
   * segments name operations and resources, whose own creating calls may name
   * images. So every index a frame carries addresses the table it was written
   * into, and a document cannot name an entry it does not hold.
   *
   * An entry is deduplicated on the index it came from rather than on its
   * content. The table it is read out of was interned on the way in, so no two
   * of its entries are equal, and a rewrite that sends distinct indices to
   * distinct indices leaves them distinct — the two dedups agree entry for
   * entry and in the same order.
   */
  private retable(frames: readonly RecordedFrame[]): {
    images: CapturedImage[];
    resources: Resource[];
    operations: DrawOp[];
    states: DrawState[];
    frames: RecordedFrame[];
  } {
    const images: CapturedImage[] = [];
    const imageAt = new Map<number, number>();
    const resources: Resource[] = [];
    const resourceAt = new Map<number, number>();
    const operations: DrawOp[] = [];
    const operationAt = new Map<number, number>();
    const states: DrawState[] = [];
    const stateAt = new Map<number, number>();

    /**
     * The entry an index names, which is always one this recorder wrote.
     *
     * Every index followed here came back from {@link intern} against the very
     * table it is read out of, so a miss is a broken recorder rather than a
     * damaged document. Saying so is better than carrying a marker in its
     * place: a recording that quietly replaced an operation with a marker would
     * report a picture the format could not carry when what happened is that
     * the format lost track of it.
     */
    const entryAt = <T>(
      table: readonly T[],
      source: number,
      kind: string,
    ): T => {
      const entry = table[source];
      if (entry === undefined) {
        throw new Error(
          `recording ${kind} index ${source} names no entry: the recorder's tables and its frames disagree`,
        );
      }
      return entry;
    };

    const takeImage = (source: number): number => {
      const found = imageAt.get(source);
      if (found !== undefined) return found;
      const at = images.length;
      images.push(entryAt(this.images, source, "image"));
      imageAt.set(source, at);
      return at;
    };

    const takeResource = (source: number): number => {
      const found = resourceAt.get(source);
      if (found !== undefined) return found;
      const recipe = entryAt(this.resources, source, "resource");
      // A recipe's arguments were encoded when the value was used, so they can
      // only name entries interned before it: rewriting one terminates and
      // cannot re-enter this resource. The entry is written to the table only
      // once it is whole, and its index taken after the entries it names, which
      // is the order every other reachable entry is written in.
      const rebuilt: Resource = {
        make: {
          method: recipe.make.method,
          args: recipe.make.args.map(value),
        },
        then: recipe.then.map(operation),
      };
      const at = resources.length;
      resources.push(rebuilt);
      resourceAt.set(source, at);
      return at;
    };

    const value = (entry: DrawValue): DrawValue => {
      if (entry === null || typeof entry !== "object") return entry;
      if (Array.isArray(entry)) return entry.map(value);
      const record = entry as Readonly<Record<string, DrawValue>>;
      const image = record["$img"];
      if (typeof image === "number") return { $img: takeImage(image) };
      const resource = record["$res"];
      if (typeof resource === "number") return { $res: takeResource(resource) };
      const rewritten: Record<string, DrawValue> = {};
      for (const [key, held] of Object.entries(record)) {
        // Defined rather than assigned, because a build's own object may carry
        // a field named `__proto__`: assigning that name reaches the prototype
        // setter instead of writing the field the document already carries.
        Object.defineProperty(rewritten, key, {
          value: value(held),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return rewritten;
    };

    const operation = (op: DrawOp): DrawOp =>
      op.op === "call"
        ? { op: "call", method: op.method, args: op.args.map(value) }
        : { op: "set", property: op.property, value: value(op.value) };

    const segments = (list: readonly PathSegment[]): PathSegment[] =>
      list.map((segment) => ({
        transform: segment.transform,
        ops: segment.ops.map(operation),
      }));

    const stateOf = (state: DrawState): DrawState => {
      const properties: Record<string, DrawValue> = {};
      for (const [name, held] of Object.entries(state.properties)) {
        Object.defineProperty(properties, name, {
          value: value(held),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return {
        properties,
        transform: state.transform,
        lineDash: state.lineDash,
        clip: segments(state.clip),
        path: segments(state.path),
      };
    };

    const takeState = (source: number): number => {
      const found = stateAt.get(source);
      if (found !== undefined) return found;
      const rebuilt = stateOf(entryAt(this.states, source, "state"));
      const at = states.length;
      states.push(rebuilt);
      stateAt.set(source, at);
      return at;
    };

    const takeOp = (source: number): number => {
      const found = operationAt.get(source);
      if (found !== undefined) return found;
      const rebuilt = operation(entryAt(this.operations, source, "operation"));
      const at = operations.length;
      operations.push(rebuilt);
      operationAt.set(source, at);
      return at;
    };

    return {
      images,
      resources,
      operations,
      states,
      // The state a frame inherited before the states saved under it, and both
      // before the frame's own operations, so the tables are ordered as a
      // reader walks them.
      frames: frames.map((frame) => ({
        ...frame,
        state: takeState(frame.state),
        stack: frame.stack.map(takeState),
        ops: frame.ops.map(takeOp),
      })),
    };
  }

  /**
   * Empty tables, and nothing that names an entry in one.
   *
   * Called on the way in and on the way out, because the caller owns the
   * recording it was handed: a table this recorder went on writing into would
   * be a document changing under its reader, and an index kept from it would
   * name an entry the next recording does not have.
   */
  private resetTables(): void {
    this.images = [];
    this.resources = [];
    this.operations = [];
    this.states = [];
    this.imageIndex = new Map();
    this.resourceIndex = new Map();
    this.operationIndex = new Map();
    this.stateIndex = new Map();
    this.fixedImages = new WeakMap();
    this.placed = new WeakMap();
    this.captured = 0;
  }

  /**
   * Opens a frame's bracket, before the engine's frame preparation.
   *
   * The state snapshot is taken here, before the frame's first operation, so it
   * is the state the frame *inherited*. Taking it after the frame's own sets
   * would record the state the frame left behind, and replaying a frame from
   * that would draw its first operations under its last operation's style. The
   * states saved under it are taken at the same moment and for the same reason:
   * a `restore` among the frame's operations pops to one of them.
   */
  beginFrame(): void {
    if (this.frames === null) return;
    this.checkSurface();
    this.pending = [];
    this.snapshot();
  }

  /**
   * Take the state the open frame inherits, and the states saved under it.
   *
   * Taken again whenever the context is reset inside the frame, because the
   * operations recorded before the reset go with it: what is left of the frame
   * inherits the state the reset left rather than the one it discarded. The
   * engine's own frame preparation resizes the backing store from inside the
   * frame bracket, so this is reachable in the code that exists today.
   */
  private snapshot(): void {
    this.pendingStack = this.saved.map((entry) =>
      this.encodeState(entry.state, NO_PATH),
    );
    const own = this.readState();
    this.pendingState = this.encodeState(own, this.path);
    // Everything the frame inherits, against the bounds each of the three
    // shadows carries. A frame that inherits a state the recorder could only
    // keep part of replays under a state close to the build's rather than equal
    // to it, and a reviewer has to be told that rather than left to compare
    // pixels.
    this.pendingTruncated =
      this.stackTruncated ||
      this.path.truncated ||
      own.clip.truncated ||
      this.saved.some((entry) => entry.state.clip.truncated);
    // The snapshot is itself an encoding of every produced value the state
    // holds, so it is what the frame's first paint is measured against.
    this.emitted = this.emissions(own.properties);
  }

  /**
   * Closes the frame's bracket, after the pipeline (and the collision overlay)
   * and before the diagnostics overlay.
   *
   * A frame that opened while the recorder was armed and closes after it was
   * disarmed is dropped rather than kept: the recording it would have joined
   * has already been handed to its caller, and a half-frame appended to nothing
   * is a frame no reader could ask for.
   */
  endFrame(
    info: Pick<FrameInfo, "count" | "timeMs"> & { deltaMs: number },
    surface: { width: number; height: number },
  ): void {
    const frames = this.frames;
    const ops = this.pending;
    const state = this.pendingState;
    const stack = this.pendingStack;
    const truncated = this.pendingTruncated;
    this.pending = null;
    this.pendingState = null;
    this.pendingStack = null;
    this.pendingTruncated = false;
    if (frames === null || ops === null || state === null || stack === null)
      return;
    frames.push({
      count: info.count,
      timeMs: info.timeMs,
      deltaMs: info.deltaMs,
      surface: { width: surface.width, height: surface.height },
      state: intern(this.states, this.stateIndex, state),
      stack: stack.map((entry) => intern(this.states, this.stateIndex, entry)),
      ops,
      // Written only where something was in fact cut down. The flag names an
      // exceptional frame, and `false` on every frame of a fifty-thousand-frame
      // recording is bytes spent saying nothing.
      ...(truncated ? { truncated: true } : {}),
    });
  }

  /**
   * The canvas state as it stands, read defensively.
   *
   * Every read is guarded because the set of properties a context carries is
   * not the same everywhere: a native canvas used by a validator implements
   * most of this list and not all of it, and a browser adds to it over time. A
   * property that is absent, or that throws on read, is omitted — a replay that
   * restores one property fewer draws a slightly different frame, while a
   * recorder that threw here would take the whole run down over a property
   * nobody used.
   *
   * The values are the context's own, held rather than resolved, because a
   * style property holds a live reference: what a gradient in one paints is
   * settled when the state is encoded, not when it was read.
   */
  private readState(): ShadowState {
    const target = this.target as unknown as Record<string, unknown>;
    const properties: Record<string, unknown> = {};
    for (const name of STATE_PROPERTIES) {
      try {
        const value = target[name];
        if (value === undefined) continue;
        properties[name] = value;
      } catch {
        // A context that refuses to report a property it nominally has is
        // telling us the property is not usable; leaving it out is the same
        // outcome a context that never had it produces.
      }
    }

    let lineDash: readonly number[] | null = null;
    try {
      lineDash = [...this.target.getLineDash()];
    } catch {
      // Absent means "no dash pattern to restore".
    }

    return {
      properties,
      transform: this.readTransform(),
      lineDash,
      clip: this.clip,
    };
  }

  /**
   * The transform in force, or `null` from a context that cannot report one.
   *
   * `getTransform` is the one accessor a very old context may lack. Without it
   * a frame relies on the transform its own operations establish, which for an
   * engine-drawn frame is every frame: the pipeline sets the transform before
   * anything draws.
   *
   * Held until a call moves it, because every path operation asks for it and a
   * context answers with a freshly allocated matrix.
   */
  private readTransform(): readonly number[] | null {
    if (this.transform !== undefined) return this.transform;
    try {
      const matrix = this.target.getTransform();
      this.transform = [
        matrix.a,
        matrix.b,
        matrix.c,
        matrix.d,
        matrix.e,
        matrix.f,
      ];
    } catch {
      this.transform = null;
    }
    return this.transform;
  }

  /**
   * Watch the canvas element for the write that resets the context.
   *
   * `canvas.width = canvas.width` is the ordinary way a build clears its
   * surface, and it resets the context completely — transform, properties,
   * dash, clip, current path, save stack — while leaving the size exactly where
   * it was. A comparison of sizes cannot see that at all, so the recorder would
   * go on describing a context that no longer exists and every following frame
   * would inherit it.
   *
   * The element is therefore given its own `width` and `height`, each
   * forwarding to the accessor it inherits and telling the recorder afterwards.
   * Whatever the new size, the reset is seen where it happened.
   *
   * A canvas the accessors cannot be installed on — one carrying its dimensions
   * as plain fields, one that refuses a property definition, a context that
   * will not say what it draws into — is left alone and falls back to
   * {@link checkSurface}. Nothing here may throw: this runs at construction,
   * and a recorder that failed here would take down an engine that had not
   * asked to record anything.
   */
  private watch(): void {
    try {
      const canvas = (this.target as unknown as { canvas?: unknown }).canvas;
      if (canvas === null || typeof canvas !== "object") return;
      for (const name of ["width", "height"] as const) {
        const inherited = describeProperty(canvas, name);
        if (
          inherited === null ||
          typeof inherited.get !== "function" ||
          typeof inherited.set !== "function"
        ) {
          continue;
        }
        const read = inherited.get;
        const write = inherited.set;
        Object.defineProperty(canvas, name, {
          configurable: true,
          enumerable: inherited.enumerable ?? true,
          get: (): unknown => read.call(canvas),
          set: (value: unknown): void => {
            write.call(canvas, value);
            this.wiped();
          },
        });
      }
    } catch {
      // The size comparison is what is left. It sees every reset but the one
      // that keeps the size, which is better than a recorder that refused to be
      // built.
    }
  }

  /**
   * Notice a canvas resize the accessors did not announce.
   *
   * The fallback for a canvas {@link watch} could not install itself on. The
   * backing store size is read before each shadowed operation and before each
   * state snapshot, and a size that differs from the one last seen is a context
   * that was reset between the two.
   */
  private checkSurface(): void {
    let size: { width: number; height: number } | null = null;
    try {
      const canvas = (
        this.target as unknown as { canvas?: Record<string, unknown> }
      ).canvas;
      const width = canvas?.["width"];
      const height = canvas?.["height"];
      if (typeof width === "number" && typeof height === "number")
        size = { width, height };
    } catch {
      // A context that will not say what it draws into says nothing about a
      // reset either, and guessing one would throw away a clip that is still in
      // force.
      return;
    }
    if (size === null) return;
    const last = this.surface;
    this.surface = size;
    if (
      last === null ||
      (last.width === size.width && last.height === size.height)
    )
      return;
    this.wiped();
    this.surface = size;
  }

  /**
   * Give up everything the recorder shadows: the context it described is gone.
   *
   * A canvas reset returns the transform to the identity and the properties to
   * their defaults, and discards the clip, the current path and the save stack.
   * What the context still reports corrects itself on the next read; the three
   * write-only shadows have to be dropped here.
   *
   * A reset **during** a frame also invalidates the operations that frame has
   * already recorded: the wipe erased the pixels they drew, and replaying them
   * would paint those pixels back over a frame that never had them. They are
   * dropped and the inherited state is taken again, so what the frame says is
   * what it draws. What they interned goes with them at the close, where
   * {@link retable} settles the tables from the frames that are left.
   */
  private wiped(): void {
    this.saved = [];
    this.stackTruncated = false;
    this.clip = emptyShadow();
    this.path = emptyShadow();
    this.emitted = new Map();
    this.transform = undefined;
    // The size comparison is the fallback for a canvas the accessors could not
    // be installed on. A reset that announced itself is dealt with here, so the
    // size last seen is forgotten rather than compared against and dealt with
    // twice.
    this.surface = null;
    if (this.pending === null) return;
    this.pending.length = 0;
    this.snapshot();
  }

  /** A shadowed state, and the path in force, as the recording writes them. */
  private encodeState(shadow: ShadowState, path: Shadow): DrawState {
    const properties: Record<string, DrawValue> = {};
    for (const [name, value] of Object.entries(shadow.properties)) {
      properties[name] = this.encode(value);
    }
    return {
      properties,
      transform: shadow.transform === null ? null : shadow.transform.map(round),
      lineDash: shadow.lineDash === null ? null : shadow.lineDash.map(round),
      clip: shadow.clip.segments.map((segment) => this.encodeSegment(segment)),
      path: path.segments.map((segment) => this.encodeSegment(segment)),
    };
  }

  /** One run of path operations as the recording writes it. */
  private encodeSegment(segment: ShadowSegment): PathSegment {
    return {
      transform:
        segment.transform === null ? null : segment.transform.map(round),
      ops: segment.ops.map((op) => this.carryOp(op)),
    };
  }

  /**
   * What the recording last said about each style property holding a produced
   * value.
   *
   * Rebuilt from a state snapshot, because encoding that snapshot is what
   * stated it.
   */
  private emissions(
    properties: Readonly<Record<string, unknown>>,
  ): Map<string, Emission> {
    const emitted = new Map<string, Emission>();
    for (const [name, value] of Object.entries(properties)) {
      const recipe =
        value !== null && typeof value === "object"
          ? this.recipes.get(value)
          : undefined;
      if (recipe === undefined) continue;
      emitted.set(name, {
        subject: value as object,
        recipe,
        steps: recipe.then.length,
        broken: recipe.broken,
      });
    }
    return emitted;
  }

  /**
   * Re-state any style property whose produced value has moved on since it was
   * set.
   *
   * A canvas style property holds a live reference, so a gradient given another
   * colour stop after it was assigned paints under that stop without ever being
   * assigned again — and a recording that said what the assignment said would
   * paint the frame under stops the build had already left behind, with nothing
   * reported. The corrective assignment goes in front of the painting
   * operation, so what the frame holds is what the context is about to paint.
   */
  private correct(): void {
    if (this.pending === null) return;
    for (const [property, mark] of this.emitted) {
      if (
        mark.steps === mark.recipe.then.length &&
        mark.broken === mark.recipe.broken
      )
        continue;
      this.push({
        op: "set",
        property,
        value: this.resolveValue(mark.subject),
      });
      this.emitted.set(property, {
        ...mark,
        steps: mark.recipe.then.length,
        broken: mark.recipe.broken,
      });
    }
  }

  /** A value the recorder saw and used at the same moment: resolved, then interned. */
  private encode(value: unknown): DrawValue {
    return this.carry(this.resolveValue(value));
  }

  /**
   * One value the build supplied, resolved, with the guard the traps rely on.
   *
   * {@link resolve} degrades rather than throwing at every point it can reach,
   * and this is the outer promise that it did: a value the recorder failed to
   * resolve at all still records as a marker, so the operation carrying it is
   * written and reported rather than dropped with nothing said.
   */
  private resolveValue(value: unknown): Portable {
    try {
      return this.resolve(value, 0);
    } catch {
      return { $opaque: opaqueName(value) };
    }
  }

  /**
   * The arguments of one call, resolved before the call is made.
   *
   * Before, because a call may change what its own argument holds:
   * `ctx.drawImage(ctx.canvas, …)` is the ordinary trails blit, and capturing
   * its source afterwards would record the surface as the blit left it — a
   * replay that composites the result on top of itself.
   */
  private resolveArgs(args: readonly unknown[]): readonly Portable[] {
    return args.map((arg) => this.resolveValue(arg));
  }

  /**
   * Whether anything is going to hold the resolved arguments of this call.
   *
   * Resolving is not free — a bitmap argument is read out as pixels, which for
   * a full-screen surface is a PNG encode — so it is done only where the answer
   * is kept. A mutation of a produced value and the four producing calls are
   * collected whether or not the recorder is armed, and so are the path and the
   * clip; everything else is an operation of a frame, and a blit issued while
   * nothing is recording pays nothing for it.
   */
  private resolving(resource: boolean, method: string): boolean {
    return (
      resource ||
      PRODUCERS.has(method) ||
      SHADOWED.has(method) ||
      this.pending !== null
    );
  }

  /** One resolved operation as the recording writes it. */
  private carryOp(op: PortableOp): DrawOp {
    return op.op === "call"
      ? {
          op: "call",
          method: op.method,
          args: op.args.map((arg) => this.carry(arg)),
        }
      : { op: "set", property: op.property, value: this.carry(op.value) };
  }

  /**
   * Resolve one value the build supplied into a form the recording can hold.
   *
   * The first encoding stage, and the one that has to happen at the moment the
   * recorder sees the value: a bitmap source is read here because the build may
   * repaint it afterwards, and a produced value is snapshotted here because it
   * goes on being mutated. Plain data is carried as itself, with every number
   * rounded.
   *
   * The value belongs to the build, so this is total by construction. A cycle,
   * a getter that throws and a structure nested past {@link ENCODE_DEPTH} each
   * resolve to a marker, because the pixels a build draws must be the same
   * whether or not anything is being captured.
   */
  private resolve(value: unknown, depth: number, walk?: Walk): Portable {
    // Counted here, where every value inside a walk passes: the bound is on
    // what the recording is asked to write out, and a million numbers cost what
    // a million objects do once they are JSON.
    if (walk !== undefined) walk.spent += 1;
    if (typeof value === "number") return round(value);
    if (isPrimitive(value)) return value;
    if (typeof value !== "object") return { $opaque: opaqueName(value) };

    // A wrapper nested inside a value the build assembled stands for the object
    // it wraps, which is what a recipe is keyed on. The arguments of a call are
    // already unwrapped on their way to the context; anything inside one is
    // not.
    const subject = this.unwrap(value) as object;

    // Only the four producing calls hold a recipe, so a pixel buffer whose
    // capture fails can never fall through to one: it degrades to a marker like
    // any other value, rather than replaying as a read against the player's own
    // canvas.
    const recipe = this.recipes.get(subject);
    if (recipe !== undefined) return this.produced(recipe);

    const matrix = readMatrix(subject);
    if (matrix !== null) return matrix;

    const image = this.image(subject);
    if (image !== null) return image;

    return this.resolveData(subject, depth, walk);
  }

  /**
   * An array or a plain object, field by field, or a marker for anything else.
   *
   * This is what keeps the answers to `getLineDash` and `getContextAttributes`
   * out of the resource table. Anything with a prototype of its own is a host
   * object, and its fields would not reconstruct it.
   *
   * A node is resolved once per walk and shared from there. The guard against a
   * cycle has to be the path currently being walked rather than everything
   * seen, and without the memo beside it a value that reaches the same node
   * down twenty different paths is expanded two to the twentieth times.
   */
  private resolveData(value: object, depth: number, walk?: Walk): Portable {
    let proto: object | null = null;
    try {
      proto = Object.getPrototypeOf(value) as object | null;
    } catch {
      return { $opaque: opaqueName(value) };
    }
    const array = Array.isArray(value);
    if (!array && proto !== Object.prototype && proto !== null) {
      return { $opaque: opaqueName(value) };
    }
    if (depth >= ENCODE_DEPTH) return { $opaque: opaqueName(value) };
    const scope = walk ?? {
      seen: new Set<object>(),
      memo: new Map(),
      spent: 0,
    };
    // The path first, so what is asked of the memo is only ever a node that
    // finished: a node still being walked is a cycle, and one that finished is
    // sharing.
    if (scope.seen.has(value)) return { $opaque: opaqueName(value) };
    const done = scope.memo.get(value);
    if (done !== undefined) {
      // Resolved once, written out in full every time: what it expands into is
      // charged again, so a graph pays what the document it produces costs.
      scope.spent += done.size;
      return done.value;
    }
    scope.seen.add(value);
    const before = scope.spent;
    try {
      let resolved: Portable;
      if (array) {
        const entries: Portable[] = [];
        for (const entry of value as unknown[]) {
          // One marker for the whole remainder rather than one per element
          // refused.
          if (scope.spent >= ENCODE_NODES) {
            entries.push({ $opaque: REMAINDER });
            break;
          }
          entries.push(this.resolve(entry, depth + 1, scope));
        }
        resolved = entries;
      } else {
        const fields: Record<string, Portable> = {};
        // The names first and each value as it is reached, rather than
        // `Object.entries`, so a field past the bound is one the build's own
        // getter is never asked for: the bound is on the work as much as on the
        // document.
        for (const key of Object.keys(value)) {
          if (scope.spent >= ENCODE_NODES) {
            Object.defineProperty(fields, REMAINDER_KEY, {
              value: { $opaque: REMAINDER },
              enumerable: true,
              writable: true,
              configurable: true,
            });
            break;
          }
          const entry = (value as Record<string, unknown>)[key];
          // Defined rather than assigned, because a build's own object may
          // carry a field named `__proto__` and assigning that name reaches the
          // prototype setter instead of writing a field the recording would
          // carry.
          Object.defineProperty(fields, key, {
            value: this.resolve(entry, depth + 1, scope),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        resolved = fields;
      }
      scope.memo.set(value, {
        value: resolved,
        size: scope.spent - before + 1,
      });
      return resolved;
    } catch {
      // A getter that throws is a value the build can supply and a bare context
      // ignores; the marker says so, and the operation carrying it still
      // records.
      return { $opaque: opaqueName(value) };
    } finally {
      // Removed on the way out, so the guard catches a cycle and not a value
      // that simply appears twice under different fields.
      scope.seen.delete(value);
    }
  }

  /** A produced value as of now: its recipe so far, or a marker for one past rebuilding. */
  private produced(recipe: Recipe): Portable {
    if (recipe.broken) return { $opaque: recipe.name };
    return new ProducedValue(recipe.method, recipe.args, [...recipe.then]);
  }

  /**
   * Intern a resolved value into the running recording's tables.
   *
   * The second encoding stage. Everything here is a lookup: captured bytes and
   * recipes become the indices of the entries they were interned at, and plain
   * data passes through as itself.
   */
  private carry(value: Portable): DrawValue {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof CapturedBytes) return this.carryImage(value);
    if (value instanceof ProducedValue) return this.carryResource(value);
    if (Array.isArray(value)) return value.map((entry) => this.carry(entry));
    const fields: Record<string, DrawValue> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, Portable>,
    )) {
      Object.defineProperty(fields, key, {
        value: this.carry(entry),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return fields;
  }

  /**
   * One set of captured bytes in the image table, at the index it shares with
   * equal bytes.
   *
   * The budget is checked after the lookup, so a recording that has stopped
   * capturing keeps resolving every set of bytes it already holds: a canvas
   * repainted back to a picture the table has costs nothing and resolves, where
   * checking first would degrade an image the document already carries.
   */
  private carryImage(bytes: CapturedBytes): DrawValue {
    const placed = this.placed.get(bytes.image);
    if (placed !== undefined) return { $img: placed };
    const { value, key } = shrink(bytes.image);
    const found = this.imageIndex.get(key);
    if (found !== undefined) {
      this.placed.set(bytes.image, found);
      return { $img: found };
    }
    if (this.captured >= CAPTURE_BUDGET) return { $opaque: bytes.name };
    const at = this.images.length;
    this.images.push(value as CapturedImage);
    this.imageIndex.set(key, at);
    this.placed.set(bytes.image, at);
    this.captured += bytes.cost;
    return { $img: at };
  }

  /** One produced value in the resource table, as the recipe that rebuilds it. */
  private carryResource(produced: ProducedValue): DrawValue {
    const entry: Resource = {
      make: {
        method: produced.method,
        args: produced.args.map((arg) => this.carry(arg)),
      },
      then: produced.then.map((op) => this.carryOp(op)),
    };
    return { $res: intern(this.resources, this.resourceIndex, entry) };
  }

  /**
   * Record an operation the context performed on itself.
   *
   * An operation needs a frame open to belong to, and is dropped otherwise. The
   * interning happens here rather than at the call site so that a dropped
   * operation costs none of it and adds nothing to the shared tables.
   */
  private push(op: PortableOp): void {
    const pending = this.pending;
    if (pending === null) return;
    pending.push(
      intern(this.operations, this.operationIndex, this.carryOp(op)),
    );
  }

  /**
   * Record a mutation of a value the context produced.
   *
   * It joins that value's recipe wherever the recorder is in its frame cycle,
   * and whether or not it is armed, because the recipe is what a later use of
   * the value replays. Past {@link RECIPE_STEPS} the mutation is dropped and
   * the value is marked: a recipe that cannot be completed is a value a player
   * must report rather than rebuild from half of it.
   */
  private step(subject: object, op: PortableOp): void {
    const recipe = this.recipes.get(subject);
    if (recipe === undefined) return;
    if (recipe.then.length >= RECIPE_STEPS) {
      recipe.broken = true;
      return;
    }
    recipe.then.push(op);
  }

  /**
   * Keep the part of the context state a context will not report back.
   *
   * The save stack, the clip and the current path are all write-only from
   * outside, and all three survive a frame boundary, so a frame that inherits
   * any of them has to be handed it by the recorder. Maintained whether or not
   * the recorder is armed, because a clip set before the first captured frame
   * is still in force during it.
   */
  private shadow(method: string, args: readonly Portable[]): void {
    this.checkSurface();
    if (TRANSFORM_METHODS.has(method)) this.transform = undefined;

    if (PATH_METHODS.has(method)) {
      if (method === "beginPath") this.path = emptyShadow();
      // The `beginPath` itself is kept, so a segment replays against whatever
      // path the segment before it left behind exactly as it did originally.
      this.extend(this.path, { op: "call", method, args });
      return;
    }
    switch (method) {
      case "save":
        this.saved.push({
          state: this.readState(),
          // Copied, so a correction recorded inside the save leaves what the
          // outer state was stated as alone. An empty map is the common case
          // and is worth no allocation at all.
          emitted: this.emitted.size === 0 ? null : new Map(this.emitted),
        });
        // The outermost entries are the ones a `restore` can no longer reach,
        // so an unbalanced `save` costs a bounded stack rather than a growing
        // one.
        if (this.saved.length > SAVE_STACK) {
          this.saved.shift();
          this.stackTruncated = true;
        }
        return;
      case "restore": {
        const outer = this.saved.pop();
        if (outer === undefined) return;
        // The rest of the state is read back from the context; the clip is the
        // one part a `restore` undoes that nothing can be asked about
        // afterwards. A restored style property holds the reference it was
        // saved with, so what the recording last said about it is restored
        // beside the clip.
        this.clip = outer.state.clip;
        this.emitted = outer.emitted ?? new Map();
        return;
      }
      case "clip": {
        // A clip is carried whole or not at all, and what it costs is the whole
        // of the path in force plus the `clip` call that takes it — so the
        // region it would leave behind is measured against the bound before any
        // of it is taken. Refusing only once the region had already reached the
        // bound would let a clip taken from just under it carry the shadow to
        // very nearly twice {@link SHADOW_OPS}, which is the bound the format
        // states and a player reads. Past it the region in force stands as it
        // is and the frame says it was cut down: half a clip path is a region
        // the build never had, and a path whose own operations the bound
        // already refused is half a path.
        if (
          this.clip.ops + this.path.ops + 1 > SHADOW_OPS ||
          this.path.truncated
        ) {
          this.clip = {
            segments: this.clip.segments,
            ops: this.clip.ops,
            truncated: true,
          };
          return;
        }
        // Clips intersect rather than replace, so the region in force is every
        // segment applied in turn — each under the transform it was applied
        // with, because a clip path is given in user space. The path's own
        // segments are copied rather than shared: the buffer goes on growing,
        // and the clip is what the path was when the clip was taken.
        const taken: Shadow = {
          segments: this.path.segments.map((segment) => ({
            transform: segment.transform,
            ops: [...segment.ops],
          })),
          ops: this.path.ops,
          truncated: this.path.truncated,
        };
        this.extend(taken, { op: "call", method, args });
        // A whole new structure, because the one it replaces is what every
        // entry of the save stack taken before now holds.
        this.clip = {
          segments: [...this.clip.segments, ...taken.segments],
          ops: this.clip.ops + taken.ops,
          truncated: this.clip.truncated || taken.truncated,
        };
        return;
      }
      case "reset":
        this.saved = [];
        this.stackTruncated = false;
        this.clip = emptyShadow();
        this.path = emptyShadow();
        this.emitted = new Map();
        return;
      default:
        return;
    }
  }

  /**
   * Add one operation to a run of segments, under the transform in force.
   *
   * A path is given in user space, so a run of operations issued under one
   * transform is one segment and a transform between two of them starts
   * another. A player replays each segment under the transform it carries,
   * which is what makes a path built across a translate land where the build
   * put it — and what makes a `clip` taken under one transform intersect the
   * region the build meant.
   */
  private extend(shadow: Shadow, op: PortableOp): void {
    // Past the bound the operation is refused and the shadow says so, rather
    // than the buffer growing for the rest of the recording and every frame
    // open paying to re-encode it.
    if (shadow.ops >= SHADOW_OPS) {
      shadow.truncated = true;
      return;
    }
    shadow.ops += 1;
    const transform = this.readTransform();
    const last = shadow.segments[shadow.segments.length - 1];
    if (last !== undefined && sameTransform(last.transform, transform)) {
      last.ops.push(op);
      return;
    }
    shadow.segments.push({ transform, ops: [op] });
  }

  /**
   * Take charge of a value one of the four producing calls returned.
   *
   * The call itself is *not* an operation: it is the first line of the returned
   * value's recipe, and it is written into the recording only if and when the
   * value is used. A gradient nothing ever fills with is a gradient the picture
   * does not contain, and its source image is not one the recording carries.
   *
   * Its arguments are resolved here, because `createPattern` copies its source
   * when it is called: a pattern made from a canvas that is repainted
   * afterwards holds the picture the canvas carried at this moment.
   */
  private produce(
    result: object,
    method: string,
    args: readonly Portable[],
  ): unknown {
    if (!this.recipes.has(result)) {
      this.recipes.set(result, {
        method,
        args,
        then: [],
        name: opaqueName(result),
        broken: false,
      });
    }
    return this.wrap(result, true);
  }

  /**
   * Capture the pixels of a value a canvas can draw, or a marker where it
   * cannot.
   *
   * `null` for a value that is not one at all. A source that reports no size, a
   * canvas tainted by a cross-origin image, a host with no canvas to capture
   * through, and a recording that has reached its budget all degrade to a
   * marker rather than propagating, because a recorder that threw here would
   * take down the frame it was watching.
   */
  private image(value: object): Portable | null {
    const pixels = isHostInstance(value, "ImageData");
    if (!pixels && !BITMAP_SOURCES.some((name) => isHostInstance(value, name)))
      return null;
    const name = opaqueName(value);
    try {
      const entry = pixels ? readPixels(value) : this.readBitmap(value);
      if (entry === null) return { $opaque: name };
      return new CapturedBytes(
        entry,
        name,
        entry.kind === "bitmap" ? entry.src.length : entry.data.length,
      );
    } catch {
      return { $opaque: name };
    }
  }

  /**
   * Read one bitmap source, reusing what was already read where that is
   * honest.
   *
   * A fixed source is looked up against the identity it had when it was
   * captured — for an `<img>`, the file it points at and the resolution that
   * file turned out to have — so it is read once however many operations draw
   * it, and re-pointing one captures again. A source whose content can change
   * is read at every use, because nothing about it says whether it still holds
   * the pixels it held before; two reads that answer the same bytes share one
   * entry, which is what an unchanging surface costs and what a surface
   * repainted every frame is worth.
   */
  private readBitmap(value: object): InlineImage | null {
    const size = sourceSize(value);
    if (size === null) return null;
    if (MUTABLE_SOURCES.some((name) => isHostInstance(value, name)))
      return this.snap(value, size);
    const key = identity(value, size);
    const seen = this.fixedImages.get(value);
    if (seen !== undefined && seen.key === key) return seen.image;
    // Checked before the read, unlike a mutable source: a fixed source the
    // recording does not already hold is one it will never hold, so reading its
    // pixels again on every operation that draws it would buy nothing.
    if (this.captured >= CAPTURE_BUDGET) return null;
    const image = this.snap(value, size);
    if (image !== null) {
      this.fixedImages.set(value, { key, image });
    }
    return image;
  }

  /** One source's pixels as a PNG data URL, or `null` if there is no way to take one. */
  private snap(
    value: object,
    size: { width: number; height: number },
  ): InlineImage | null {
    const ctx = this.scratchContext(size);
    if (ctx === null) return null;
    ctx.drawImage(value as CanvasImageSource, 0, 0, size.width, size.height);
    const canvas = ctx.canvas as unknown as {
      toDataURL: (type?: string) => unknown;
    };
    const url = canvas.toDataURL("image/png");
    return typeof url === "string"
      ? { kind: "bitmap", width: size.width, height: size.height, src: url }
      : null;
  }

  /**
   * The scratch context, sized and blanked for this capture.
   *
   * Built once and resized per capture rather than built per capture: writing
   * the size also blanks the canvas, which is exactly the preparation each
   * capture needs — a smaller or partly transparent source drawn over the last
   * capture would otherwise be recorded with the last capture showing through
   * it — and a build that blits a sprite a hundred times a frame would churn a
   * hundred canvases.
   */
  private scratchContext(size: {
    width: number;
    height: number;
  }): CanvasRenderingContext2D | null {
    this.scratch ??= this.buildScratch();
    const ctx = this.scratch;
    if (ctx === null) return null;
    ctx.canvas.width = size.width;
    ctx.canvas.height = size.height;
    return ctx;
  }

  /**
   * A canvas to capture through, from whichever of the two worlds this is.
   *
   * In a browser that is a detached element. In-process — which is how a
   * validator runs, over a native canvas with no document behind it — it is a
   * fresh instance of the same class the engine's own canvas is, which is how
   * that implementation builds one. Both are asked for a 2D context and for
   * `toDataURL`, and a host that supplies neither leaves every image opaque
   * rather than failing the run.
   */
  private buildScratch(): CanvasRenderingContext2D | null {
    const own = (
      this.target as unknown as { canvas?: { constructor?: unknown } }
    ).canvas?.constructor;
    const candidates: Array<() => unknown> = [];
    if (
      typeof document !== "undefined" &&
      typeof document.createElement === "function"
    ) {
      candidates.push(() => document.createElement("canvas"));
    }
    if (typeof own === "function") {
      candidates.push(
        () => new (own as new (width: number, height: number) => unknown)(1, 1),
      );
    }
    for (const build of candidates) {
      try {
        const canvas = build() as {
          getContext?: (kind: string) => unknown;
          toDataURL?: unknown;
        };
        const ctx = canvas.getContext?.("2d");
        if (ctx != null && typeof canvas.toDataURL === "function") {
          return ctx as CanvasRenderingContext2D;
        }
      } catch {
        // A host that has the class but cannot produce a context from it is a
        // host with no way to capture; the next candidate, or none.
      }
    }
    return null;
  }

  /**
   * Wrap the context, or a value it produced.
   *
   * `resource` is what the two wrappers differ by, and it is exactly the
   * distinction an operation carries: a call on the context is an operation of
   * the frame, and a call on a value the context handed out is a line of that
   * value's recipe. The recipe is looked up per call rather than captured here,
   * so a value a build held across two recordings goes on collecting its
   * mutations into the one recipe it has always had.
   *
   * Every recording decision inside the traps is guarded, and the forwarding is
   * not: what the build asked the context to do happens whatever the recorder
   * makes of it, which is the property that lets a build be captured at all.
   */
  private wrap(object: object, resource: boolean): object {
    const cached = this.wrappers.get(object);
    if (cached !== undefined) return cached;

    const methods = resource
      ? new Map<string, (...args: unknown[]) => unknown>()
      : this.methods;
    const proxy = new Proxy(object, {
      get: (subject, property): unknown => {
        const value = Reflect.get(subject, property, subject) as unknown;
        // A value the recorder tracks comes back wrapped. `ctx.fillStyle` is a
        // read-back of the gradient the build assigned, and a colour stop added
        // through that read is a mutation like any other — handing over the raw
        // value would make every one of them invisible and paint the replay
        // under the stops the assignment happened to have.
        if (typeof value !== "function") return this.tracked(value);
        const name = String(property);
        const cachedMethod = methods.get(name);
        if (cachedMethod !== undefined) return cachedMethod;
        const method = (...args: unknown[]): unknown => {
          // Arguments are unwrapped on the way in and recorded from the
          // unwrapped values: a game that passes back a gradient passes the
          // wrapper it was handed, and a native method refuses a proxy where it
          // expects one of its own objects.
          const real = args.map((arg) => this.unwrap(arg));
          // Resolved before the call, because a call may change what its own
          // argument holds: `ctx.drawImage(ctx.canvas, …)` is the ordinary
          // trails blit, and reading the source afterwards records the surface
          // as the blit left it — a replay compositing the result on top of
          // itself.
          const resolved = this.resolving(resource, name)
            ? this.resolveArgs(real)
            : NO_ARGS;
          // Applied to the real subject, never to the proxy: a native canvas
          // method called with a proxy as its receiver throws, because the
          // internal slots it needs are on the object itself.
          const result = (value as (...rest: unknown[]) => unknown).apply(
            subject,
            real,
          );
          try {
            if (resource) {
              // A call on a resource records into its recipe, and hands back
              // what it returned untouched: a gradient's own methods answer
              // nothing, and a value produced by one is not something a recipe
              // can name.
              this.step(subject, { op: "call", method: name, args: resolved });
              return result;
            }
            if (PRODUCERS.has(name)) {
              // A producing call is never an operation of the frame. One that
              // answers nothing — `createPattern` handed a source it cannot
              // use — produced no value to record, and the answer travels as
              // itself.
              return result !== null && typeof result === "object"
                ? this.produce(result, name, resolved)
                : result;
            }
            this.shadow(name, resolved);
            // After the shadow, so a paint that follows a canvas resize is
            // measured against the state the reset left rather than the one it
            // discarded.
            if (PAINTERS.has(name)) this.correct();
            this.push({ op: "call", method: name, args: resolved });
          } catch {
            // The build's call has already happened. Whatever the recorder made
            // of it, the frame goes on drawing exactly as it would have
            // unwatched.
          }
          return result;
        };
        methods.set(name, method);
        return method;
      },
      set: (subject, property, value): boolean => {
        // The recorded value is encoded before the assignment rather than
        // after, because a context normalizes what it is given — a colour
        // written as `#fff` reads back as `#ffffff` — and the recording states
        // what the build did, not what the context made of it.
        const real = this.unwrap(value);
        try {
          const name = String(property);
          if (resource) {
            this.step(subject, {
              op: "set",
              property: name,
              value: this.resolveValue(real),
            });
          } else {
            // Resolved only where a frame is open to hold it, for the reason
            // {@link resolving} gives. `note` wants the value itself either
            // way: what it asks is whether the property now holds a produced
            // value.
            if (this.pending !== null) {
              this.push({
                op: "set",
                property: name,
                value: this.resolveValue(real),
              });
            }
            this.note(name, real);
          }
        } catch {
          // As above: the assignment below is what the build asked for.
        }
        return Reflect.set(subject, property, real, subject);
      },
    });
    this.wrappers.set(object, proxy);
    // The wrapper is registered against itself as well, so a value that reaches
    // the recorder already wrapped is not wrapped a second time, and against
    // the object it stands for, so a wrapper handed back to the context is
    // unwrapped again.
    this.wrappers.set(proxy, proxy);
    this.unwrapped.set(proxy, object);
    return proxy;
  }

  /**
   * Note what an assignment stated about a property.
   *
   * A property that now holds a produced value is one whose recipe may grow
   * before the next paint, and this is the figure that growth is measured
   * against. One that holds anything else holds a value that cannot change
   * behind the recording.
   */
  private note(property: string, value: unknown): void {
    const recipe =
      value !== null && typeof value === "object"
        ? this.recipes.get(value)
        : undefined;
    if (recipe === undefined) {
      this.emitted.delete(property);
      return;
    }
    this.emitted.set(property, {
      subject: value as object,
      recipe,
      steps: recipe.then.length,
      broken: recipe.broken,
    });
  }

  /**
   * The wrapper for a value the recorder tracks, or the value itself.
   *
   * A produced value read back off the context is the same object the build was
   * handed at the producing call, so it comes back through the same wrapper and
   * its mutations go on joining the one recipe it has always had. Anything
   * else — a colour string, a number, the canvas element — is its own.
   *
   * Guarded, because this stands between the build and every non-function
   * property of its context: a value that cannot be wrapped is handed over as
   * itself rather than turned into a throw from inside a read the build is
   * standing in.
   */
  private tracked(value: unknown): unknown {
    try {
      if (value === null || typeof value !== "object") return value;
      return this.recipes.has(value) ? this.wrap(value, true) : value;
    } catch {
      return value;
    }
  }

  /**
   * The real object behind a wrapper, if this is one.
   *
   * A game that assigns a gradient to `fillStyle` assigns the wrapper it was
   * handed, and a native context refuses a proxy where it expects one of its
   * own objects. Unwrapping on the way in keeps the wrapping invisible to the
   * context while leaving it visible to the recorder.
   */
  private unwrap(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    const real = this.unwrapped.get(value);
    return real ?? value;
  }
}
