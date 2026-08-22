/*
 * Carom — the injected draw-command recorder. CASE-PROVIDED.
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
 *   - Every frame carries the context state it inherited, so any frame can be
 *     drawn without drawing the frames before it. That is what lets the player
 *     seek, and what lets two recordings be scrubbed side by side in step.
 *   - Values the context hands back — a gradient, a pattern — are interned and
 *     wrapped, so calls made ON them are recorded against an id rather than lost.
 *   - Recording is bracketed by the frame and armed by the caller, so a check
 *     records the section its point is about and pays nothing for the setup.
 *
 * HOW A FRAME IS BRACKETED HERE. Under the engine the loop closes the frame it
 * just ran. Here the frame boundary belongs to whoever is driving: a check
 * running the game off its own clock calls `begin()` / `end(deltaMs)` around each
 * `__carom.advance(dt, 1)`, all inside one synchronous evaluation, so nothing the
 * page's own `requestAnimationFrame` renders can interleave with it. The one
 * check that lets the loop run in real time switches the recorder to `"raf"`
 * mode, where the animation frame closes the frame instead.
 *
 * DECIMATION HAPPENS HERE, NOT AFTERWARDS. A section driven for half a minute of
 * game time is thousands of frames of a couple of hundred operations each, and
 * every one of those would have to cross out of the page. So the kept set is
 * held at {@link KEEP_MAX} by doubling the stride as it fills: the whole section
 * at a lower frame rate, never its first few seconds at the full one. The harness
 * restates the deltas of what comes back, so the kept frames still sum to the
 * section's elapsed time.
 *
 * Exposed as `window.__caromRec`. Nothing here is ever seeded into a run.
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
   * The 2D context properties a frame inherits from the one before it: the whole
   * of the canvas state that survives a frame boundary, minus the transform and
   * the dash pattern, which are read through their own accessors.
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

  const isPrimitive = (v) =>
    v === null ||
    typeof v === "boolean" ||
    typeof v === "number" ||
    typeof v === "string";

  const opaqueName = (v) => {
    if (v === undefined) return "undefined";
    const proto = Object.getPrototypeOf(v);
    return (proto && proto.constructor && proto.constructor.name) || "object";
  };

  class ContextRecorder {
    constructor(target) {
      this.target = target;
      this.methods = new Map();
      this.interned = new WeakMap();
      this.wrappers = new WeakMap();
      this.unwrapped = new WeakMap();
      this.nextId = 0;
      /** The frames kept so far while armed, or null while idle. */
      this.frames = null;
      /** The operations of the frame currently open, or null between frames. */
      this.ops = null;
      this.pendingState = null;
      /** The operations of the last frame CLOSED, whether armed or not. */
      this.lastOps = [];
      /** How many frames have been closed while armed, before decimation. */
      this.seen = 0;
      /** One kept frame in every `stride` closed. */
      this.stride = 1;
      /** The last frame closed while armed, kept or not. */
      this.tail = null;
      this.design = { width: 0, height: 0, background: null };
      this.context = this.wrap(target);
    }

    get active() {
      return this.frames !== null;
    }

    start(design) {
      this.design = { ...design };
      this.frames = [];
      this.ops = null;
      this.seen = 0;
      this.stride = 1;
      this.tail = null;
    }

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
      this.frames = null;
      this.ops = null;
      this.tail = null;
      return {
        format: RECORDING_FORMAT,
        width: this.design.width,
        height: this.design.height,
        background: this.design.background,
        frames,
      };
    }

    /**
     * Open a frame.
     *
     * The inherited state is snapshotted here rather than at the close, because
     * it is the state the frame's own operations START from — which is exactly
     * what makes the frame independently drawable.
     *
     * A frame is opened whether or not the recorder is armed: the last closed
     * frame's operation list is what `frameCalls` reads, and a check that asks
     * what one frame drew is not recording a section.
     */
    beginFrame() {
      this.ops = [];
      this.pendingState = this.snapshotState();
    }

    endFrame(info, surface) {
      const ops = this.ops;
      const state = this.pendingState;
      this.ops = null;
      this.pendingState = null;
      if (ops === null || state === null) return;
      this.lastOps = ops;
      if (this.frames === null) return;

      const index = this.seen;
      this.seen += 1;
      const frame = {
        count: info.count,
        timeMs: info.timeMs,
        deltaMs: info.deltaMs,
        surface: { width: surface.width, height: surface.height },
        state,
        ops,
      };
      this.tail = frame;
      if (index % this.stride !== 0) return;
      this.frames.push(frame);
      if (this.frames.length >= KEEP_MAX) {
        // Halve what is held and take one in every two from here on, so the kept
        // set still covers the whole section rather than its opening.
        this.frames = this.frames.filter((_, i) => i % 2 === 0);
        this.stride *= 2;
      }
    }

    snapshotState() {
      const target = this.target;
      const properties = {};
      for (const name of STATE_PROPERTIES) {
        try {
          const value = target[name];
          if (value === undefined) continue;
          properties[name] = this.encode(value);
        } catch {
          /* absent or unreadable: omit */
        }
      }
      let transform = null;
      try {
        const m = this.target.getTransform();
        transform = [m.a, m.b, m.c, m.d, m.e, m.f];
      } catch {
        /* no getTransform */
      }
      let lineDash = null;
      try {
        lineDash = [...this.target.getLineDash()];
      } catch {
        /* no getLineDash */
      }
      return { properties, transform, lineDash };
    }

    encode(value) {
      if (isPrimitive(value)) return value;
      if (typeof value === "object") {
        const id = this.interned.get(value);
        if (id !== undefined) return { $ref: id };
        if (Array.isArray(value)) return value.map((e) => this.encode(e));
        const proto = Object.getPrototypeOf(value);
        if (proto === Object.prototype || proto === null) {
          const encoded = {};
          for (const [k, e] of Object.entries(value)) {
            encoded[k] = this.encode(e);
          }
          return encoded;
        }
      }
      return { $opaque: opaqueName(value) };
    }

    push(op) {
      if (this.ops) this.ops.push(op);
    }

    intern(value) {
      if (this.ops === null) return undefined;
      if (value === null || typeof value !== "object") return undefined;
      const existing = this.interned.get(value);
      if (existing !== undefined) return existing;
      const id = this.nextId++;
      this.interned.set(value, id);
      return id;
    }

    wrap(object, target) {
      const cached = this.wrappers.get(object);
      if (cached !== undefined) return cached;
      const self = this;
      const methods = target === undefined ? this.methods : new Map();
      const proxy = new Proxy(object, {
        get(subject, property) {
          const value = Reflect.get(subject, property, subject);
          if (typeof value !== "function") return value;
          const name = String(property);
          const cachedMethod = methods.get(name);
          if (cachedMethod !== undefined) return cachedMethod;
          const method = (...args) => {
            const real = args.map((a) => self.unwrap(a));
            const result = value.apply(subject, real);
            if (self.ops === null) return result;
            const id = self.intern(result);
            const op = {
              op: "call",
              method: name,
              args: real.map((a) => self.encode(a)),
            };
            if (target !== undefined) op.target = target;
            if (id !== undefined) op.id = id;
            self.push(op);
            return id === undefined ? result : self.wrap(result, id);
          };
          methods.set(name, method);
          return method;
        },
        set(subject, property, value) {
          if (self.ops !== null) {
            const op = {
              op: "set",
              property: String(property),
              value: self.encode(self.unwrap(value)),
            };
            if (target !== undefined) op.target = target;
            self.push(op);
          }
          return Reflect.set(subject, property, self.unwrap(value), subject);
        },
      });
      this.wrappers.set(object, proxy);
      this.wrappers.set(proxy, proxy);
      this.unwrapped.set(proxy, object);
      return proxy;
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
  const nativeGetContext = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = nativeGetContext.call(this, type, ...rest);
    if (type !== "2d" || ctx === null) return ctx;
    const existing = entries.find((e) => e.raw === ctx);
    if (existing) return existing.recorder.context;
    const recorder = new ContextRecorder(ctx);
    entries.push({ canvas: this, raw: ctx, recorder });
    return recorder.context;
  };

  /**
   * The one surface a recording is about: the largest canvas attached to the
   * document.
   *
   * The engine records the context it handed the game and nothing a game drew to
   * a scratch surface of its own, so this makes the same cut rather than
   * interleaving two surfaces into one operation list. An engineless build draws
   * the game into the page's `<canvas>`, and anything else it creates — an
   * offscreen buffer for a glow, say — is smaller and unattached.
   */
  function primary() {
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

  /** The recorder for the primary surface, or null before one exists. */
  function recorderOf() {
    const entry = primary();
    return entry === null ? null : entry.recorder;
  }

  const state = {
    /** "manual" — the driver brackets each frame. "raf" — the loop does. */
    mode: "manual",
    /** Whether an animation frame currently has a frame open, in "raf" mode. */
    open: false,
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
    const entry = primary();
    if (entry === null) return;
    if (state.open) {
      const delta = ts - state.lastTs;
      state.count += 1;
      state.timeMs += delta;
      entry.recorder.endFrame(
        { count: state.count, timeMs: state.timeMs, deltaMs: delta },
        surfaceOf(entry),
      );
      state.open = false;
    }
    state.lastTs = ts;
    entry.recorder.beginFrame();
    state.open = true;
  }
  requestAnimationFrame(tick);

  window.__caromRec = {
    /** Whether the page has created a 2D context yet. */
    ready: () => primary() !== null,

    /** Open a frame. Paired with {@link end}, around one driven frame. */
    begin() {
      const recorder = recorderOf();
      if (recorder !== null) recorder.beginFrame();
    },

    /** Close the frame `begin` opened, `deltaMs` of game time after it. */
    end(deltaMs) {
      const entry = primary();
      if (entry === null) return;
      state.count += 1;
      state.timeMs += deltaMs;
      entry.recorder.endFrame(
        { count: state.count, timeMs: state.timeMs, deltaMs },
        surfaceOf(entry),
      );
    },

    /** Hand the frame boundary to the animation frame, or take it back. */
    setMode(mode) {
      state.mode = mode === "raf" ? "raf" : "manual";
      state.open = false;
    },

    /** Every operation the last CLOSED frame issued, in order. */
    last() {
      const recorder = recorderOf();
      return recorder === null ? [] : recorder.lastOps;
    },

    /** Begin keeping frames. `design` is the logical field and its background. */
    arm(design) {
      const recorder = recorderOf();
      if (recorder === null) return false;
      recorder.start(design);
      return true;
    },

    /** Stop keeping frames and hand back the recording. */
    disarm() {
      const recorder = recorderOf();
      if (recorder === null || !recorder.active) return null;
      return recorder.stop();
    },

    /** How many frames were closed while armed, before any decimation. */
    seen() {
      const recorder = recorderOf();
      return recorder === null ? 0 : recorder.seen;
    },
  };
})();
