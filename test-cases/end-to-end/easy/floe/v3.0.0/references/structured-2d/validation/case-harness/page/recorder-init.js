/*
 * The injected draw-command recorder for an engineless (`none`) build.
 *
 * A replay output is the operations the build itself issued against its 2D
 * context, frame by frame, so what a reviewer scrubs is the build's own drawing
 * rather than a re-shoot of it. Under an engine the engine's own recorder
 * produces that (`packages/simple-2d/src/recording.ts`); an engineless build has
 * no engine to record it, so the recorder is injected into the page instead —
 * installed before a single line of the build's script runs, so every 2D context
 * the page asks for is already a recording proxy by the time the build asks for
 * one.
 *
 * WHAT IT MUST BE, AND WHY. A faithful port of the engine's `ContextRecorder`,
 * writing the SAME document the console's player reads (`format: 1`, see
 * `packages/ui/src/app/pages/runs/replay/format.ts`). Every rule of that format
 * is here for the reason it is there:
 *
 *   - A frame carries the whole of the context state it inherited — the style
 *     properties, the transform, the dash, the CLIP REGION, the CURRENT PATH, and
 *     the stack of states saved under it — and names everything else it draws with
 *     by index into tables the whole recording shares. So any frame can be drawn
 *     without drawing the frames before it, which is what lets the player seek,
 *     and what lets two recordings be scrubbed side by side in step.
 *   - A value the context hands back — a gradient, a pattern — cannot be carried
 *     as a value at all, so it travels as the recipe that rebuilds it: the
 *     creating call plus the mutations made on it up to the moment it is USED. A
 *     style property holds a live reference, so that moment is the PAINT rather
 *     than the assignment, and a gradient given another colour stop after it was
 *     assigned is corrected before the paint that uses it.
 *   - Anything the build blits — an `<img>`, a canvas of its own — is captured as
 *     a PNG data URL, so a sprite draws in the replay instead of being reported as
 *     a value the recorder could not carry. An `ImageData` is carried as its own
 *     RGBA bytes instead, because the canvas round trip a PNG needs is lossy on a
 *     partially transparent pixel and an `ImageData` is the one image a check
 *     compares byte for byte.
 *   - Numbers are written to nine significant digits, and each distinct
 *     operation, state, recipe and image is written once, because a reviewer's
 *     browser parses and holds the whole document.
 *   - Recording is bracketed by the frame and armed by the caller, so a check
 *     records the section its point is about and pays nothing for the setup.
 *
 * WHAT IS TRACKED WHILE THE RECORDER IS IDLE, AND WHY IT HAS TO BE. Four things,
 * each of them a fact about the context that a later frame INHERITS: the recipe of
 * every value the context produced, the clip region in force, the current path,
 * and the stack of saved states. A build is free to create its gradients once at
 * startup and fill with them for the rest of its life, to clip once and draw
 * inside that clip forever, to open a path on one frame and fill it on the next,
 * and to `save()` on one frame and `restore()` on the next — and a recorder that
 * only watched while armed would write an opaque marker, an unclipped frame, an
 * empty path, and a restore to nowhere. None of the four costs anything per FRAME,
 * and each of them is bounded: a recipe is held with the value it belongs to and
 * stops at {@link RECIPE_STEPS} steps, the save stack at {@link STACK_MAX} entries,
 * and the clip and the path at {@link SHADOW_OPS} operations each. A frame that
 * inherited a shadow cut down to its bound SAYS SO, so a reviewer can tell a
 * picture the format could not carry from one it carried. What is deliberately NOT
 * done while idle is the expensive half — nothing is interned into the recording's
 * pools, because a suite drives tens of thousands of frames outside any capture.
 * The one thing captured whether or not a capture is running is the source a
 * `createPattern` copies: a pattern holds the picture its source had at the
 * producing call, and those bytes are taken then or never.
 *
 * WHAT IS DONE TO THE CANVAS ELEMENT. `canvas.width = canvas.width` is the
 * ordinary way a build clears its surface, and it RESETS the context — transform,
 * properties, dash, clip, current path, save stack — without changing a dimension
 * for a size comparison to notice. So the element is given the recorder's own
 * `width` and `height`, each forwarding to the accessor it inherits and saying so
 * afterwards. A reset that lands inside a frame also invalidates the operations
 * that frame has already recorded, because the wipe erased the pixels they drew.
 *
 * WHICH SURFACE A RECORDING IS ABOUT. The largest canvas attached to the
 * document — unless that canvas is doing nothing but copying another surface the
 * recorder also tracks over the whole of itself. That is the ordinary letterboxed
 * pattern: a build renders the game into a design-sized canvas it never attaches
 * and blits it onto the visible one, so the visible one's whole frame is a fill
 * and a `drawImage` and the game's own drawing is nowhere in it. The recording
 * then follows that blit, ONE HOP, to the surface the game is actually drawn on.
 * `choose()` in the installation block carries the reasoning and the cases the
 * rule must not move.
 *
 * WHAT `frameCalls` READS IS NOT WHAT THE RECORDING HOLDS. A check asking which
 * calls one frame made must get the same answer whether or not a capture happens
 * to be running around it, and it cannot resolve an index into pools it never
 * sees. So each frame's operations are built twice: once SELF-CONTAINED, where a
 * produced value and a bitmap alike record as the opaque marker naming their
 * type, which is what {@link last} hands back; and — only while armed — once
 * against the pools, which is what the recording holds.
 *
 * HOW A FRAME IS BRACKETED HERE. Under the engine the loop closes the frame it
 * just ran. Here the frame boundary belongs to whoever is driving: a check
 * running the game off its own clock calls `begin()` / `end(deltaMs)` around each
 * driven step of the build's own debug surface, all inside one synchronous
 * evaluation, so nothing the page's own `requestAnimationFrame` renders can
 * interleave with it. The one check that lets the loop run in real time switches
 * the recorder to `"raf"` mode, where the animation frame closes the frame
 * instead.
 *
 * DECIMATION HAPPENS HERE, NOT AFTERWARDS. A section driven for half a minute of
 * game time is thousands of frames of a couple of hundred operations each, and
 * every one of those would have to cross out of the page. So the kept set is
 * held at {@link KEEP_MAX} by doubling the stride as it fills: the whole section
 * at a lower frame rate, never its first few seconds at the full one. The harness
 * restates the deltas of what comes back, so the kept frames still sum to the
 * section's elapsed time.
 *
 * DECIMATION IS ALSO WHY THE TABLES ARE BUILT AT THE CLOSE. The engine interns
 * every operation as it records it, because it keeps every frame it records. Here
 * a frame is dropped after its operations, images and recipes were recorded, so
 * tables filled as the section ran would carry entries no surviving frame names.
 * What each frame holds while the section runs is its own operations; the pools
 * below are compacted into the recording's tables by `build`, out of the frames
 * that survived. The capture budget is counted the same way — over the images the
 * frames the document will HOLD name — so a section that captures and then throws
 * away is not charged for what it threw away.
 *
 * Exposed as `window.__tcabRec`. Nothing here is ever seeded into a run.
 */
(() => {
  /** The recording format version the console's player understands. */
  const RECORDING_FORMAT = 1;

  /**
   * The most frames held in the page at once.
   *
   * Twice the 300 a written recording holds, so decimation halves into the cap
   * rather than trimming one frame at a time.
   */
  const KEEP_MAX = 600;

  /**
   * The significant digits a recorded number keeps.
   *
   * A double's decimal expansion past the ninth digit is a fact about the
   * arithmetic that produced a coordinate rather than about the picture it draws:
   * nine digits over the 1280-unit field resolve to about a millionth of a pixel.
   * The full expansion costs seventeen characters, on every argument of every
   * operation of every frame, and it is what stops two operations a frame apart
   * from being the same operation.
   */
  const SIGNIFICANT_DIGITS = 9;

  /**
   * The image bytes one recording carries before it stops capturing new ones.
   *
   * A build that blits a full-screen offscreen canvas whose contents change every
   * frame is worth one image per frame, and left unbounded that is a replay of
   * tens of megabytes no reviewer can load. Past the cap a new capture degrades
   * to the opaque marker a player already reports and skips, which is a
   * partly-drawn replay rather than no replay at all.
   *
   * Counted over the bytes the DOCUMENT will hold — a bitmap's data URL, a pixel
   * buffer's base64. An image only a decimated frame ever named is not in the file,
   * so charging the budget for it would stop capture far below the ceiling this
   * constant states.
   */
  const CAPTURE_BUDGET = 16 * 1024 * 1024;

  /**
   * The image bytes ONE PAGE captures across every recording it drives.
   *
   * {@link CAPTURE_BUDGET} is emptied at each arm, so it bounds one section and
   * says nothing at all about a suite file that drives forty of them. That gap is
   * what let one measured run of 166 individually-bounded recordings come to
   * 1.75 GB between them, every one of them inside its own ceiling.
   *
   * Four full sections is already far past anything a real build produces: the
   * whole of a reference's 170 recordings carry twenty-odd megabytes of image
   * payload BETWEEN them. It is a judgement rather than a reading, though, and it
   * should be revisited against a regenerated corpus rather than defended as a
   * measurement.
   *
   * Counted FORWARD ONLY, and never given back. What this bounds is the work a
   * page does turning surfaces into PNGs — the most expensive thing the recorder
   * does — rather than the bytes any one document ends up holding, and a frame
   * dropped by decimation does not un-do the encode that produced it.
   */
  const SESSION_BUDGET = 64 * 1024 * 1024;

  /**
   * The mutation steps one produced value's recipe keeps.
   *
   * A recipe is collected for the whole life of the value, armed or not, so a
   * build that adds a colour stop to the same gradient every frame would grow one
   * without limit. Past the bound the value records as an opaque marker: a
   * partly-drawn replay is the same degradation every other unencodable value
   * gets, and it is bounded memory rather than a leak that outlives the run.
   */
  const RECIPE_STEPS = 1024;

  /**
   * How deep encoding follows a value before calling it opaque.
   *
   * The recorder can never throw — the pixels a build draws are the same whether
   * or not anything is being captured — so a deeply nested or self-referential
   * argument has to terminate in a marker rather than in a `RangeError` thrown
   * out of a proxy trap. Nothing a 2D context accepts is nested anywhere near
   * this deep; an options bag is one level and a matrix init is none.
   *
   * The number is a fixed part of the format rather than this recorder's own
   * choice. Two recorders write these documents — the engine's and this one — and
   * a bound they disagreed on would have them answer the same drawing with two
   * different documents, which is the one thing a second implementation must not
   * do.
   */
  const ENCODE_DEPTH = 32;

  /**
   * How many values one encoded value is allowed to expand into.
   *
   * A depth bound alone does not bound the work. A structure whose nodes are
   * shared — twenty levels of a graph where each node names the same next one
   * twice — is shallower than the bound and expands into a million values, because
   * JSON has no way to say "the same one again". Sharing is resolved once and
   * counted every time it is reached, so a graph is charged what the document it
   * produces costs; whatever is past the bound is dropped and the value's
   * remainder records as ONE marker, because half a million markers is a document
   * larger than the data it refused to carry.
   *
   * A fixed part of the format rather than this recorder's own choice, for the
   * same reason {@link ENCODE_DEPTH} is: two recorders write these documents and a
   * bound they disagreed on would have them answer the same drawing with two
   * different ones.
   */
  const ENCODE_NODES = 65536;

  /**
   * The saved states one frame carries.
   *
   * Every frame re-encodes the whole stack, because a `save()` stores a REFERENCE
   * to whatever a style property holds and the recipe behind that reference goes
   * on growing — so an unbalanced `save()` would otherwise cost a longer stack at
   * every frame open for the rest of the recording, and grow without bound. The
   * entries kept past the bound are the INNERMOST ones, because a `restore()` pops
   * the innermost first: what a build can still return to exactly is the nearest
   * sixty-four levels.
   */
  const STACK_MAX = 64;

  /**
   * The path operations the current path and the clip in force each keep.
   *
   * Neither has a frame boundary to bound it. `beginPath` empties the path buffer
   * and `reset` empties both, so a build that calls neither accumulates operations
   * for the rest of the recording — and every one of them is re-encoded into the
   * state each frame inherits, which is frame-open cost that climbs for as long as
   * the section runs.
   *
   * Past the bound what is already kept is kept and a further operation is refused,
   * so a frame carries a prefix of the path the build built. The frame says so, and
   * the player reports it: a picture the format could not carry has to be
   * distinguishable from one it carried.
   */
  const SHADOW_OPS = 1024;

  /**
   * What one marker stands for when it stands for everything past a bound.
   *
   * The remainder of a value the encoder refused to follow any further, carried as
   * a single marker rather than as one marker per value dropped — half a million
   * markers is a document larger than the data it declined to carry.
   */
  const REMAINDER = "truncated";

  /**
   * The key the remainder of an object's fields is carried under.
   *
   * An array's remainder is its last element and needs no name; an object's needs
   * one, and it has to be a name a player reads as one more field rather than as a
   * marker standing for the whole object.
   */
  const REMAINDER_KEY = "$rest";

  /**
   * The page's own `getContext`, taken before the patch below replaces it.
   *
   * The scratch canvas an image is captured through must get a REAL 2D context:
   * one taken through the patched accessor would be a recording proxy of its own,
   * and capturing an image would record the operations that captured it.
   */
  const nativeGetContext = HTMLCanvasElement.prototype.getContext;

  /**
   * The 2D context properties a frame inherits from the one before it: the whole
   * of the canvas state that survives a frame boundary, minus the transform, the
   * dash pattern and the clip. The first two are read through their own
   * accessors; the clip cannot be read back at all and is shadowed instead.
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
  ];

  /**
   * The context methods that produce a value the recording carries as a recipe.
   *
   * Exactly four, named rather than inferred from "the call returned an object".
   * A recipe is re-issued against the context a player is drawing into, which is
   * faithful only for a value whose content does not depend on the context's
   * state — so treating `getTransform()` as a recipe would replay every following
   * operation under whatever transform the player's canvas happened to hold, and
   * report the frame as clean while doing it.
   */
  const PRODUCERS = new Set([
    "createLinearGradient",
    "createRadialGradient",
    "createConicGradient",
    "createPattern",
  ]);

  /**
   * The calls that build the current path.
   *
   * A clip is write-only — no context reports the region in force — so the
   * recorder shadows it, and to shadow it it has to know the path a `clip()` was
   * applied to. These are the calls that path is made of. `beginPath` and `clip`
   * are handled on their own and are not in the list.
   */
  const PATH_METHODS = new Set([
    "moveTo",
    "lineTo",
    "bezierCurveTo",
    "quadraticCurveTo",
    "arc",
    "arcTo",
    "ellipse",
    "rect",
    "roundRect",
    "closePath",
  ]);

  /** The calls whose operation the clip and path shadows need, frame open or not. */
  const PATH_SHADOW = new Set([...PATH_METHODS, "beginPath", "clip"]);

  /**
   * The calls whose picture depends on a style property.
   *
   * A style property holds a LIVE REFERENCE: a gradient given another colour stop
   * after it was assigned to `fillStyle` paints under that stop without ever being
   * assigned again. So a produced value has to be resolved as of the paint rather
   * than as of the assignment, and these are the calls that paint.
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
   * Every 2D call that puts pixels on the surface.
   *
   * A SUPERSET of {@link PAINTERS} rather than a widening of it. That set answers
   * a different question — which calls need a style property resolved as of the
   * paint — and a `drawImage` or a `clearRect` needs no such resolution, so
   * growing it to answer this one would make every blit correct a style it does
   * not read.
   *
   * What this set is for is the frame's LAST paint: see
   * {@link ContextRecorder.observePaint}, and `choose()` in the installation
   * block below, which is what reads the answer.
   */
  const PAINTING = new Set([
    ...PAINTERS,
    "drawImage",
    "putImageData",
    "clearRect",
  ]);

  /**
   * The host types a canvas can draw from.
   *
   * Named rather than sniffed for a `width` and a `height`, because a plain
   * object with those fields is data a build passed by hand and belongs in the
   * recording as itself. A name the page does not define never matches.
   */
  const BITMAP_SOURCES = [
    "HTMLImageElement",
    "SVGImageElement",
    "HTMLCanvasElement",
    "OffscreenCanvas",
    "ImageBitmap",
    "HTMLVideoElement",
    "VideoFrame",
  ];

  /**
   * The bitmap sources whose content can change under a running recording.
   *
   * An `ImageBitmap` is immutable and an `<img>` announces a change through what
   * it points at, so both are keyed on identity and captured once. A canvas or a
   * video frame that is repainted looks exactly like the one that is not, so
   * these are captured at EVERY use and shared on the bytes they produced: a
   * source that does not change costs one entry however many times it is drawn,
   * and one that does costs one entry per picture it was drawn under. Capturing
   * such a source once per frame would replay the first pixels for both halves of
   * an `ImageData` mutated between two `putImageData` calls, which is a silently
   * wrong picture — worse than the opaque marker it replaces.
   */
  const MUTABLE_SOURCES = [
    "HTMLCanvasElement",
    "OffscreenCanvas",
    "HTMLVideoElement",
    "VideoFrame",
  ];

  const isPrimitive = (v) =>
    v === null ||
    typeof v === "boolean" ||
    typeof v === "number" ||
    typeof v === "string";

  const opaqueName = (v) => {
    if (v === undefined) return "undefined";
    try {
      const proto = Object.getPrototypeOf(v);
      return (proto && proto.constructor && proto.constructor.name) || "object";
    } catch {
      // A proxy may refuse even this. A value that will not say what it is is
      // still a value the recording has to name something.
      return "object";
    }
  };

  /**
   * A number as the recording writes it.
   *
   * Non-finite values travel unchanged: `toPrecision` refuses them, and
   * `JSON.stringify` writes `null` for them either way, so rounding would only
   * add a way to fail.
   */
  const round = (v) =>
    Number.isFinite(v) ? Number(v.toPrecision(SIGNIFICANT_DIGITS)) : v;

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
  const canonical = (v) => {
    if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    const keys = Object.keys(v).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  };

  /** Whether two read-back transforms are the same one. */
  const sameTransform = (a, b) => {
    if (a === null || b === null) return a === b;
    return a.length === b.length && a.every((n, at) => n === b[at]);
  };

  /**
   * What a captured image is shared on, and what it charges the budget.
   *
   * The payload is the whole of the entry's weight — a PNG data URL or a base64
   * pixel buffer, either of them megabytes — so it is compared and measured
   * directly rather than through a JSON encoding of itself, which would copy those
   * megabytes to answer one question.
   */
  const payload = (entry) => (entry.kind === "pixels" ? entry.data : entry.src);
  const imageKey = (entry) =>
    `${entry.kind}|${entry.width}x${entry.height}|${payload(entry)}`;

  /**
   * Bytes as base64, in chunks a call can take.
   *
   * `String.fromCharCode` is applied to a slice at a time because a full-screen
   * pixel buffer is millions of bytes and an argument list that long overflows the
   * call stack.
   */
  const BASE64_CHUNK = 0x8000;
  const base64 = (bytes) => {
    let binary = "";
    for (let at = 0; at < bytes.length; at += BASE64_CHUNK) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(at, at + BASE64_CHUNK),
      );
    }
    return btoa(binary);
  };

  /**
   * The bytes a source held when it was observed, and the type it came from.
   *
   * A recipe's arguments are as of the PRODUCING CALL: `createPattern` copies its
   * source when it is called, so a build that repaints that source afterwards must
   * not have the later picture replayed under the pattern. The bytes are therefore
   * taken at the moment the value is observed and carried in one of these until
   * the value is used, when they are interned into the running recording's image
   * pool. A marker naming the type is carried alongside them, for a recording that
   * has no room left to hold them.
   */
  class CapturedBytes {
    constructor(entry, name) {
      this.entry = entry;
      this.name = name;
    }
  }

  /**
   * A produced value as of the moment it was observed.
   *
   * The mutations are a COPY of the recipe's list rather than the list itself,
   * because the list goes on growing: a gradient given a colour stop between two
   * fills is two resources, and each has to hold the stops that fill actually had.
   * Copying here is also what makes a value that names itself — `addColorStop`
   * handed the gradient it is being added to — terminate on its own, because the
   * copy a step holds was taken before that step existed.
   */
  class ProducedValue {
    constructor(method, args, then) {
      this.method = method;
      this.args = args;
      this.then = then;
    }
  }

  /** Add `entry` to a table if it is new, and answer where it lives. */
  const intern = (table, index, entry) => {
    const key = canonical(entry);
    const found = index.get(key);
    if (found !== undefined) return found;
    const at = table.length;
    table.push(entry);
    index.set(key, at);
    return at;
  };

  /**
   * The descriptor for a property, from wherever on the prototype chain it is
   * defined.
   *
   * `Object.getOwnPropertyDescriptor` answers only for the object it is handed, and
   * the accessors a canvas element carries for its backing store size live on its
   * prototype. Walking the chain is what lets the recorder install its own pair in
   * front of them and still forward to them.
   */
  const describeProperty = (subject, name) => {
    let level = subject;
    while (level !== null) {
      const found = Object.getOwnPropertyDescriptor(level, name);
      if (found !== undefined) return found;
      level = Object.getPrototypeOf(level);
    }
    return null;
  };

  /** A run of path operations with nothing in it yet. */
  const emptyShadow = () => ({ segments: [], ops: 0, truncated: false });

  /** A frame's stack entries carry no path: the path is outside the saved state. */
  const NO_PATH = { segments: [], ops: 0, truncated: false };

  /** Whether `value` is an instance of a host constructor of this name, if one exists. */
  const isHostInstance = (value, name) => {
    const ctor = globalThis[name];
    if (typeof ctor !== "function") return false;
    try {
      return value instanceof ctor;
    } catch {
      // A callable that is not a constructor throws on the right-hand side of
      // `instanceof`. A page that defines such a thing under one of these names
      // is not a page that has the type.
      return false;
    }
  };

  /** How a value a canvas can draw is rebuilt, or null if it is not one. */
  const kindOf = (value) =>
    isHostInstance(value, "ImageData")
      ? "pixels"
      : BITMAP_SOURCES.some((name) => isHostInstance(value, name))
        ? "bitmap"
        : null;

  /* ------------------------------------------------------------------------ */
  /* Image IDENTITY — one addition to the engine's recorder                   */
  /* ------------------------------------------------------------------------ */
  //
  // WHY THIS IS HERE. A case's review points can turn on WHICH picture a frame
  // drew — that a sprite is drawn from a produced bitmap rather than from
  // code-drawn geometry, that a HUD draws the same picture the field does, that
  // a sheet's frames advance across an animation. The recording pools an image
  // as its PIXELS (`{ $img: n }`), which is what a reviewer's player needs, but
  // a suite reading `last()` runs OUTSIDE any capture, where the engine's
  // recorder writes `{ $opaque: "HTMLImageElement" }` — a marker that says a
  // picture was drawn and nothing about which.
  //
  // So the idle encoding names the source instead: a per-page identity, its kind,
  // its natural size, and a hash of wherever it came from. That is enough to tell
  // two sprites apart, to recognize the same sprite drawn twice, and to ask for
  // its pixels back — and it costs nothing per frame beyond one weak-map lookup.
  //
  // THE HASH RATHER THAN THE URL, deliberately. A build resolves the files it
  // ships through the bundler, and a bundler inlines a small PNG as a `data:`
  // URI — so a source string is either a short path or a hundred kilobytes of
  // base64, and the suite crosses out of the page with it on every frame it
  // reads. The hash is the same length either way and identifies the file just
  // as well; the string itself travels only when it is short enough to be a
  // path, which is exactly when a reader can do something with it.

  /** How long a source string may be before only its hash travels. */
  const SRC_INLINE_MAX = 256;

  /** Identities handed out to bitmap sources, so the same source keeps one. */
  const imageIds = new WeakMap();

  /** Every identified source, by identity, so its pixels can be asked for. */
  const imagesById = new Map();

  /** How many sources the registry holds before it stops taking new ones. */
  const IMAGE_REGISTRY_MAX = 512;

  let nextImageId = 0;

  /** A 32-bit FNV-1a hash, as an unsigned decimal string. */
  const hashString = (text) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return String(h >>> 0);
  };

  /** Wherever a source came from, or null when it names nowhere. */
  const sourceUrl = (value) => {
    try {
      const raw = value.currentSrc || value.src || value.href;
      return typeof raw === "string" && raw.length > 0 ? raw : null;
    } catch {
      // A canvas, an `ImageBitmap`, a `VideoFrame`: no URL, and that is a fact
      // about the source rather than a failure.
      return null;
    }
  };

  /**
   * A bitmap source as an idle frame names it, or null when the value is not one.
   *
   * `id` is identity within this page: the same `<img>` drawn on a hundred frames
   * carries one id, and two different produced sprites never share one. `src` is
   * present only when it is short enough to be a path rather than an inlined
   * file; `srcHash` is there either way, so a check can pair a sprite drawn in
   * one place with the same sprite drawn in another without either of them
   * carrying a `data:` URI across the wire.
   */
  const identifyImage = (value) => {
    const kind = kindOf(value);
    if (kind === null) return null;
    let id = imageIds.get(value);
    if (id === undefined) {
      nextImageId += 1;
      id = nextImageId;
      imageIds.set(value, id);
      if (imagesById.size < IMAGE_REGISTRY_MAX) imagesById.set(id, value);
    }
    let size = null;
    try {
      size = sourceSize(value);
    } catch {
      size = null;
    }
    const url = sourceUrl(value);
    return {
      $src: {
        id,
        kind,
        name: opaqueName(value),
        width: size === null ? 0 : size.width,
        height: size === null ? 0 : size.height,
        src: url !== null && url.length <= SRC_INLINE_MAX ? url : null,
        srcHash: url === null ? null : hashString(url),
      },
    };
  };

  /**
   * The RGBA bytes of an identified source, as a plain array, or null.
   *
   * Drawn onto a scratch canvas at its natural size and read back, so a check
   * that has to look at a produced sprite's own pixels — telling two sprites
   * apart with colour removed, say — reads the file the build shipped rather
   * than the corner of the field it happened to land on.
   */
  const readImagePixels = (id) => {
    const value = imagesById.get(id);
    if (value === undefined) return null;
    try {
      if (isHostInstance(value, "ImageData")) {
        return {
          width: value.width,
          height: value.height,
          data: Array.from(value.data),
        };
      }
      const size = sourceSize(value);
      if (size === null) return null;
      const scratch = document.createElement("canvas");
      scratch.width = size.width;
      scratch.height = size.height;
      const ctx = scratch.getContext("2d", { willReadFrequently: true });
      if (ctx === null) return null;
      ctx.drawImage(value, 0, 0, size.width, size.height);
      const pixels = ctx.getImageData(0, 0, size.width, size.height);
      return {
        width: pixels.width,
        height: pixels.height,
        data: Array.from(pixels.data),
      };
    } catch {
      return null;
    }
  };

  /**
   * A matrix as the six numbers `setTransform` accepts, or null if this is not one.
   *
   * A `DOMMatrix` is DATA rather than a value the context produced: re-issuing
   * `getTransform()` against a replay's canvas would answer whatever transform
   * that canvas happened to hold. Carried as a `DOMMatrix2DInit`, a build that
   * reads its transform, changes it and later puts the original back replays
   * under the transform it drew with.
   */
  const matrixInit = (v) => {
    if (
      !isHostInstance(v, "DOMMatrix") &&
      !isHostInstance(v, "DOMMatrixReadOnly")
    ) {
      return null;
    }
    return {
      a: round(v.a),
      b: round(v.b),
      c: round(v.c),
      d: round(v.d),
      e: round(v.e),
      f: round(v.f),
    };
  };

  /** The number behind an SVG animated length, if this is one. */
  const animatedLength = (value) => {
    const length = value && value.baseVal && value.baseVal.value;
    return typeof length === "number" && Number.isFinite(length)
      ? length
      : null;
  };

  /**
   * The pixel size to capture a source at.
   *
   * The accessors are tried in the order that names the source's own resolution
   * before its layout size: an `<img>` sized down by CSS still holds the pixels
   * its file has, and capturing at the smaller figure would throw them away. A
   * source that reports no usable pair is not captured at all.
   */
  const sourceSize = (value) => {
    const pairs = [
      ["naturalWidth", "naturalHeight"],
      ["videoWidth", "videoHeight"],
      ["displayWidth", "displayHeight"],
      ["codedWidth", "codedHeight"],
      ["width", "height"],
    ];
    for (const [wide, high] of pairs) {
      const width = value[wide];
      const height = value[high];
      if (typeof width !== "number" || typeof height !== "number") continue;
      if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
      if (width < 1 || height < 1) continue;
      return { width: Math.floor(width), height: Math.floor(height) };
    }
    // An `<image>` inside an SVG document reports its size as an animated length
    // rather than as a number, and it is the one bitmap source that does. Without
    // this the whole type falls through to the opaque marker.
    const wide = animatedLength(value.width);
    const high = animatedLength(value.height);
    if (wide === null || high === null || wide < 1 || high < 1) return null;
    return { width: Math.floor(wide), height: Math.floor(high) };
  };

  /**
   * What a fixed source is recognized by, beyond being itself.
   *
   * An image element is an element that outlives what it is pointing at, so the
   * file and the size that file turned out to have are part of the identity: a
   * build that re-points one at another sprite sheet gets the new sheet captured.
   * An `<img>` names it in `currentSrc` and an SVG `<image>` in `href.baseVal`,
   * and reading only the first leaves a re-pointed SVG image resolving to the
   * bytes it used to hold. An `ImageBitmap` is immutable and needs nothing beyond
   * its own identity, which the empty remainder gives it.
   */
  const identity = (value, size) => {
    const src =
      value.currentSrc ?? (value.href ? value.href.baseVal : undefined);
    return `${typeof src === "string" ? src : ""}|${size.width}x${size.height}`;
  };

  /**
   * The state a context holds right now that a frame opening on it inherits and
   * that its own operations then move from: the font and the alignment, the
   * transform, and the smoothing flag. Read off the live context rather than
   * reconstructed, so a font set once at start-up, or a letterbox fit issued as
   * a `setTransform` on load and on resize rather than inside every frame, is
   * reported exactly. Each part is read on its own, so a context that lacks one
   * accessor still reports the rest.
   */
  const inheritedState = (ctx) => {
    let state;
    try {
      state = { font: String(ctx.font), textAlign: String(ctx.textAlign) };
    } catch {
      return null;
    }
    try {
      const m = ctx.getTransform();
      state.transform = [m.a, m.b, m.c, m.d, m.e, m.f].map(round);
    } catch {
      state.transform = null;
    }
    try {
      state.imageSmoothingEnabled = ctx.imageSmoothingEnabled !== false;
    } catch {
      state.imageSmoothingEnabled = null;
    }
    return state;
  };

  class ContextRecorder {
    constructor(target) {
      this.target = target;
      this.methods = new Map();
      this.wrappers = new WeakMap();
      this.unwrapped = new WeakMap();

      /**
       * The recipe of each value the context produced, keyed on the value.
       *
       * Held for the whole life of the recorder rather than for the life of one
       * recording, and holding its arguments and mutation steps UNENCODED: a
       * build that creates its gradients once at startup makes them long before
       * any check arms the recorder, and a recipe encoded then would name pool
       * entries of a recording that does not exist yet. Encoding happens at the
       * moment the value is USED, against the recording that is running. Keyed
       * weakly, so a recipe is collected with the value it belongs to.
       */
      this.recipes = new WeakMap();

      /**
       * The clip region in force and the current path, each as the segments that
       * built it.
       *
       * Shadowed because a context reports every part of its state EXCEPT these
       * two, and both survive a frame boundary: a player blanks the canvas before
       * every frame, so a clip or a path established on one frame reaches a later
       * one only by being part of what that frame inherits. A path is given in
       * user space, so each segment carries the transform its operations were
       * issued under. The clip is replaced rather than mutated on each `clip()`,
       * so a saved state can hold the list it saw; the path is copied where it is
       * snapshotted, because the buffer itself goes on growing.
       *
       * Carrying the path is what a carried clip makes unavoidable. Applying an
       * inherited clip replays that clip's own path operations, which leaves the
       * clip outline current — so a frame that then issued a bare `fill()` would
       * fill the outline of its clip instead of the shape the build built.
       *
       * Each carries the count of the operations it holds and whether one was ever
       * refused, against {@link SHADOW_OPS}. A whole structure is replaced rather
       * than mutated wherever a saved state may be holding it, so an entry on the
       * save stack is not changed by what happens after it was saved.
       */
      this.clip = emptyShadow();
      this.path = emptyShadow();

      /** The states the context has saved, outermost first, with their clips. */
      this.saved = [];

      /** Whether the stack has ever been deeper than {@link STACK_MAX}. */
      this.stackTruncated = false;

      /** Whether the open frame inherited a shadow that had been cut down. */
      this.pendingTruncated = false;

      /**
       * The backing store size last seen, or null when nothing has been read yet.
       *
       * The FALLBACK for a canvas {@link watch} could not install its accessors on.
       * Writing `canvas.width` resets the context completely — transform,
       * properties, clip, save stack — and says nothing about it through the
       * context; the accessors catch every such write, and this catches one that
       * reached the element some other way.
       */
      this.surface = null;

      /**
       * What the recording last said each style property holds.
       *
       * A produced value is resolved as of the PAINT rather than as of the
       * assignment, so what a painting call is measured against is this: the value
       * a property was last stated to hold, and how many mutations that value had
       * been given when it was stated. A fact about the context rather than about
       * one recording — it travels through a `save` and a `restore` with the rest
       * of the state, and a canvas resize throws it away with everything else.
       */
      this.emitted = new Map();

      /** The operations of the frame currently open, SELF-CONTAINED, or null. */
      this.calls = null;
      /** The same operations against the pools, or null when not armed. */
      this.pending = null;
      /** The state and save stack the open frame inherited, or null. */
      this.pendingState = null;
      this.pendingStack = null;

      /**
       * The state as the last driven frame left it, or null while none is held.
       *
       * Written by {@link carry} at the first operation issued outside a frame,
       * spent by the next {@link beginFrame}, and thrown away by a wipe. Held
       * UNENCODED, exactly as a save-stack entry is: this outlives any one
       * recording, and encoding it here would intern into the pools of whichever
       * recording happened to be running.
       */
      this.carried = null;

      /** The frames kept so far while armed, or null while idle. */
      this.frames = null;
      /** How many frames have been closed while armed, before decimation. */
      this.seen = 0;
      /** One kept frame in every `stride` closed. */
      this.stride = 1;
      /** The last frame closed while armed, kept or not. */
      this.tail = null;

      /**
       * The context images are captured through: absent until asked for, null
       * once asked for and unavailable.
       */
      this.scratch = undefined;

      this.design = { width: 0, height: 0, background: null };
      /** The operations of the last frame CLOSED, whether armed or not. */
      this.lastOps = [];
      /**
       * The state the open frame INHERITED — the font and alignment, the
       * transform and the smoothing flag the context held when the frame began —
       * and the same for the last frame closed. A build that sets its font once
       * at start-up and never again issues no `set font` inside any later frame,
       * and one that fits its canvas to the window on load and on resize issues
       * no `setTransform` inside any frame at all, so the frame's own operation
       * list cannot say what its text was drawn in or where its draws landed;
       * this can. Taken again when a reset inside the frame drops the operations
       * before it, so it is always the state the frame's SURVIVING operations
       * began under.
       */
      this.inherited = null;
      this.lastInherited = null;

      /**
       * How many painting calls this context has ever taken.
       *
       * A fact about the CONTEXT, counted whether or not a frame is open and never
       * reset — which is the whole of why it is useful. A surface the recorder is
       * not bound to receives no frames at all (only the surfaces `driven()` names
       * do), so a build's offscreen stage draws its entire game outside any frame
       * and nothing frame-shaped can say whether it is drawing. Read against
       * {@link paintedAtFrame} rather than against zero: the question the
       * selection rule needs answered is whether a surface is painting NOW, and a
       * lifetime tally alone would answer it "yes" forever for a layer drawn once
       * at load.
       */
      this.painted = 0;

      /**
       * What {@link painted} stood at when the driven frame now open was opened.
       *
       * The difference between the two is "has this surface painted during THIS
       * frame", which is the question the selection rule actually has to ask — a
       * lifetime tally cannot tell a stage that is repainted every frame from an
       * atlas that was painted once at load and has been static ever since, and
       * following a blit to the second records a game as nothing at all.
       *
       * Taken across EVERY tracked surface at each frame boundary rather than in
       * {@link beginFrame}, because the surface being asked about is by
       * construction not one a frame is driven on: see `openObservation()` in the
       * installation block.
       */
      this.paintedAtFrame = 0;

      /**
       * What the open frame, and the last frame closed, were left BLITTING.
       *
       * The entry of another tracked surface that the frame's last painting call
       * copied over the whole of this one, or null where the frame painted
       * something of its own last. `blit` is the running observation of the open
       * frame and `lastBlit` the settled answer of the last closed one; both are
       * facts about the context rather than about a recording, so neither is reset
       * by {@link resetPools}.
       *
       * Written by {@link observePaint}, read by `choose()` in the installation
       * block, which is where the reasoning for the rule lives.
       */
      this.blit = null;
      this.lastBlit = null;

      /**
       * Whether a frame has ever CLOSED on this recorder.
       *
       * The difference between "this surface blitted nothing last frame" and
       * "nothing is known about this surface yet" — which `lastBlit` alone cannot
       * state, being null for both, and which the selection rule has to keep
       * apart. A candidate that closed a frame and was left blitting nothing is a
       * build drawing straight onto its canvas: a settled answer, and a recording
       * binds there. A candidate no frame has ever closed on is not an answer at
       * all, and treating it as one is the defect `arm()` in the installation
       * block defers around.
       */
      this.settled = false;

      /**
       * The image bytes this recorder has captured across every recording it has
       * driven, against {@link SESSION_BUDGET}.
       *
       * Never reset and never given back. {@link resetPools} empties `captured` at
       * each arm, which is what makes {@link CAPTURE_BUDGET} a bound on ONE
       * recording and nothing on the page that drives forty; this is the other
       * half.
       */
      this.sessionCaptured = 0;

      this.resetPools();
      this.watch();
      this.context = this.wrap(target, false);
    }

    /**
     * Watch the canvas element for the write that resets the context.
     *
     * `canvas.width = canvas.width` is the ordinary way a build clears its surface,
     * and it resets the context completely — transform, properties, dash, clip,
     * current path, save stack — while leaving the size exactly where it was. A
     * comparison of sizes cannot see that at all, so the recorder would go on
     * describing a context that no longer exists and every following frame would
     * inherit it.
     *
     * The element is therefore given its own `width` and `height`, each forwarding
     * to the accessor it inherits and telling the recorder afterwards. Whatever the
     * new size, the reset is seen where it happened.
     *
     * A canvas the accessors cannot be installed on — one carrying its dimensions
     * as plain fields, one that refuses a property definition, a context that will
     * not say what it draws into — is left alone and falls back to
     * {@link checkSurface}. Nothing here may throw: this runs at construction, and
     * a recorder that failed here would take down a page that had not asked to
     * record anything.
     */
    watch() {
      try {
        const canvas = this.target.canvas;
        if (canvas === null || typeof canvas !== "object") return;
        const self = this;
        for (const name of ["width", "height"]) {
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
            get: () => read.call(canvas),
            set: (value) => {
              write.call(canvas, value);
              self.wiped();
            },
          });
        }
      } catch {
        // The size comparison is what is left. It sees every reset but the one that
        // keeps the size, which is better than a recorder that refused to be built.
      }
    }

    get active() {
      return this.frames !== null;
    }

    /**
     * Empty everything one recording owns.
     *
     * A pooled index means nothing outside the recording that pooled it, so the
     * pools, the caches that hand out pooled indices, and the last frame's
     * operation list all belong to one recording and go together. Emptying at the
     * close is also what lets the page reclaim whatever megabytes of captured PNG
     * the section held.
     *
     * What does NOT reset: the recipes, the clip, the current path, the save
     * stack, what each style property was last stated to hold, the operations of
     * the last frame closed, what that frame was left BLITTING, how many painting
     * calls the context has ever taken, and the image bytes this page has captured
     * across every recording. Those are facts about the context rather than about
     * a recording, and the next recording inherits them exactly as the next frame
     * does. The last two are also what the two page-lifetime rules are read from —
     * which surface a recording binds to, and {@link SESSION_BUDGET} — and both
     * would be defeated outright by being emptied at each arm.
     *
     * The last frame's operations belong in that list because `last()` answers
     * them "whether or not a capture was running": a check that drives its frame
     * inside `captureReplay` and reads what that frame drew afterwards would
     * otherwise see an empty frame purely because its evidence was being
     * collected, which is a capture deciding a verdict.
     */
    resetPools() {
      /** Every image captured while armed, and where each lives. */
      this.imagePool = [];
      this.imageAt = new Map();
      /**
       * Where each fixed source was captured to, and under what identity.
       *
       * A `null` index records a source a budget REFUSED under that identity, so
       * it is not encoded again on every draw for the rest of the section. Without
       * that a build past its ceiling paid a full PNG encode per blit per frame to
       * be told the same no each time.
       */
      this.fixedImages = new WeakMap();
      /** How many held frames name each pooled image. */
      this.imageRefs = new Map();
      /** The pooled image indices the open frame names. */
      this.frameUses = new Set();
      /** The bytes the recording would hold, against {@link CAPTURE_BUDGET}. */
      this.captured = 0;
      /** Every resource recipe used while armed, and where each lives. */
      this.resourcePool = [];
      this.resourceAt = new Map();
    }

    start(design) {
      this.design = { ...design };
      this.frames = [];
      this.calls = null;
      this.pending = null;
      this.pendingState = null;
      this.pendingStack = null;
      this.seen = 0;
      this.stride = 1;
      this.tail = null;
      this.resetPools();
    }

    /** Disarm, and hand back the recording built from the frames that were kept. */
    stop() {
      const frames = this.frames || [];
      // The last frame the section drove is always kept, whatever the stride
      // landed on: it is the frame the check's sweep stopped at — the contact, the
      // point, the rebound — and it is the one a reviewer looks at first. Keeping
      // it is also what makes the kept deltas sum to the whole of the section's
      // elapsed time once the harness restates them.
      const tail = this.tail;
      if (
        tail !== null &&
        (frames.length === 0 || frames[frames.length - 1].count !== tail.count)
      ) {
        frames.push(tail);
      }
      const tables = this.build(frames);
      this.frames = null;
      this.calls = null;
      this.pending = null;
      this.pendingState = null;
      this.pendingStack = null;
      this.tail = null;
      this.resetPools();
      return {
        format: RECORDING_FORMAT,
        width: this.design.width,
        height: this.design.height,
        background: this.design.background,
        images: tables.images,
        resources: tables.resources,
        ops: tables.ops,
        states: tables.states,
        frames: tables.frames,
      };
    }

    /**
     * Give up a recording without building it: a speculation that LOST.
     *
     * `arm()` may start a recording on more than one surface at once — see the
     * deferred binding in the installation block — and exactly one of them is the
     * recording. This is how the others go away. It is {@link stop} without the
     * compaction: nothing reads the frames, so nothing pays to turn the pools into
     * tables, and the megabytes of captured PNG they hold are dropped rather than
     * copied into a document no one asked for.
     *
     * What it does NOT touch is what {@link resetPools} does not touch either —
     * the operations of the last frame closed, what that frame was left blitting,
     * whether a frame has ever closed here, and this page's captured total. Those
     * are facts about the CONTEXT, and a speculation that lost still observed a
     * real frame: the evidence it took is exactly what the decision to abandon it
     * was made from.
     */
    abandon() {
      this.frames = null;
      this.calls = null;
      this.pending = null;
      this.pendingState = null;
      this.pendingStack = null;
      this.tail = null;
      this.resetPools();
    }

    /**
     * Compact the pools into the recording's tables, and the kept frames into
     * indices into them.
     *
     * Every table entry is reached from a frame that survived decimation, and
     * every reference inside one is rewritten as it is reached, transitively: a
     * frame names a state, whose clip segments and inherited fill name operations
     * and resources, whose own creating calls may name images. What is
     * deduplicated is the rewritten entry, so an operation two hundred frames
     * issue identically is written once and named two hundred times — and every
     * index a frame carries addresses the table it was interned into, so the
     * document cannot name an entry it does not hold.
     */
    build(frames) {
      const images = [];
      const imageAt = new Map();
      const resources = [];
      const resourceAt = new Map();
      const ops = [];
      const opAt = new Map();
      const states = [];
      const stateAt = new Map();

      const takeImage = (pooled) => {
        const found = imageAt.get(pooled);
        if (found !== undefined) return found;
        const at = images.length;
        images.push(this.imagePool[pooled]);
        imageAt.set(pooled, at);
        return at;
      };

      const takeResource = (pooled) => {
        const found = resourceAt.get(pooled);
        if (found !== undefined) return found;
        const recipe = this.resourcePool[pooled];
        // A recipe's own arguments were encoded when the value was used, so they
        // can only name entries pooled before it: rewriting one terminates and
        // cannot re-enter this resource.
        const rebuilt = {
          make: {
            method: recipe.make.method,
            args: recipe.make.args.map(value),
          },
          then: recipe.then.map(operation),
        };
        const at = resources.length;
        resources.push(rebuilt);
        resourceAt.set(pooled, at);
        return at;
      };

      const value = (v) => {
        if (v === null || typeof v !== "object") return v;
        if (Array.isArray(v)) return v.map(value);
        if (typeof v.$img === "number") return { $img: takeImage(v.$img) };
        if (typeof v.$res === "number") return { $res: takeResource(v.$res) };
        const rewritten = {};
        for (const [key, entry] of Object.entries(v)) {
          Object.defineProperty(rewritten, key, {
            value: value(entry),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        return rewritten;
      };

      const operation = (op) =>
        op.op === "call"
          ? { op: "call", method: op.method, args: op.args.map(value) }
          : { op: "set", property: op.property, value: value(op.value) };

      const segments = (list) =>
        list.map((segment) => ({
          transform: segment.transform,
          ops: segment.ops.map(operation),
        }));

      const stateOf = (state) => {
        const properties = {};
        for (const [name, entry] of Object.entries(state.properties)) {
          // Defined rather than assigned: a property named `__proto__` reaches the
          // prototype setter instead of becoming a field the document carries.
          Object.defineProperty(properties, name, {
            value: value(entry),
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

      const takeState = (state) => intern(states, stateAt, stateOf(state));

      const kept = frames.map((frame) => ({
        count: frame.count,
        timeMs: frame.timeMs,
        deltaMs: frame.deltaMs,
        surface: frame.surface,
        state: takeState(frame.state),
        stack: frame.stack.map(takeState),
        ops: frame.ops.map((op) => intern(ops, opAt, operation(op))),
        // Written only where something was in fact cut down. The flag names an
        // exceptional frame, and `false` on every frame of a long recording is
        // bytes spent saying nothing.
        ...(frame.truncated ? { truncated: true } : {}),
      }));

      return { images, resources, ops, states, frames: kept };
    }

    /**
     * Open a frame.
     *
     * The inherited state is snapshotted here rather than at the close, because
     * it is the state the frame's own operations START from — which is exactly
     * what makes the frame independently drawable. The stack of states saved
     * under it is snapshotted with it: a build may `save()` on one frame and
     * `restore()` on the next, and a replay whose stack was empty would run
     * everything after that restore under the state the frame left instead of the
     * state it returned to.
     *
     * A frame is opened whether or not the recorder is armed: the last closed
     * frame's operation list is what `frameCalls` reads, and a check that asks
     * what one frame drew is not recording a section. The state snapshots are
     * taken only while armed, because nothing but the recording reads them.
     *
     * What it inherits is the state the PREVIOUS DRIVEN FRAME left rather than the
     * state the context holds now, wherever the two differ — see {@link carry}.
     */
    beginFrame() {
      // Before the state is settled on, because a resize between the last
      // operation and this frame threw away the clip, the path and the save stack,
      // and a state — carried or live — over shadows the context no longer holds
      // describes a frame that never happened.
      this.checkSurface();
      this.inherited = inheritedState(this.target);
      // Spent here whether or not this frame is armed to use it: a frame that runs
      // leaves the live context as what the frame after it inherits, so a state
      // carried from before this one is answered by the context from now on.
      const carried = this.carried;
      this.carried = null;
      this.calls = [];
      // The observation is the OPEN frame's, and is started empty at every frame
      // whether or not this one is armed: what a frame was left blitting is only
      // ever an answer about that frame.
      this.blit = null;
      if (this.frames === null) {
        this.pending = null;
        this.pendingState = null;
        this.pendingStack = null;
        return;
      }
      this.pending = [];
      this.frameUses = new Set();
      this.snapshot(carried);
    }

    /** Whether a driven frame is open: what {@link carry} is the outside of. */
    get insideFrame() {
      return this.calls !== null;
    }

    /**
     * Put the state the last driven frame left aside, before something outside a
     * frame changes it.
     *
     * The page's own animation-frame loop goes on painting between two driven
     * frames — an engineless build is required to keep rendering while it is off
     * the clock — and every operation of that background render moves the very
     * shadows and properties a frame's inherited state is read from. Whether a
     * present lands in any given gap is wall-clock dependent, so a state read live
     * at {@link beginFrame} makes the recording differ from one run of a suite to
     * the next while describing the same drawing.
     *
     * The first operation issued outside a frame therefore puts the state aside
     * here, and the next frame inherits THAT. Copy-on-write: a gap in which
     * nothing is issued copies nothing, which is every gap of a suite whose build
     * is not painting behind it, and a gap in which something is copies once
     * however long the background render turns out to be.
     *
     * The path shadow and the save stack are copied, because both go on being
     * mutated in place after the copy is taken. The clip is not: a clip region is
     * REPLACED rather than mutated wherever a saved state may be holding it, which
     * is the same reason a `save()` may hold the one in force by reference.
     */
    carry() {
      if (this.insideFrame || this.carried !== null) return;
      this.carried = {
        state: this.readState(),
        clip: this.clip,
        path: {
          segments: this.copySegments(this.path.segments),
          ops: this.path.ops,
          truncated: this.path.truncated,
        },
        saved: this.saved.slice(),
        stackTruncated: this.stackTruncated,
      };
    }

    /**
     * Take the state the open frame inherits, and the states saved under it.
     *
     * Taken again if the context is reset before the frame's first operation, which
     * is where an engineless build fits its canvas to the window: a frame inherits
     * what its first operation runs under, and that is the state the reset left
     * rather than the one it discarded.
     *
     * Each saved state is encoded HERE rather than pinned when it was saved. A
     * `save()` stores a reference, so the gradient a saved state holds paints under
     * whatever stops it has when the frame the `restore()` lands in resolves it,
     * and pinning at the save would replay the earlier picture. The current path is
     * outside the saved state, so a stack entry carries none: what a `restore()`
     * returns to is the state, and the path in force belongs to the state the frame
     * opened with.
     *
     * `carried` is the state the previous driven frame left, where something
     * outside a frame has moved the context since — see {@link carry}. Live is the
     * fallback, and it is the right answer in exactly two places: the first frame
     * after the recorder attached to the context, and a frame after a wipe, which
     * threw away the clip, the path and the save stack a carried state describes.
     */
    snapshot(carried) {
      const from = carried ?? {
        state: this.readState(),
        clip: this.clip,
        path: this.path,
        saved: this.saved,
        stackTruncated: this.stackTruncated,
      };
      this.pendingStack = from.saved.map((entry) =>
        this.encodeState(entry.state, entry.clip, NO_PATH),
      );
      const raw = from.state;
      this.pendingState = this.encodeState(raw, from.clip, from.path);
      // Everything the frame inherits, against the bound each of the three shadows
      // carries. A frame that inherits a state the recorder could only keep part of
      // replays under a state close to the build's rather than equal to it, and a
      // reviewer has to be told that rather than left to compare pixels.
      this.pendingTruncated =
        from.stackTruncated ||
        from.path.truncated ||
        from.clip.truncated ||
        from.saved.some((entry) => entry.clip.truncated);
      // The snapshot is itself an encoding of every produced value the state
      // holds, so it is what this frame's first paint is measured against.
      this.emitted = this.emissions(raw.properties);
    }

    endFrame(info, surface) {
      const calls = this.calls;
      const pooled = this.pending;
      const state = this.pendingState;
      const stack = this.pendingStack;
      const truncated = this.pendingTruncated;
      this.calls = null;
      this.pending = null;
      this.pendingState = null;
      this.pendingStack = null;
      this.pendingTruncated = false;
      if (calls === null) return;
      // Past the guard, so it states "a frame closed HERE" rather than "a frame
      // ran somewhere". Everything settled below is an answer about this surface;
      // this is the flag that says those answers exist to be read.
      this.settled = true;
      this.lastOps = calls;
      this.lastInherited = this.inherited;
      // Settled beside the operations, and AFTER the guard above, so a recorder
      // that never had a frame opened on it never states an answer at all: a
      // surface with no frames is not evidence about what it drew.
      this.lastBlit = this.blit;
      this.blit = null;
      if (this.frames === null || pooled === null) return;

      const index = this.seen;
      this.seen += 1;
      const frame = {
        count: info.count,
        timeMs: info.timeMs,
        deltaMs: info.deltaMs,
        surface: { width: surface.width, height: surface.height },
        state,
        stack,
        ops: pooled,
        truncated,
        // What the frame charges against the capture budget, so the charge can be
        // given back if the frame is dropped.
        images: this.frameUses,
        held: true,
        kept: index % this.stride === 0,
        tail: true,
      };
      this.frameUses = new Set();

      const previous = this.tail;
      this.tail = frame;
      if (previous !== null) {
        previous.tail = false;
        this.settle(previous);
      }
      if (!frame.kept) return;

      this.frames.push(frame);
      if (this.frames.length >= KEEP_MAX) {
        // Halve what is held and take one in every two from here on, so the kept
        // set still covers the whole section rather than its opening.
        const dropped = this.frames.filter((_, i) => i % 2 !== 0);
        this.frames = this.frames.filter((_, i) => i % 2 === 0);
        this.stride *= 2;
        for (const gone of dropped) {
          gone.kept = false;
          this.settle(gone);
        }
      }
    }

    /**
     * Give back what a frame the document will not hold was charged.
     *
     * A frame is charged for the images it names the moment it names them, so a
     * single frame cannot blow past the budget before it closes. A frame that is
     * then neither kept nor the tail is not in the document, so what it charged
     * is released and the ceiling means what it says.
     */
    settle(frame) {
      if (!frame.held || frame.kept || frame.tail) return;
      frame.held = false;
      for (const at of frame.images) this.release(at);
    }

    /** Charge the open frame for a pooled image, once however often it names it. */
    use(at) {
      if (this.frameUses.has(at)) return;
      this.frameUses.add(at);
      this.retain(at);
    }

    /**
     * Count one more, or one fewer, frame naming a pooled image.
     *
     * The budget is the bytes the document will hold, and the document holds an
     * image exactly while some frame in it names one — so the charge follows the
     * count across nothing and back, and an image every frame that named it lost
     * costs the recording nothing.
     */
    retain(at) {
      const count = (this.imageRefs.get(at) ?? 0) + 1;
      this.imageRefs.set(at, count);
      if (count !== 1) return;
      const bytes = payload(this.imagePool[at]).length;
      this.captured += bytes;
      // The page-lifetime total is charged here and NEVER given back, so an image
      // whose last naming frame was decimated away and which a later frame names
      // again is charged for twice. That is deliberate: this ceiling bounds the
      // work the page did turning surfaces into bytes, and the page did that work
      // both times.
      this.sessionCaptured += bytes;
    }

    release(at) {
      const count = (this.imageRefs.get(at) ?? 0) - 1;
      if (count > 0) {
        this.imageRefs.set(at, count);
        return;
      }
      this.imageRefs.delete(at);
      this.captured -= payload(this.imagePool[at]).length;
    }

    /**
     * Notice a canvas resize the accessors did not announce.
     *
     * The fallback for a canvas {@link watch} could not install itself on. The
     * backing store size is read before each shadowed operation and before each
     * state snapshot, and a size that differs from the one last seen is a context
     * that was reset between the two.
     */
    checkSurface() {
      let size = null;
      try {
        const canvas = this.target.canvas;
        const width = canvas === null ? undefined : canvas.width;
        const height = canvas === null ? undefined : canvas.height;
        if (typeof width === "number" && typeof height === "number") {
          size = { width, height };
        }
      } catch {
        // A context that will not say what it draws into says nothing about a reset
        // either, and guessing one would throw away a clip that is still in force.
        return;
      }
      if (size === null) return;
      const last = this.surface;
      this.surface = size;
      if (
        last === null ||
        (last.width === size.width && last.height === size.height)
      ) {
        return;
      }
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
     * dropped — from what the recording holds and from what a check reads back
     * alike, because both answer "what did this frame draw" — the images they
     * charged are given back, and the inherited state is taken again.
     */
    wiped() {
      this.saved.length = 0;
      this.stackTruncated = false;
      this.clip = emptyShadow();
      this.path = emptyShadow();
      this.emitted = new Map();
      // The state put aside for the next frame described the clip, the path and
      // the save stack this wipe has just discarded, so it describes a frame that
      // never happened. The next frame reads the context instead.
      this.carried = null;
      // The size comparison is the fallback for a canvas the accessors could not be
      // installed on. A reset that announced itself is dealt with here, so the size
      // last seen is forgotten rather than compared against and dealt with twice.
      this.surface = null;
      if (this.calls !== null) {
        this.calls.length = 0;
        // The operations that survive begin under the state the reset left.
        this.inherited = inheritedState(this.target);
      }
      if (this.pending === null) return;
      this.pending.length = 0;
      for (const at of this.frameUses) this.release(at);
      this.frameUses = new Set();
      this.snapshot();
    }

    /**
     * Add one path operation to a run of segments, under the transform in force.
     *
     * A path is given in user space, so a player has to replay each of these under
     * the transform its operations were issued under before it sets the frame's
     * own. Operations issued under one transform share a segment, and a transform
     * changed part-way through a path opens the next one.
     *
     * Past {@link SHADOW_OPS} the operation is refused and the shadow says so,
     * rather than the buffer growing for the rest of the recording and every frame
     * open paying to re-encode it.
     */
    extend(shadow, op) {
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

    /** A copy of a segment list, safe against the buffer it was copied from. */
    copySegments(segments) {
      return segments.map((segment) => ({
        transform: segment.transform,
        ops: segment.ops.slice(),
      }));
    }

    /** The transform in force, rounded as the recording writes it. */
    readTransform() {
      try {
        const m = this.target.getTransform();
        return [m.a, m.b, m.c, m.d, m.e, m.f].map(round);
      } catch {
        // `getTransform` is the one accessor a very old context may lack. Without
        // it a frame relies on the transform its own operations establish.
        return null;
      }
    }

    /**
     * The canvas state, read defensively and left UNENCODED.
     *
     * Every read is guarded because the set of properties a context carries is
     * not fixed, and a property that is absent or that throws on read is omitted
     * — a replay that restores one property fewer draws a slightly different
     * frame, while a recorder that threw here would take down the frame it was
     * watching.
     *
     * Unencoded because this is also what a `save()` records, and a save happens
     * as often outside a capture as inside one: encoding there would intern into
     * the pools of whatever recording ran next. The values are canvas state —
     * strings, numbers, and the gradients and patterns the recipes already track
     * — so holding them costs nothing and encoding them at the frame that keeps
     * them costs the same as encoding them here.
     */
    readState() {
      const target = this.target;
      const properties = {};
      for (const name of STATE_PROPERTIES) {
        try {
          const value = target[name];
          if (value === undefined) continue;
          properties[name] = value;
        } catch {
          /* absent or unreadable: omit */
        }
      }
      let lineDash = null;
      try {
        lineDash = [...target.getLineDash()].map(round);
      } catch {
        /* no getLineDash */
      }
      return { properties, transform: this.readTransform(), lineDash };
    }

    /** One read-back state as the recording writes it, against the pools. */
    encodeState(raw, clip, path) {
      const properties = {};
      for (const [name, value] of Object.entries(raw.properties)) {
        properties[name] = this.encode(value);
      }
      return {
        properties,
        transform: raw.transform,
        lineDash: raw.lineDash,
        clip: clip.segments,
        // Copied, because the path buffer goes on growing under the frame that
        // snapshotted it. The clip is replaced rather than mutated, so the list a
        // state holds is already its own.
        path: this.copySegments(path.segments),
      };
    }

    /**
     * What a state snapshot stated about each property holding a produced value.
     *
     * Rebuilt from the snapshot, because encoding that snapshot is what stated it.
     */
    emissions(properties) {
      const emitted = new Map();
      for (const [name, value] of Object.entries(properties)) {
        const subject =
          value !== null && typeof value === "object"
            ? this.unwrap(value)
            : null;
        const recipe = subject === null ? undefined : this.recipes.get(subject);
        if (recipe === undefined) continue;
        emitted.set(name, {
          subject,
          recipe,
          steps: recipe.then.length,
          overflow: recipe.overflow,
        });
      }
      return emitted;
    }

    /**
     * Note what an assignment stated about a property.
     *
     * A property that now holds a produced value is one whose recipe may grow
     * before the next paint, and the step count kept here is the figure that
     * growth is measured against: a recipe's arguments are pinned at the producing
     * call and its mutations only ever append, so two uses of one value with the
     * same number of steps are the same resource. A property holding anything else
     * holds a value that cannot change behind the recording's back.
     */
    note(name, value) {
      const subject =
        value !== null && typeof value === "object" ? this.unwrap(value) : null;
      const recipe = subject === null ? undefined : this.recipes.get(subject);
      if (recipe === undefined) {
        this.emitted.delete(name);
        return;
      }
      this.emitted.set(name, {
        subject,
        recipe,
        steps: recipe.then.length,
        overflow: recipe.overflow,
      });
    }

    /**
     * State what the context is about to paint with, where it has changed itself.
     *
     * A style property holds a LIVE REFERENCE. A gradient assigned to `fillStyle`
     * and then given another colour stop paints under that stop without ever being
     * assigned again, and a `restore()` restores a reference rather than a copy —
     * so what the property paints is not what the recording last said it paints.
     * Before each painting call, each property holding a produced value is
     * compared against the encoding last emitted for it, and one that has moved on
     * is corrected with an assignment the build did not make. What follows the
     * correction then states what the context is about to paint.
     *
     * The correction goes into the POOLED operations alone. The self-contained
     * list is what a check reads to ask which calls a frame made, and this is not
     * one of them.
     */
    correct() {
      for (const [name, mark] of this.emitted) {
        if (
          mark.steps === mark.recipe.then.length &&
          mark.overflow === mark.recipe.overflow
        ) {
          continue;
        }
        this.pending.push({
          op: "set",
          property: name,
          value: this.encode(mark.subject),
        });
        // Replaced rather than written through: a `save()` copies the map but
        // shares the marks in it, and the outer state was stated as what it was
        // stated as.
        this.emitted.set(name, {
          subject: mark.subject,
          recipe: mark.recipe,
          steps: mark.recipe.then.length,
          overflow: mark.recipe.overflow,
        });
      }
    }

    /** One value as the RECORDING carries it: pooled indices and captured pixels. */
    encode(value) {
      return this.encodeValue(value, true, 0, undefined);
    }

    /**
     * The three readings of one operation's value, each degrading to a marker.
     *
     * An operation whose argument could not be read still belongs in the frame: a
     * marker is a value the player reports and skips, where a dropped operation is
     * one nothing says anything about. Encoding is total by construction — a cycle,
     * a getter that throws and a structure past the bounds all resolve to a marker
     * on their own — and these are what make that unconditional.
     */
    encodeArg(value) {
      try {
        return this.encode(value);
      } catch {
        return { $opaque: opaqueName(value) };
      }
    }

    describeArg(value) {
      try {
        return this.describe(value);
      } catch {
        return { $opaque: opaqueName(value) };
      }
    }

    portableArg(value) {
      try {
        return this.portable(value, 0, undefined);
      } catch {
        return { $opaque: opaqueName(value) };
      }
    }

    /**
     * One value as a reader with no tables carries it.
     *
     * What `frameCalls` gets, and it has to say the same thing whether or not a
     * capture is running: a pooled index resolves against tables the check never
     * receives, and a table that has since been emptied resolves against nothing
     * at all. A produced value and a bitmap alike record here as the opaque
     * marker naming their type, which is the answer an idle recorder gives.
     */
    describe(value) {
      return this.encodeValue(value, false, 0, undefined);
    }

    /**
     * Encode one value.
     *
     * Plain data is carried as itself, a matrix as the six numbers `setTransform`
     * accepts, and an array or a plain object field by field — which is what
     * keeps the lists `getLineDash` and `getContextAttributes` answer out of the
     * resource table. Against the pools, a value the context produced is carried
     * as an index into the resource pool and pixels a canvas can draw as an index
     * into the image pool. Anything else is carried as an opaque marker naming
     * its type, so a reader can say which operation it cannot reproduce instead
     * of a player failing on a value it cannot explain.
     *
     * `depth` and the walk are what make that last sentence unconditional. A build
     * that assigns a cyclic object to `fillStyle` is a silent no-op on a bare
     * canvas, and it has to stay one here: the recorder can never change the
     * pixels a build draws, so a value it cannot walk becomes a marker rather
     * than an exception thrown out of a proxy trap.
     */
    encodeValue(value, pooled, depth, walk) {
      // Counted here, where every value inside a walk passes: the bound is on what
      // the recording is asked to write out, and a million numbers cost what a
      // million objects do once they are JSON.
      if (walk !== undefined) walk.spent += 1;
      if (typeof value === "number") return round(value);
      if (isPrimitive(value)) return value;
      if (typeof value !== "object") return { $opaque: opaqueName(value) };

      // Unwrapped first. Only the arguments a call is made with cross the wrapper
      // unwrapped — a native method refuses a proxy where it expects one of its
      // own objects — so a gradient NESTED inside an object a build passed arrives
      // here as the wrapper it was handed. A recipe lookup against that wrapper
      // finds nothing and writes an opaque marker where the engine's recorder
      // writes a resource, and the two recorders must answer the same drawing with
      // the same document.
      const subject = this.unwrap(value);

      if (pooled) {
        // The recipe first: it is one weak lookup, where recognizing a bitmap
        // source is a walk down a list of host constructors. The two never
        // overlap — none of the four producing methods answers something a canvas
        // can draw from.
        const recipe = this.recipes.get(subject);
        if (recipe !== undefined) {
          return this.fromPortable(this.produced(recipe));
        }
      }

      const matrix = matrixInit(subject);
      if (matrix !== null) return matrix;

      if (pooled) {
        const image = this.captureImage(subject);
        if (image !== null) return { $img: image };
      } else {
        // An idle frame names a bitmap source rather than writing an opaque
        // marker over it. Nothing the recording carries changes — this branch
        // runs only when `pooled` is false, which is the self-contained encoding
        // `last()` hands the suite.
        const named = identifyImage(subject);
        if (named !== null) return named;
      }

      return this.encodeData(subject, depth, walk, (entry, next, scope) =>
        this.encodeValue(entry, pooled, next, scope),
      );
    }

    /**
     * An array or a plain object field by field, or a marker for anything else.
     *
     * This is what keeps the lists `getLineDash` and `getContextAttributes` answer
     * out of the resource table: anything carrying a prototype of its own is a
     * host object, and its fields would not reconstruct it.
     *
     * The depth bound and the walk are what make encoding total. A build that
     * assigns a cyclic object to `fillStyle` is a silent no-op on a bare canvas and
     * has to stay one here, so a value the encoder cannot walk becomes a marker
     * rather than an exception thrown out of a proxy trap. Both bounds are the
     * format's — {@link ENCODE_DEPTH} and {@link ENCODE_NODES} — and both are
     * checked where the engine checks them, so a value past either records the same
     * way in both recorders.
     *
     * A node is resolved once per walk and shared from there. The cycle guard has
     * to be the path currently being walked rather than everything seen, and
     * without the memo beside it a value reached down twenty different paths is
     * expanded two to the twentieth times.
     */
    encodeData(value, depth, walk, next) {
      let proto = null;
      try {
        proto = Object.getPrototypeOf(value);
      } catch {
        // A proxy may refuse even this.
        return { $opaque: opaqueName(value) };
      }
      const array = Array.isArray(value);
      if (!array && proto !== Object.prototype && proto !== null) {
        return { $opaque: opaqueName(value) };
      }
      if (depth >= ENCODE_DEPTH) return { $opaque: opaqueName(value) };
      const scope = walk ?? { seen: new Set(), memo: new Map(), spent: 0 };
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
        let encoded;
        if (array) {
          encoded = [];
          for (const entry of value) {
            // One marker for the whole remainder rather than one per element
            // refused: a flat array of half a million numbers would otherwise
            // record as half a million markers, which is a document larger than
            // the data it declined to carry.
            if (scope.spent >= ENCODE_NODES) {
              encoded.push({ $opaque: REMAINDER });
              break;
            }
            encoded.push(next(entry, depth + 1, scope));
          }
        } else {
          encoded = {};
          for (const key of Object.keys(value)) {
            // Defined rather than assigned, because a build's own object may carry
            // a field named `__proto__` and assigning that name reaches the
            // prototype setter instead of writing a field the recording would
            // carry.
            if (scope.spent >= ENCODE_NODES) {
              Object.defineProperty(encoded, REMAINDER_KEY, {
                value: { $opaque: REMAINDER },
                enumerable: true,
                writable: true,
                configurable: true,
              });
              break;
            }
            Object.defineProperty(encoded, key, {
              value: next(value[key], depth + 1, scope),
              enumerable: true,
              writable: true,
              configurable: true,
            });
          }
        }
        scope.memo.set(value, {
          value: encoded,
          size: scope.spent - before + 1,
        });
        return encoded;
      } catch {
        // A getter that throws is a value the recorder could not read, which is
        // the same outcome as a value it could not carry.
        return { $opaque: opaqueName(value) };
      } finally {
        // Removed on the way out, so the guard catches a cycle rather than a value
        // that simply appears twice under two different fields.
        scope.seen.delete(value);
      }
    }

    /**
     * One value as it will be CARRIED, resolved as of now.
     *
     * The first half of the two-stage encoding, and the reason there are two. A
     * recipe's arguments are as of the producing call: `createPattern` copies its
     * source when it is called, so a build that repaints that source afterwards
     * would otherwise have the later picture replayed under the pattern — every
     * pixel of the fill wrong, and nothing reported. So a host object becomes its
     * captured bytes here, at the moment it is observed, a nested produced value
     * is copied with the mutations it has here, and every number is rounded here.
     *
     * What is deferred is only WHERE those bytes and that recipe land in a
     * recording's tables, which is not knowable until something uses the value:
     * the value may be older than any recording, and a source a recipe names
     * belongs in the image table only once something draws with it.
     */
    portable(value, depth, walk) {
      if (walk !== undefined) walk.spent += 1;
      if (typeof value === "number") return round(value);
      if (isPrimitive(value)) return value;
      if (typeof value !== "object") return { $opaque: opaqueName(value) };

      const subject = this.unwrap(value);
      const recipe = this.recipes.get(subject);
      if (recipe !== undefined) return this.produced(recipe);
      const matrix = matrixInit(subject);
      if (matrix !== null) return matrix;
      const bytes = this.captureBytes(subject);
      if (bytes !== null) return bytes;

      return this.encodeData(subject, depth, walk, (entry, next, scope) =>
        this.portable(entry, next, scope),
      );
    }

    /**
     * A produced value as of now: the recipe it has so far, copied.
     *
     * Copied rather than referred to, because the recipe goes on growing and this
     * is the answer to "what did the value hold at THIS moment". It is also what
     * makes a value that names itself terminate: a step whose argument is the value
     * the step is being added to holds the copy taken before that step existed, so
     * the nesting is finite and needs no re-entrancy guard around it.
     *
     * A recipe past {@link RECIPE_STEPS} can no longer be completed, so the value
     * is the marker every other unencodable value gets.
     */
    produced(recipe) {
      if (recipe.overflow) return { $opaque: recipe.name };
      return new ProducedValue(recipe.method, recipe.args, recipe.then.slice());
    }

    /**
     * A portable value as the RUNNING recording carries it.
     *
     * The second half: the bytes a source held when it was observed become an
     * entry in this recording's image pool, and a produced value copied inside a
     * recipe becomes an entry in its resource pool. Everything else was already in
     * the form the document holds.
     */
    fromPortable(value) {
      if (value === null || typeof value !== "object") return value;
      if (value instanceof CapturedBytes) {
        const at = this.poolImage(value.entry);
        return at === null ? { $opaque: value.name } : { $img: at };
      }
      if (value instanceof ProducedValue) return this.carryResource(value);
      if (Array.isArray(value)) {
        return value.map((entry) => this.fromPortable(entry));
      }
      const rebuilt = {};
      for (const key of Object.keys(value)) {
        Object.defineProperty(rebuilt, key, {
          value: this.fromPortable(value[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return rebuilt;
    }

    /**
     * A produced value in the resource pool, as the recipe that rebuilds it.
     *
     * Interned here rather than when the mutations arrived, because a recipe is
     * collected from the moment the context makes the value — which may be long
     * before any recording exists — and because `then` must be the steps applied
     * UP TO THIS USE. A gradient that is filled, given another colour stop, and
     * filled again is two resources, and each fill replays under the stops it
     * actually had; sharing one list between the two uses would paint the first
     * fill under a stop it never had.
     *
     * The list arrives already copied, so this terminates on its own: an argument
     * that names a produced value names the copy taken when that argument was
     * observed, and a copy taken then cannot contain the step that carries it.
     */
    carryResource(produced) {
      const entry = {
        make: {
          method: produced.method,
          args: produced.args.map((arg) => this.fromPortable(arg)),
        },
        then: produced.then.map((step) =>
          step.op === "call"
            ? {
                op: "call",
                method: step.method,
                args: step.args.map((arg) => this.fromPortable(arg)),
              }
            : {
                op: "set",
                property: step.property,
                value: this.fromPortable(step.value),
              },
        ),
      };
      return { $res: intern(this.resourcePool, this.resourceAt, entry) };
    }

    /** Add one mutation to a recipe, or mark it past the bound. */
    step(recipe, entry) {
      if (recipe.then.length >= RECIPE_STEPS) {
        recipe.overflow = true;
        return;
      }
      recipe.then.push(entry);
    }

    /**
     * Take charge of a value one of the four producing methods returned.
     *
     * The call itself is NOT an operation of the frame: it is the first line of
     * the returned value's recipe, and it reaches the recording only if and when
     * the value is used. A gradient nothing ever fills with is a gradient the
     * picture does not contain.
     */
    produce(result, method, args) {
      if (this.recipes.get(result) === undefined) {
        this.recipes.set(result, {
          method,
          // Resolved before the call rather than at the use. `createPattern`
          // copies its source when it is called, so the picture that source held
          // then is the picture the pattern paints for the rest of its life.
          args,
          then: [],
          name: opaqueName(result),
          overflow: false,
        });
      }
      return this.wrap(result, true);
    }

    /**
     * Capture the pixels of a value a canvas can draw, and answer where they
     * live.
     *
     * `null` for a value that is not one, and for one that could not be captured:
     * a source that reports no size, a canvas tainted by a cross-origin image, or
     * a recording that has reached its budget. Every one of those degrades to an
     * opaque marker rather than propagating, because a recorder that threw here
     * would take down the frame it was watching. An operation's own arguments are
     * captured only while armed: turning a source into a PNG is orders of
     * magnitude slower than the draw call that used it, no reader of an idle frame
     * looks at pixels, and a suite drives tens of thousands of frames outside any
     * capture. A recipe's source is the exception, and {@link captureBytes} is
     * where it is taken.
     */
    captureImage(value) {
      if (this.frames === null) return null;
      const kind = kindOf(value);
      if (kind === null) return null;
      try {
        return this.capture(value, kind);
      } catch {
        return null;
      }
    }

    /**
     * The bytes of a value a canvas can draw, taken NOW and pooled by nobody.
     *
     * What {@link portable} captures a recipe's source with. It runs whether or
     * not the recorder is armed, because a pattern's source is copied at the
     * producing call and a build is free to make its patterns at startup: the
     * bytes are taken then or they are lost. Nothing else is captured while idle,
     * and a producing call is rare enough that this costs a run nothing.
     */
    captureBytes(value) {
      const kind = kindOf(value);
      if (kind === null) return null;
      try {
        const size = sourceSize(value);
        if (size === null) return null;
        const entry = this.bytesOf(value, kind, size);
        return entry === null
          ? null
          : new CapturedBytes(entry, opaqueName(value));
      } catch {
        return null;
      }
    }

    /**
     * Whether a NEW capture is past one of the two ceilings.
     *
     * Two of them, because they bound two different things:
     * {@link CAPTURE_BUDGET} the bytes ONE recording's document will hold, and
     * {@link SESSION_BUDGET} the bytes this page has turned into PNGs across every
     * recording it has driven. Either one reached refuses a new entry, and leaves
     * everything already pooled resolving.
     */
    get overBudget() {
      return (
        this.captured >= CAPTURE_BUDGET ||
        this.sessionCaptured >= SESSION_BUDGET
      );
    }

    /**
     * Put one captured entry in the image pool, and answer where it lives.
     *
     * A budget refuses a NEW entry rather than the capture, so a source whose
     * bytes the recording already holds keeps resolving after a ceiling is
     * reached — which is what makes the degradation past it partial rather than
     * total.
     */
    poolImage(entry) {
      const key = imageKey(entry);
      let at = this.imageAt.get(key);
      if (at === undefined) {
        if (this.overBudget) return null;
        at = this.imagePool.length;
        this.imagePool.push(entry);
        this.imageAt.set(key, at);
      }
      this.use(at);
      return at;
    }

    /**
     * Capture one source, reusing what is already pooled where that is honest.
     *
     * A fixed source is looked up against the identity it had when it was
     * captured — for an image element, the file it points at and the size that
     * file has — so it is drawn once however many frames blit it, and re-pointing
     * one captures again. A source whose content can change is drawn at every use
     * and shared on the bytes it produced, which is the only way to tell a
     * repainted canvas from one that was left alone.
     */
    capture(value, kind) {
      const size = sourceSize(value);
      if (size === null) return null;
      const mutable =
        kind === "pixels" ||
        MUTABLE_SOURCES.some((name) => isHostInstance(value, name));

      // PAST A CEILING, A MUTABLE SOURCE IS REFUSED BEFORE IT IS ENCODED. It is
      // the one kind of source least likely to be already pooled — it is
      // re-captured at every use precisely because its content may have changed —
      // so encoding it to find out is paying the most expensive operation the
      // recorder has for an answer that is thrown away. Until this, a build past
      // its budget paid a full-screen `drawImage` and `toDataURL` on every blit of
      // every remaining frame of the section. The budget now bounds the WORK as
      // well as the bytes, and what a refusal degrades to is the opaque marker the
      // format already defines.
      if (mutable && this.overBudget) return null;

      const named = mutable ? "" : identity(value, size);
      if (!mutable) {
        const seen = this.fixedImages.get(value);
        if (seen !== undefined && seen.key === named) {
          // A refusal is remembered as well as a capture — see below.
          if (seen.index === null) return null;
          this.use(seen.index);
          return seen.index;
        }
      }

      const entry = this.bytesOf(value, kind, size);
      if (entry === null) return null;
      const at = this.poolImage(entry);
      if (at === null) {
        // A FIXED source the budget turned down is remembered as refused, under
        // the identity it was refused for. A fixed source cannot be refused for
        // having changed — its identity is what it was looked up by — so asking
        // again on the next draw could only encode the same bytes to reach the
        // same no, once per blit for the rest of the section. Re-pointing the
        // source changes its identity and asks again, which is exactly the rule a
        // capture is remembered under.
        if (!mutable) this.fixedImages.set(value, { key: named, index: null });
        return null;
      }
      if (!mutable) this.fixedImages.set(value, { key: named, index: at });
      return at;
    }

    /**
     * One source as the recording carries it, or null if there is no way to take
     * it.
     *
     * A bitmap travels as a PNG data URL, drawn through the scratch canvas. An
     * `ImageData` travels as its OWN RGBA bytes and never touches a canvas,
     * because the canvas round trip a PNG needs is lossy: drawing an image into a
     * canvas premultiplies each colour channel by the pixel's alpha and reading
     * the pixels back un-premultiplies them, so a partially transparent pixel is
     * quantized to eight bits twice and comes back a different colour. An
     * `ImageData` is the one kind of image a check compares byte for byte, so it
     * is carried byte for byte — exact by construction, and rebuilt without a
     * decoder.
     */
    bytesOf(value, kind, size) {
      if (kind === "pixels") {
        return {
          kind,
          width: size.width,
          height: size.height,
          data: base64(value.data),
        };
      }
      const ctx = this.scratchContext(size);
      if (ctx === null) return null;
      ctx.drawImage(value, 0, 0, size.width, size.height);
      const url = ctx.canvas.toDataURL("image/png");
      return typeof url === "string"
        ? { kind, width: size.width, height: size.height, src: url }
        : null;
    }

    /**
     * The scratch context, sized for this capture.
     *
     * Built once and resized per capture rather than built per capture: resizing
     * a canvas also blanks it, which is exactly the preparation each capture
     * needs, and a build that blits a sprite a hundred times a frame would
     * otherwise churn a hundred canvases. The resize is also what recovers from a
     * cross-origin source, which taints the bitmap it was drawn into until that
     * bitmap is replaced.
     */
    scratchContext(size) {
      if (this.scratch === undefined) {
        const canvas = document.createElement("canvas");
        // Through the native accessor, so this stays a plain context rather than
        // becoming a recorder of its own.
        const ctx = nativeGetContext.call(canvas, "2d");
        this.scratch = ctx ?? null;
      }
      const ctx = this.scratch;
      if (ctx === null) return null;
      ctx.canvas.width = size.width;
      ctx.canvas.height = size.height;
      return ctx;
    }

    /**
     * One operation in the SELF-CONTAINED form, or null where nothing needs one.
     *
     * Built whenever a frame is open, because that is what `frameCalls` reads and
     * it must not depend on a capture running, and built for a path or clip call
     * even with no frame open, because those shadows are facts about the context
     * that outlive any one frame. Anything else with no frame open is an operation
     * no reader will ask for, and describing its arguments would be the whole cost
     * of recording it.
     */
    describeCall(name, args) {
      if (this.calls === null && !PATH_SHADOW.has(name)) return null;
      return {
        op: "call",
        method: name,
        args: args.map((arg) => this.describeArg(arg)),
      };
    }

    /**
     * Record one operation of the frame, in both the forms a reader needs.
     *
     * Called after the shadows have been brought up to date, so a paint that
     * follows a canvas resize is measured against the state the reset left rather
     * than the one it discarded. Both forms of its arguments were taken before the
     * build's call ran, by {@link resolveCall}.
     */
    recordCall(name, resolved) {
      // Counted HERE rather than in {@link observePaint}, because this runs
      // whether or not a frame is open and that is the whole point of it: a
      // surface no frame is driven on still draws, and whether it has ever drawn
      // anything is what decides whether the selection rule may follow a blit to
      // it.
      if (PAINTING.has(name)) this.painted += 1;
      if (resolved.described !== null && this.calls !== null) {
        this.calls.push(resolved.described);
      }
      if (this.pending === null || resolved.encoded === null) return;
      // Before the operation, so the recording states what the context is about to
      // paint with rather than what it was last told to paint with.
      if (PAINTERS.has(name)) this.correct();
      this.pending.push({ op: "call", method: name, args: resolved.encoded });
    }

    /** Record one assignment to the context, in both forms. */
    recordSet(property, raw) {
      // Before the early return: an assignment made outside a driven frame moves
      // the state the next frame inherits, whether or not anything records it.
      this.carry();
      if (this.calls === null) return;
      this.calls.push({ op: "set", property, value: this.describeArg(raw) });
      if (this.pending !== null) {
        this.pending.push({ op: "set", property, value: this.encodeArg(raw) });
      }
      // Noted whether or not the recording holds the assignment: what the property
      // holds is a fact about the context, and the next frame's paints are
      // measured against it.
      this.note(property, raw);
    }

    /**
     * Keep the shadows of the state no context reports.
     *
     * `save` and `restore` carry the whole state, clip included, and a build is
     * free to split them across a frame boundary — so the stack is kept here and
     * every frame names what was on it. A clip cannot be read back at all, so a
     * `clip()` appends the path it was applied to, the call itself, and the
     * transform in force to the region already established, because clips
     * intersect rather than replace and a clip path is given in user space.
     */
    shadow(name, op) {
      // Every shadowed operation reads the backing store size first: a resize
      // between the last one and this one threw all three shadows away, and
      // folding this operation into a stale one describes a context that no longer
      // exists.
      this.checkSurface();
      switch (name) {
        case "save":
          this.saved.push({
            state: this.readState(),
            clip: this.clip,
            // Copied, so a correction recorded inside the save leaves what the
            // outer state was stated as alone. An empty map is the common case and
            // is worth no allocation at all.
            emitted: this.emitted.size === 0 ? null : new Map(this.emitted),
          });
          // The outermost entry goes when the stack is deeper than the format
          // carries. A `restore()` pops the innermost first, so the levels a build
          // can still return to exactly are the ones kept — and the frame that
          // inherited the shortened stack says it was shortened.
          if (this.saved.length > STACK_MAX) {
            this.saved.shift();
            this.stackTruncated = true;
          }
          break;
        case "restore": {
          const top = this.saved.pop();
          if (top === undefined) break;
          // The rest of the state is read back from the context; the clip is the
          // one part a `restore()` undoes that nothing can be asked about
          // afterwards. A restored style property holds the reference it was saved
          // with, so what the recording last said about it is restored beside the
          // clip. The path is outside the saved state and survives both.
          this.clip = top.clip;
          this.emitted = top.emitted === null ? new Map() : top.emitted;
          break;
        }
        case "reset":
          this.saved.length = 0;
          this.stackTruncated = false;
          this.clip = emptyShadow();
          this.path = emptyShadow();
          this.emitted = new Map();
          // As for a canvas resize: what was put aside for the next frame names
          // shadows this reset threw away, so the next frame reads the context.
          this.carried = null;
          // Unlike a resize, a `reset()` keeps the operations before it — they
          // are replayed and then reset away, as they were — but the state the
          // frame reports as inherited is what the rest of the frame runs under.
          if (this.calls !== null) this.inherited = inheritedState(this.target);
          break;
        case "beginPath":
          // The `beginPath` itself is kept, so a segment replays against whatever
          // path the segment before it left behind exactly as it did originally.
          this.path = emptyShadow();
          if (op !== null) this.extend(this.path, op);
          break;
        case "clip": {
          if (op === null) break;
          // A clip is carried whole or not at all, and what it costs is the whole
          // of the path in force plus the `clip` call that takes it — so the region
          // it would leave behind is measured against the bound before any of it is
          // taken. Refusing only once the region had already reached the bound
          // would let a clip taken from just under it carry the shadow to very
          // nearly twice {@link SHADOW_OPS}, which is the bound the format states
          // and a player reads. Past it the region in force stands as it is and the
          // frame says it was cut down: half a clip path is a region the build never
          // had, and a path whose own operations the bound already refused is half a
          // path.
          if (
            this.clip.ops + this.path.ops + 1 > SHADOW_OPS ||
            this.path.truncated
          ) {
            this.clip = {
              segments: this.clip.segments,
              ops: this.clip.ops,
              truncated: true,
            };
            break;
          }
          // Clips intersect rather than replace, so the region in force is every
          // segment applied in turn. The path the clip was cut from travels with
          // it, COPIED, because the buffer it came from goes on growing — a clip
          // does not clear the current path, and a build is free to clip and then
          // fill the same shape.
          const cut = {
            segments: this.copySegments(this.path.segments),
            ops: this.path.ops,
            truncated: this.path.truncated,
          };
          this.extend(cut, op);
          // A whole new structure, because the one it replaces is what every entry
          // of the save stack taken before now holds.
          this.clip = {
            segments: [...this.clip.segments, ...cut.segments],
            ops: this.clip.ops + cut.ops,
            truncated: this.clip.truncated || cut.truncated,
          };
          break;
        }
        default:
          if (PATH_METHODS.has(name) && op !== null) {
            this.extend(this.path, op);
          }
      }
    }

    /**
     * Keep track of whether this frame is a PASS-THROUGH of another surface.
     *
     * ONE SLOT, NOT A TALLY. Everything a frame paints before an OPAQUE blit that
     * covers the whole backing store is overpainted by that blit, so the only
     * question worth carrying is what the frame's LAST painting call was. A frame
     * whose last paint is a full-surface `drawImage` from a canvas the recorder
     * also tracks drew nothing of its own that survived, and the drawing a
     * reviewer wants is on the other side of that blit — which is what `choose()`
     * in the installation block follows. "Opaque" is doing real work in that
     * sentence and {@link passThroughSource} is where it is established: a canvas
     * source is RGBA, and a translucent or composited full-rect blit leaves every
     * one of the frame's own paints showing.
     *
     * Every other painting call clears the slot. So a build that draws its game
     * straight onto its canvas never states a pass-through however many sprites it
     * blits along the way, and the surface such a build binds to is byte for byte
     * the one it bound to before any of this existed.
     */
    observePaint(name, args) {
      // Only a driven frame has an answer to give, and only the surfaces
      // `driven()` names have a frame open at all.
      if (!this.insideFrame) return;
      // Sets, transforms and path operations put no pixels anywhere: a frame is
      // still whatever it last PAINTED.
      if (!PAINTING.has(name)) return;
      this.blit = name === "drawImage" ? this.passThroughSource(args) : null;
    }

    /**
     * The tracked entry this `drawImage` copies over the whole surface, or null.
     *
     * Five conditions, and the order they are tested in is deliberate: the cheap,
     * refusing ones first, because {@link readTransform} allocates a `DOMMatrix`
     * and this runs on every blit of every driven frame. A build with no
     * tracked-canvas source among its sources never reads a transform here at all.
     *
     *   1. THE SOURCE IS ANOTHER TRACKED SURFACE. An `<img>`, a video, an
     *      `ImageBitmap` and an `OffscreenCanvas` are none of them tracked, so an
     *      ordinary sprite blit can never be mistaken for a pass-through; and a
     *      surface blitting ITSELF — which is how a build draws trails — is not
     *      another surface, so it is refused by the same line.
     *   2. THE SOURCE IS DRAWING NOW. Not "has ever drawn": {@link painted} is a
     *      page-lifetime tally, and a surface painted once at load — a sprite
     *      atlas, a pre-rendered background layer, a static scanline overlay —
     *      would satisfy that forever while having nothing whatever to record.
     *      Binding to one answers `frameCalls()` with an empty list for a build
     *      that is drawing correctly, which is the very failure this rule exists to
     *      remove, so the question asked is whether the source has painted since
     *      THIS driven frame opened ({@link paintedAtFrame}, taken across every
     *      tracked surface at each frame boundary). A build's real offscreen stage
     *      is repainted every frame by construction; a layer that has gone static
     *      is not followed, and the recording stays on the surface the player sees.
     *   3. THE BLIT REPLACES RATHER THAN COMPOSITES. A canvas is RGBA, so a
     *      full-surface `drawImage` from one does NOT necessarily overpaint what
     *      the frame drew before it — and the whole correctness argument for this
     *      rule is that it does. A translucent lighting pass, a rain or CRT
     *      overlay, a damage tint, a `"lighter"` bloom: each is a full-rect blit of
     *      a tracked canvas under which the game's own text and sprites remain
     *      perfectly visible. Only `source-over` at full alpha (or `copy`, which
     *      replaces the destination outright) may be followed; anything else is a
     *      composite and the frame's earlier paints demonstrably survive it.
     *   4. NO CLIP IS IN FORCE. The coverage test below compares the destination
     *      rectangle against the backing store, and a clip region is invisible to
     *      it: a whole-surface rectangle drawn inside a 40x30 minimap box reads as
     *      covering the surface while touching one part in seventy of it. The
     *      recorder already shadows the clip, so a clipped blit is refused rather
     *      than measured — the same failure direction as conjunct 6.
     *   5. THE DESTINATION RECTANGLE IS READABLE. `drawImage` takes three, five or
     *      nine arguments and nothing else, and every number of the rectangle has
     *      to be finite for the comparison below to mean anything.
     *   6. THE TRANSFORM IS AXIS-ALIGNED. A rotated or skewed blit is not a
     *      letterbox pass-through, and refusing it keeps the coverage test EXACT
     *      rather than approximate. A context with no `getTransform` refuses for
     *      the same reason: without it there is nothing to place the rectangle
     *      with, and a guess would be a surface bound on no evidence.
     *   7. THE RECTANGLE COVERS THE BACKING STORE. No epsilon and no slack. A blit
     *      that leaves so much as a bar of this surface showing left something of
     *      this surface's own on the screen, and the rule then declines rather than
     *      binding to a surface that is only most of the picture. That is the
     *      deliberate failure direction, and it has a cost worth naming: a build
     *      that genuinely letterboxes — real bars, a non-zero offset — is recorded
     *      exactly as badly as it is today. It is refused rather than followed
     *      because every relaxation that admits it also admits a build that renders
     *      a static background layer offscreen, blits it, and draws its whole game
     *      in `fillRect`s on top — and that build would be bound to its background.
     *
     * Nothing here may throw. It runs inside the recorder's own guard, but a throw
     * there costs the operation its entire description, and reading a build's
     * exotic argument is not worth a missing operation.
     */
    passThroughSource(args) {
      try {
        const length = args.length;
        if (length !== 3 && length !== 5 && length !== 9) return null;
        const entry = byCanvas.get(args[0]);
        if (entry === undefined || entry.recorder === this) return null;
        // Painted DURING this frame, not ever — see conjunct 2. `paintedAtFrame`
        // is the source's tally as this driven frame opened.
        if (entry.recorder.painted <= entry.recorder.paintedAtFrame)
          return null;

        // Both are tracked state properties and both are direct reads off the
        // context, so this stays on the cheap side of the `DOMMatrix` the
        // transform read below allocates.
        const composite = this.target.globalCompositeOperation;
        if (composite !== "source-over" && composite !== "copy") return null;
        if (this.target.globalAlpha !== 1) return null;

        // The shadow the recorder already keeps, rather than a question put to the
        // context — a clip region cannot be read back out of a 2D context at all.
        // `truncated` is a clip the shadow gave up describing, which is exactly a
        // clip whose extent is unknown.
        if (this.clip.ops > 0 || this.clip.truncated) return null;

        let dx = args[1];
        let dy = args[2];
        let dw;
        let dh;
        if (length === 3) {
          // The three-argument form draws the source at its natural size, which is
          // the only place the destination extent is not written down.
          const size = sourceSize(args[0]);
          if (size === null) return null;
          dw = size.width;
          dh = size.height;
        } else if (length === 5) {
          dw = args[3];
          dh = args[4];
        } else {
          dx = args[5];
          dy = args[6];
          dw = args[7];
          dh = args[8];
        }
        if (
          !Number.isFinite(dx) ||
          !Number.isFinite(dy) ||
          !Number.isFinite(dw) ||
          !Number.isFinite(dh)
        ) {
          return null;
        }

        const transform = this.readTransform();
        if (transform === null) return null;
        const [a, b, c, d, e, f] = transform;
        if (b !== 0 || c !== 0) return null;
        // A read-back transform carries a non-finite term through unchanged —
        // rounding refuses those rather than inventing a number — and every term
        // here is arithmetic the comparison below depends on.
        if (!Number.isFinite(a) || !Number.isFinite(d)) return null;
        if (!Number.isFinite(e) || !Number.isFinite(f)) return null;

        // Read off the ELEMENT rather than from `this.surface`, which is a
        // fallback for canvases the accessors could not be installed on, is null
        // until something has been shadowed, and which {@link resolveCall} runs one
        // operation ahead of.
        const canvas = this.target.canvas;
        const width = canvas === null ? undefined : canvas.width;
        const height = canvas === null ? undefined : canvas.height;
        if (typeof width !== "number" || typeof height !== "number")
          return null;
        if (width < 1 || height < 1) return null;

        // The destination rectangle in device space. A negative scale flips it, so
        // the edges are ordered before they are compared.
        const left = a * dx + e;
        const top = d * dy + f;
        const right = left + a * dw;
        const bottom = top + d * dh;
        if (Math.min(left, right) > 0 || Math.min(top, bottom) > 0) return null;
        if (Math.max(left, right) < width) return null;
        if (Math.max(top, bottom) < height) return null;
        return entry;
      } catch {
        // A source that refuses to be looked at is a source nothing can be
        // followed through.
        return null;
      }
    }

    /**
     * Every form of one call's arguments the recorder needs, taken BEFORE the
     * build's call runs.
     *
     * `ctx.drawImage(ctx.canvas, …)` — an ordinary trails or feedback blit — names
     * the very surface it is about to draw over, so bytes read after the call are
     * the bytes the blit produced and the replay composites the picture on top of
     * itself. An argument is worth what it held when the call was given it, so
     * every reading of one is taken here and the call below is handed the answers.
     *
     * A mutation of a produced value and a producing call both want the portable
     * form, for the same reason in the other direction: `createPattern` copies its
     * source at the call.
     */
    resolveCall(resource, name, args) {
      if (resource || PRODUCERS.has(name)) {
        return { steps: args.map((arg) => this.portableArg(arg)) };
      }
      // Taken before the call, which is what makes the state put aside the one the
      // last driven frame left rather than the one this call is about to leave.
      this.carry();
      // Here rather than in {@link observe}, because this is the one place the RAW
      // arguments are — in issue order, exactly once per call, before the context
      // has had a chance to change what any of them holds. The described form is
      // no use for it: a canvas source describes as `{ $opaque: ... }`, which says
      // that a picture was blitted and nothing whatever about which surface it came
      // from.
      this.observePaint(name, args);
      return {
        described: this.describeCall(name, args),
        // Nothing is pooled with no recording running: interning is the expensive
        // half, and turning a source into a PNG is orders of magnitude slower than
        // the draw call that used it.
        encoded:
          this.pending === null ? null : args.map((arg) => this.encodeArg(arg)),
      };
    }

    /**
     * Record what one call through a wrapper did.
     *
     * A call on a value the context produced is a line of that value's recipe,
     * held unencoded until the value is used. A producing call is neither an
     * operation nor, when it answers `null`, a resource: `createPattern` handed a
     * source it cannot use answers `null`, and that `null` travels as itself.
     * Every other call on the context is an operation of the frame.
     */
    observe(subject, resource, name, result, resolved) {
      if (resource) {
        const recipe = this.recipes.get(subject);
        // A recipe that is gone is a value whose wrapper outlived the value; the
        // mutation was never an operation of the context, and a player asked to
        // issue `addColorStop` against a canvas has nothing it can do with it.
        if (recipe !== undefined) {
          this.step(recipe, {
            op: "call",
            method: name,
            args: resolved.steps,
          });
        }
        return result;
      }
      if (PRODUCERS.has(name)) {
        if (result === null || typeof result !== "object") return result;
        return this.produce(result, name, resolved.steps);
      }
      // Shadowed first: the operation is recorded against a context the recorder
      // has already noticed the resize of.
      this.shadow(name, resolved.described);
      this.recordCall(name, resolved);
      return result;
    }

    /**
     * Wrap the context, or a value it produced.
     *
     * `resource` is what the two wrappers differ by, and it is exactly the
     * distinction an operation carries: a call on the context is an operation of
     * the frame, and a call on a value the context handed out is a line of that
     * value's recipe.
     *
     * Recording is guarded at every trap. The build's own call and the build's
     * own assignment happen unconditionally and their result is handed back
     * unconditionally, so the pixels a build draws are the same whether or not
     * anything is being captured — and stay the same for a value nothing can
     * encode.
     */
    wrap(object, resource) {
      const cached = this.wrappers.get(object);
      if (cached !== undefined) return cached;
      const self = this;
      const methods = resource ? new Map() : this.methods;
      const proxy = new Proxy(object, {
        get(subject, property) {
          const value = Reflect.get(subject, property, subject);
          // A value the recorder tracks comes back wrapped. `ctx.fillStyle` is a
          // read-back of the gradient the build assigned, and a colour stop added
          // through that read is a mutation like any other — handing over the raw
          // value would make every one of them invisible and paint the replay
          // under the stops the assignment happened to have.
          if (typeof value !== "function") return self.tracked(value);
          const name = String(property);
          const cachedMethod = methods.get(name);
          if (cachedMethod !== undefined) return cachedMethod;
          const method = (...args) => {
            // Arguments are unwrapped on the way in and encoded from the
            // unwrapped values: a build that passes back a gradient passes the
            // wrapper it was handed, and a native method refuses a proxy where it
            // expects one of its own objects.
            const real = args.map((a) => self.unwrap(a));
            // Read BEFORE the call: an argument is worth what it held when the
            // call was given it, and a blit whose source is its own destination
            // holds something else the moment the call returns.
            let resolved = null;
            try {
              resolved = self.resolveCall(resource, name, real);
            } catch {
              /* the recorder never changes what a build draws */
            }
            // Applied to the real subject, never to the proxy: a native canvas
            // method called with a proxy as its receiver throws, because the
            // internal slots it needs are on the object itself.
            const result = value.apply(subject, real);
            if (resolved === null) return result;
            try {
              return self.observe(subject, resource, name, result, resolved);
            } catch {
              return result;
            }
          };
          methods.set(name, method);
          return method;
        },
        set(subject, property, value) {
          // The recorded value is encoded before the assignment rather than
          // after, because a context normalizes what it is given — a colour
          // written as `#fff` reads back as `#ffffff` — and the recording states
          // what the build did, not what the context made of it.
          const real = self.unwrap(value);
          try {
            const name = String(property);
            if (resource) {
              const recipe = self.recipes.get(subject);
              if (recipe !== undefined) {
                self.step(recipe, {
                  op: "set",
                  property: name,
                  value: self.portableArg(real),
                });
              }
            } else {
              self.recordSet(name, real);
            }
          } catch {
            /* the recorder never changes what a build draws */
          }
          return Reflect.set(subject, property, real, subject);
        },
      });
      this.wrappers.set(object, proxy);
      // The wrapper is registered against itself as well, so a value that reaches
      // the recorder already wrapped is not wrapped a second time, and against the
      // object it stands for, so a wrapper handed back to the context is unwrapped
      // again.
      this.wrappers.set(proxy, proxy);
      this.unwrapped.set(proxy, object);
      return proxy;
    }

    /**
     * The wrapper for a value the recorder tracks, or the value itself.
     *
     * What a read off the context hands back. A build that reads `ctx.fillStyle`
     * and mutates what it gets is mutating a value the recording carries as a
     * recipe, and only the wrapper sees that.
     */
    tracked(value) {
      try {
        if (value === null || typeof value !== "object") return value;
        return this.recipes.has(value) ? this.wrap(value, true) : value;
      } catch {
        // A value that refuses a weak lookup is a value nothing tracks.
        return value;
      }
    }

    unwrap(value) {
      if (value === null || typeof value !== "object") return value;
      const real = this.unwrapped.get(value);
      return real !== undefined ? real : value;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Installation                                                     */
  /* ---------------------------------------------------------------- */

  const entries = []; // { canvas, raw, recorder }

  /**
   * The entry each tracked canvas belongs to.
   *
   * The same set `entries` holds, keyed for lookup. The selection rule below asks
   * "is the source of this `drawImage` a surface I am also recording?" once per
   * blit of every driven frame, and answering that by scanning `entries` would
   * make the question cost the number of canvases the page has ever made — which
   * on a build that keeps dozens of small effect surfaces is the wrong shape
   * entirely.
   *
   * ONLY `HTMLCanvasElement` IS IN IT. `OffscreenCanvas.prototype.getContext` is
   * not patched, so an offscreen surface is not tracked, cannot be followed, and a
   * build that renders into one and blits it is recorded as the blit — the same
   * answer it got before any of this. Patching it too is coherent and is
   * deliberately not done here: `isConnected` and "the largest attached canvas"
   * have no meaning for a surface that is in no document, so it needs a selection
   * rule of its own rather than a wider `entries`.
   */
  const byCanvas = new Map();

  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = nativeGetContext.call(this, type, ...rest);
    if (type !== "2d" || ctx === null) return ctx;
    const existing = entries.find((e) => e.raw === ctx);
    if (existing) return existing.recorder.context;
    const recorder = new ContextRecorder(ctx);
    const entry = { canvas: this, raw: ctx, recorder };
    entries.push(entry);
    byCanvas.set(this, entry);
    return recorder.context;
  };

  /**
   * The largest canvas ATTACHED to the document.
   *
   * The surface a build shows the player. It is where the search starts and, for
   * every build that draws its game straight onto its canvas, where it ends.
   */
  function largestAttached() {
    let best = null;
    let bestArea = -1;
    for (const entry of entries) {
      const area = (entry.canvas.width || 0) * (entry.canvas.height || 0);
      const score = entry.canvas.isConnected ? area : -1;
      if (score > bestArea) {
        bestArea = score;
        best = entry;
      }
    }
    return best;
  }

  /**
   * The one surface a recording is about: the surface the game is DRAWN on.
   *
   * The engine records the context it handed the game and nothing a game drew to
   * a scratch surface of its own, so this makes the same cut rather than
   * interleaving two surfaces into one operation list.
   *
   * WHY THIS IS NOT SIMPLY THE LARGEST ATTACHED CANVAS, WHICH IS WHAT IT WAS. That
   * rule rested on the assumption that a build's own surfaces are "smaller and
   * unattached". The ordinary letterboxed pattern breaks it outright: a build
   * renders the whole game into a design-sized canvas it NEVER attaches, and blits
   * that one canvas onto the visible one each frame. Every frame the recorder then
   * held was a transform, a background fill and one `drawImage` — so `frameCalls()`
   * reported no text, no sprites and no shapes however correct the game was, and
   * every check reading the operation list failed while the pixel checks in the
   * same suite passed. That split is the signature. It cost one measured run some
   * thirty false failures, and — because a canvas source is re-rasterized to a PNG
   * at every use — 1.75 GB of recordings where a build drawing straight onto its
   * canvas produced 56 MB.
   *
   * SO THE RULE FOLLOWS THE PASS-THROUGH BLIT, ONE HOP. If the last painting call
   * of the candidate's last CLOSED frame was a `drawImage` that copied another
   * tracked, actively drawing surface OPAQUELY and UNCLIPPED over the whole of the
   * candidate's backing store, then that frame drew nothing of its own that
   * survived — everything painted before such a blit is overpainted by it — and the
   * drawing a reviewer wants is on the other side of it.
   * {@link ContextRecorder.observePaint} and
   * {@link ContextRecorder.passThroughSource} are where the observation is taken
   * and what all seven of its conditions are for; each of the three qualifiers in
   * that sentence is one of them, and each is load-bearing rather than defensive.
   * A composited overlay, a clipped minimap and a static pre-rendered layer are
   * all full-rect blits of a tracked canvas, and following any of them would
   * answer `frameCalls()` with the wrong surface — the same failure, in a
   * different shape, as the one this rule removes.
   *
   * WHY THAT CONDITION AND NOT A SCORE OVER WHAT EACH SURFACE DREW. Op counts
   * cannot separate a 1280x720 stage that issued four hundred operations from a
   * 128x128 particle field that issued four hundred, and a real build keeps dozens
   * of the latter — one reference in this repository keeps up to forty-eight, each
   * a tracked 2D context, each composited onto the visible canvas every frame. Any
   * tie-break on area or attachment there is a tuned constant, and a tuned constant
   * is a build losing points for being busy. "Covered the whole surface, last"
   * needs no threshold, is answered from the raw arguments in constant time, and is
   * CORRECT rather than merely discriminating: a frame that satisfies it provably
   * drew nothing a reviewer could have seen.
   *
   * WHY ONE HOP AND NEVER A CHAIN. The pattern this answers is a single
   * compositing indirection. Each further hop is a guess the evidence does not
   * support, and the one line that stops a chain is the same one that stops a
   * surface which somehow named itself.
   *
   * THE ANSWER IS ONE FRAME OLD, AND UNTIL THE FIRST FRAME CLOSES THERE IS NO
   * ANSWER AT ALL. This used to say that frames run between the arming gesture and
   * the opening reset, so a check always reaches a capture with the evidence
   * already taken. THAT WAS FALSE, and it cost about half of one measured run's
   * recordings. Nothing on the path from page load to a check's first capture
   * brackets a recorder frame: the recorder is in "manual" mode from installation
   * so the build's own animation frames close nothing, the surface probe, the
   * `setAutoStep`, the arming gesture's settle step and the opening `reset` all go
   * through the debug surface rather than through `begin`/`end`, and a check that
   * poses its scene with debug calls alone — `openScene`, `layFloor`, `standOn` —
   * drives no frame either. Such a check armed its capture with `lastBlit` null,
   * bound to the visible canvas, and recorded its whole section as the
   * pass-through. Which checks hopped and which did not came down to whether the
   * check happened to drive a frame before it armed.
   *
   * So this answers honestly — no evidence, no hop — and the two callers that
   * cannot live with "no answer yet" deal with it themselves: `driven()` opens the
   * blind frame on every tracked surface so that whichever one the evidence then
   * names has an operation list to answer with, and `arm()` DEFERS the binding to
   * the close of that frame. {@link ContextRecorder.settled} is what separates "no
   * evidence" from "the evidence says do not hop".
   */
  function choose() {
    const candidate = largestAttached();
    if (candidate === null) return null;
    const followed = candidate.recorder.lastBlit;
    return followed === null || followed === candidate ? candidate : followed;
  }

  /**
   * Whether the page has produced the evidence the selection rule reads.
   *
   * One closed frame on the surface the search starts from. Before that, `choose`
   * has nothing and everything below is in the blind window.
   */
  function evidenced() {
    const candidate = largestAttached();
    return candidate !== null && candidate.recorder.settled;
  }

  /**
   * The surface a running recording is about, held from `arm` to `disarm`.
   *
   * A recording belongs to ONE surface for its whole length. Re-deciding which
   * that is on every call would let a build that asks for a second 2D context
   * part-way through a section move the answer: the frames would be closed against
   * one recorder, `disarm()` would ask an idle one and answer `null`, and the
   * declared replay output would simply never turn up — a review point handed to a
   * reviewer with no evidence under it, and nothing said about why.
   *
   * The hop {@link choose} may take is decided at `arm` like everything else about
   * a recording: the question is asked once, and the surface it answers is the
   * surface the whole recording is about.
   */
  let bound = null;

  /** The surface the caller is recording, or the best candidate before one is. */
  function primary() {
    return bound !== null ? bound : choose();
  }

  /**
   * A recording started before the evidence existed, and every surface it might
   * still turn out to be. Null whenever the binding is settled.
   *
   * THE BLIND WINDOW. A capture can be armed before ANY frame has closed on the
   * page — which is not the corner case the old rule took it for but the ordinary
   * one, since a check that poses its scene through the debug surface drives no
   * frame at all before it arms. `choose()` has nothing to answer with there, and
   * pinning the visible canvas on the strength of it recorded a letterboxed build
   * as its own pass-through blit: five operations a frame, and a full-viewport PNG
   * of every one.
   *
   * So the question is asked one frame later instead, at the close of the first
   * frame the recording drives — the earliest instant an answer exists. THE
   * RECORDING STILL BELONGS TO ONE SURFACE, which is the invariant `bound` is for.
   * It is kept by starting the recording on every surface the answer could name
   * and keeping the one it does: each of them records the SAME first frame from
   * its own side, one is chosen before a second frame is ever driven, and the
   * losers are {@link ContextRecorder.abandon}ed without being built. No recording
   * ever changes surface mid-flight, `disarm()` hands back the surface its frames
   * were recorded on, and the frame that decided the binding is IN the recording
   * rather than spent on deciding it — which is what a capture that drives exactly
   * one frame needs, and what dropping the blind frame instead would have cost it.
   *
   * WHAT IT COSTS is one frame, once, per page: from the close of that frame the
   * candidate is {@link ContextRecorder.settled} and every later arm takes the
   * answer straight from `choose()`. That is the whole reason this is affordable
   * where recording every surface EVERY frame is not.
   */
  let awaiting = null;

  /** The recorder for the primary surface, or null before one exists. */
  function recorderOf() {
    const entry = primary();
    return entry === null ? null : entry.recorder;
  }

  /**
   * The recorders a driven frame is opened and closed on.
   *
   * The surface being recorded, and — when that surface was reached by FOLLOWING a
   * blit — the attached surface the blit was seen on.
   *
   * The second one is what keeps the decision honest. Frames are opened and closed
   * on the primary alone, and the observation {@link choose} reads is taken inside
   * a frame; so a candidate the rule has just hopped away from would stop closing
   * frames, stop observing, and latch its last answer for the rest of the page. Go
   * on driving it and it goes on observing, so a build that stops compositing
   * through an offscreen stage is answered by the attached surface again on the
   * very next frame — and a build that starts is followed on the next one.
   *
   * It costs one short operation list per frame, which is exactly what a
   * pass-through frame IS. Opening a frame on every tracked recorder instead would
   * build tens of thousands of described operations per frame, on a build with
   * dozens of effect surfaces, for evidence nobody reads — which is why the ONE
   * frame below that does exactly that is bounded to the blind window and to
   * nothing else. Every frame after it is this pair.
   *
   * A frame on the candidate CHARGES NOTHING and grows no recording: it is not the
   * armed recorder, so its `endFrame` returns at the guard before a frame is
   * counted, kept, or charged against the capture budget.
   */
  function driven() {
    const chosen = primary();
    if (chosen === null) return [];
    // THE BLIND FRAME, and the one place every tracked surface is worth what it
    // costs. Until a frame has closed on the attached candidate there is no
    // evidence and `choose()` can only answer with the candidate itself — so a
    // frame opened on its answer alone leaves whichever surface the evidence names
    // one line later with no operation list at all. That is not a hypothetical:
    // `frameCalls()` is one driven frame and then a read, and read as the first
    // frame of a page it answered a perfectly correct build with nothing
    // whatsoever, because the read hopped to a stage the frame was never opened
    // on. Opening this ONE frame everywhere is what makes the answer readable the
    // instant it exists, whichever surface it turns out to be.
    //
    // It happens once per page — the close of this very frame settles the
    // candidate — which is why the cost argument against doing it every frame does
    // not reach it.
    if (!evidenced()) return entries.slice();
    const candidate = largestAttached();
    return candidate === null || candidate === chosen
      ? [chosen]
      : [candidate, chosen];
  }

  /**
   * Start the deferred recording on every surface the answer could name.
   *
   * Called with the recorders the blind frame is about to be opened on, which is
   * every tracked surface — so the set the binding is chosen from is exactly the
   * set the frame is recorded on, and the winner has a real frame of its own
   * however the decision goes.
   *
   * The recording `arm()` already started on the candidate is among them and is
   * not restarted: restarting it would empty pools it is about to fill.
   */
  function speculate(pair) {
    if (awaiting === null) return;
    for (const entry of pair) {
      if (awaiting.started.includes(entry)) continue;
      awaiting.started.push(entry);
      entry.recorder.start(awaiting.design);
    }
  }

  /**
   * Decide, at the close of the blind frame, which surface the recording is on.
   *
   * The evidence now exists — the frame that just closed on the candidate settled
   * it — so `choose()` answers for real. The surface it names keeps its frames and
   * becomes `bound` for the rest of the recording; every other speculation is
   * abandoned unbuilt.
   *
   * A surface `choose()` names that was NOT among them is a context the build
   * created and painted inside the blind frame itself. It has no frame of its own
   * to keep, so its recording starts here and its first kept frame is the next one
   * — the only shape in which this loses a frame, and one no build produces on
   * purpose.
   */
  function settleBinding() {
    if (awaiting === null) return;
    const { design, started } = awaiting;
    awaiting = null;
    const winner = choose();
    if (winner === null) {
      for (const entry of started) entry.recorder.abandon();
      return;
    }
    if (!started.includes(winner)) winner.recorder.start(design);
    for (const entry of started) {
      if (entry !== winner) entry.recorder.abandon();
    }
    bound = winner;
  }

  /**
   * Mark where every tracked surface's painting stood as a driven frame opens.
   *
   * The selection rule may only follow a blit to a surface that is DRAWING, and
   * the surface it would follow to is by construction one no frame is driven on —
   * so it cannot take that mark in its own `beginFrame`, and this takes it for
   * everything at once instead. A surface painted once at load and static ever
   * since then has a zero difference across every later frame and is never
   * followed, which is the whole point: binding to it would answer `frameCalls()`
   * with nothing at all for a build that is drawing perfectly well.
   *
   * One field written per tracked canvas per frame. The busiest reference in this
   * repository keeps some fifty of them, against the tens of thousands of
   * described operations a frame of it already builds.
   */
  function openObservation() {
    for (const entry of entries) {
      entry.recorder.paintedAtFrame = entry.recorder.painted;
    }
  }

  const state = {
    /** "manual" — the driver brackets each frame. "raf" — the loop does. */
    mode: "manual",
    /** Whether an animation frame currently has a frame open, in "raf" mode. */
    open: false,
    /**
     * The recorders the frame now open was opened on, or empty between frames.
     *
     * Held rather than asked for again at the close, because {@link driven} is
     * answered from the page as it is NOW and a build is free to attach a canvas
     * in the middle of a frame. A frame has to be closed on whatever it was opened
     * on, or a recorder is left with an operation list nothing will ever settle.
     */
    openPair: [],
    lastTs: 0,
    count: 0,
    timeMs: 0,
  };

  function surfaceOf(entry) {
    return { width: entry.canvas.width || 0, height: entry.canvas.height || 0 };
  }

  function tick(ts) {
    requestAnimationFrame(tick); // re-registered first, so this stays ahead of the page
    if (state.mode !== "raf") return;
    if (state.open) {
      const delta = ts - state.lastTs;
      state.count += 1;
      state.timeMs += delta;
      // ONE `info` for both: the pair is one driven frame observed on two
      // surfaces, not two frames, and a recording's counts and clock must not
      // depend on how many recorders happened to see it.
      const info = { count: state.count, timeMs: state.timeMs, deltaMs: delta };
      for (const entry of state.openPair) {
        entry.recorder.endFrame(info, surfaceOf(entry));
      }
      // After every close, so the evidence the decision reads is settled.
      settleBinding();
      state.open = false;
      state.openPair = [];
    }
    const pair = driven();
    if (pair.length === 0) return;
    state.lastTs = ts;
    openObservation();
    // Before the frames open, so a speculation records this frame from its start.
    speculate(pair);
    for (const entry of pair) entry.recorder.beginFrame();
    state.openPair = pair;
    state.open = true;
  }
  requestAnimationFrame(tick);

  window.__tcabRec = {
    /** Whether the page has created a 2D context yet. */
    ready: () => primary() !== null,

    /** Open a frame. Paired with {@link end}, around one driven frame. */
    begin() {
      const pair = driven();
      state.openPair = pair;
      openObservation();
      // Before the frames open, so a deferred recording holds this frame whichever
      // surface the close of it turns out to name.
      speculate(pair);
      for (const entry of pair) entry.recorder.beginFrame();
    },

    /** Close the frame `begin` opened, `deltaMs` of game time after it. */
    end(deltaMs) {
      // The pair the frame was OPENED on, so a canvas attached in the middle of a
      // driven frame cannot leave a recorder holding an operation list nothing
      // closes. An `end` with no `begin` before it falls back to the page as it is
      // now, which is what it always did and which each recorder answers by
      // returning at its own guard.
      const open = state.openPair.length > 0 ? state.openPair : driven();
      state.openPair = [];
      if (open.length === 0) return;
      state.count += 1;
      state.timeMs += deltaMs;
      // One `info` for both — see {@link tick}.
      const info = { count: state.count, timeMs: state.timeMs, deltaMs };
      for (const entry of open) {
        entry.recorder.endFrame(info, surfaceOf(entry));
      }
      // The evidence is settled by the closes above and by nothing else, so this
      // is the earliest instant a deferred binding can be decided.
      settleBinding();
    },

    /** Hand the frame boundary to the animation frame, or take it back. */
    setMode(mode) {
      state.mode = mode === "raf" ? "raf" : "manual";
      state.open = false;
      state.openPair = [];
    },

    /**
     * Every operation the last CLOSED frame issued, in order.
     *
     * Self-contained: the same list whether or not a capture was running, and
     * carrying no index into tables the caller does not have.
     */
    last() {
      const recorder = recorderOf();
      return recorder === null ? [] : recorder.lastOps;
    },

    /**
     * The font and the alignment, the transform and the smoothing flag the last
     * closed frame's operations BEGAN under, or null before any frame. What the
     * frame's own `set` and transform operations then move from. A reset inside
     * the frame drops the operations before it and takes this again, so it is
     * the state the operations `last()` answers with were issued from.
     */
    lastInherited() {
      const recorder = recorderOf();
      return recorder === null ? null : recorder.lastInherited;
    },

    /**
     * Begin keeping frames. `design` is the logical field and its background.
     *
     * The recording starts on `choose()`'s answer either way. What the evidence
     * decides is whether that answer is BINDING: with a closed frame behind it the
     * surface is settled here and now, and without one the recording is started on
     * the candidate as a speculation and the binding is deferred to the close of
     * the first frame it drives — see {@link awaiting}, which is where the whole
     * of that reasoning lives.
     */
    arm(design) {
      const entry = choose();
      if (entry === null) return false;
      // A deferred binding left over from an arm that was never disarmed belongs
      // to no recording anyone will ask for. Its speculations go away here rather
      // than staying armed for the rest of the page.
      if (awaiting !== null) {
        for (const held of awaiting.started) {
          if (held !== entry) held.recorder.abandon();
        }
        awaiting = null;
      }
      entry.recorder.start(design);
      if (evidenced()) {
        awaiting = null;
        bound = entry;
        return true;
      }
      bound = null;
      awaiting = { design: { ...design }, started: [entry] };
      return true;
    },

    /**
     * Stop keeping frames and hand back the recording.
     *
     * A capture disarmed while the binding is still deferred drove no frame at
     * all, so there is nothing to decide and nothing to decide it from: the
     * candidate's speculation is the recording — an empty one, which is what a
     * capture that drove no frames has always handed back — and the rest go away
     * unbuilt.
     */
    disarm() {
      let recorder = recorderOf();
      if (awaiting !== null) {
        // The one `arm` itself started, rather than whatever `choose()` answers
        // now: with no frame closed there is still no evidence, and a canvas the
        // build attached in between would otherwise move the answer onto an idle
        // recorder and lose the recording to `active`.
        const kept = awaiting.started[0];
        recorder = kept === undefined ? null : kept.recorder;
        for (const entry of awaiting.started) {
          if (entry.recorder !== recorder) entry.recorder.abandon();
        }
        awaiting = null;
      }
      bound = null;
      if (recorder === null || !recorder.active) return null;
      return recorder.stop();
    },

    /**
     * The RGBA bytes of a source an idle frame named, by its `$src` identity.
     *
     * For the review points that read a produced sprite's own pixels.
     */
    imagePixels(id) {
      return readImagePixels(id);
    },

    /** How many frames were closed while armed, before any decimation. */
    seen() {
      const recorder = recorderOf();
      return recorder === null ? 0 : recorder.seen;
    },
  };
})();
