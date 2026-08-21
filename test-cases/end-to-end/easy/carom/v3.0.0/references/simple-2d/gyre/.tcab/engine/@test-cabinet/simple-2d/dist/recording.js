/**
 * Draw-command recording: the engine's flight recorder.
 *
 * A recording is the list of operations a build issued against its 2D context,
 * frame by frame, in the order it issued them. Replaying it re-issues those
 * operations against another context and reproduces the picture the build drew —
 * so the evidence a reviewer sees is the build's own drawing rather than a
 * re-shoot of it.
 *
 * Three decisions shape the format, and each of them is what makes a later
 * property true:
 *
 * 1. **Every frame carries the context state it inherited.** A frame's own
 *    operations are not enough to draw it: a game that sets `font` once on its
 *    first frame relies on the context still carrying it a thousand frames later.
 *    Recording the inherited state at the top of each frame makes every frame
 *    independently renderable, which is what lets a player seek to frame 900
 *    without replaying the 899 before it. That is the whole reason two recordings
 *    can be scrubbed side by side in step.
 * 2. **Values that are not data are interned, not dropped.** A gradient is
 *    created through the context and then mutated through the object the context
 *    returned, so a recorder that only watched the context would record the
 *    creation and miss every colour stop. Anything the context hands back is given
 *    an id and wrapped, so calls made *on* it are recorded against that id and a
 *    later use of it as a value records as a reference to it.
 * 3. **Recording is bracketed by the frame, not by the engine's lifetime.** The
 *    recorder is armed and disarmed by the caller, so a validator records the
 *    section of a scenario its check is about and pays nothing for the setup that
 *    got there. Nothing accumulates while the recorder is idle.
 *
 * What is deliberately outside a recording: the diagnostics overlay, which is
 * chrome drawn over the finished picture rather than part of it, and anything a
 * game draws to a surface of its own rather than through the context the engine
 * handed it. The second is not preventable — a game may reach `ctx.canvas` and
 * get an unwrapped context back — but it is detectable, because a frame that
 * emits no operations while its pixels change is a frame that drew somewhere
 * else.
 */
/**
 * The version this recorder writes and a player must understand.
 *
 * A reader takes it first and can then refuse a recording it does not know how to
 * draw, rather than drawing a wrong picture confidently. It is bumped whenever the
 * meaning of anything below changes, which is a different event from the engine
 * package's own version: a recording outlives the run that produced it and is read
 * by a console that was built separately.
 */
export const RECORDING_FORMAT = 1;
/**
 * The 2D context properties a frame inherits from the one before it.
 *
 * This is the whole of the canvas state that survives a frame boundary, minus the
 * transform and the dash pattern, which are read through their own accessors
 * below. The list is explicit rather than derived from the context object because
 * enumerating a `CanvasRenderingContext2D` yields its methods too, and because the
 * set has to mean the same thing on a browser context and on the native canvas a
 * validator runs against — where several of these are simply absent.
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
/** Whether a value can be carried as-is, with no encoding at all. */
function isPrimitive(value) {
    return (value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string");
}
/**
 * The name to report for a value the recorder cannot carry.
 *
 * The constructor name rather than `typeof`, because every interesting case here
 * is an object and "object" tells a reader nothing about which one leaked. A value
 * with no constructor at all still yields a usable label.
 */
function opaqueName(value) {
    if (value === undefined)
        return "undefined";
    const proto = Object.getPrototypeOf(value);
    return proto?.constructor?.name ?? "object";
}
/**
 * The recorder: one instance per engine, armed and disarmed by its owner.
 *
 * It wraps the engine's context once, at construction, and hands out that wrapper
 * for the engine's whole life. A wrapper installed only while recording would be a
 * different object from the one a game may have held on to from an earlier frame,
 * and the game would keep drawing through the unwrapped context it captured — so
 * the identity is stable and the arming is a flag inside it.
 *
 * While disarmed the wrapper forwards and records nothing, so the cost of carrying
 * it is one property lookup and one call per operation.
 */
export class ContextRecorder {
    /** The wrapper the engine draws through and hands to the game. */
    context;
    target;
    /**
     * Method wrappers, cached by property name.
     *
     * A trap that built a fresh closure per read would allocate one for every draw
     * call of every frame, which for a game issuing a few hundred operations at sixty
     * frames a second is tens of thousands of closures a second thrown away. The
     * wrapper for a given name never varies, so it is built once.
     */
    methods = new Map();
    /** Ids handed to values the context returned, so a later use records as a ref. */
    interned = new WeakMap();
    /** Wrappers for interned values, so calls made on them are recorded. */
    wrappers = new WeakMap();
    /** The inverse of {@link wrappers}: a wrapper to the object it stands for. */
    unwrapped = new WeakMap();
    nextId = 0;
    /** The frames closed so far, or `null` while the recorder is disarmed. */
    frames = null;
    /** The operations of the frame in progress, or `null` between frames. */
    ops = null;
    /** The state the open frame inherited, captured when the frame opened. */
    pendingState = null;
    /** What the recording says it was drawn at, fixed when the recorder is armed. */
    design = {
        width: 0,
        height: 0,
        background: null,
    };
    constructor(target) {
        this.target = target;
        this.context = this.wrap(target);
    }
    /** Whether operations are being captured. */
    get active() {
        return this.frames !== null;
    }
    /**
     * Arm the recorder.
     *
     * The design size and background are taken here rather than read back from the
     * canvas later, because a recording states the coordinate system its operations
     * were issued in and that is the engine's fixed logical size, not whatever the
     * element happens to be sized to when the recording is closed.
     */
    start(design) {
        this.design = { ...design };
        this.frames = [];
        this.ops = null;
    }
    /** Disarm, and hand back everything captured since {@link start}. */
    stop() {
        const frames = this.frames ?? [];
        this.frames = null;
        this.ops = null;
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
     * The state snapshot is taken here, before the frame's first operation, so it is
     * the state the frame *inherited*. Taking it after the frame's own sets would
     * record the state the frame left behind, and replaying a frame from that would
     * draw its first operations under its last operation's style.
     */
    beginFrame() {
        if (this.frames === null)
            return;
        this.ops = [];
        this.pendingState = this.snapshotState();
    }
    /**
     * Close a frame and keep it.
     *
     * A frame that opened while the recorder was armed and closes after it was
     * disarmed is dropped rather than kept: the recording it would have joined has
     * already been handed to its caller, and a half-frame appended to nothing is a
     * frame no reader could ask for.
     */
    endFrame(info, surface) {
        const frames = this.frames;
        const ops = this.ops;
        const state = this.pendingState;
        this.ops = null;
        this.pendingState = null;
        if (frames === null || ops === null || state === null)
            return;
        frames.push({
            count: info.count,
            timeMs: info.timeMs,
            deltaMs: info.deltaMs,
            surface: { width: surface.width, height: surface.height },
            state,
            ops,
        });
    }
    /**
     * The inherited canvas state, read defensively.
     *
     * Every read is guarded because the set of properties a context carries is not
     * the same everywhere: a native canvas used by a validator implements most of
     * this list and not all of it, and a browser adds to it over time. A property
     * that is absent, or that throws on read, is omitted — a replay that restores
     * one property fewer draws a slightly different frame, while a recorder that
     * threw here would take the whole run down over a property nobody used.
     */
    snapshotState() {
        const target = this.target;
        const properties = {};
        for (const name of STATE_PROPERTIES) {
            try {
                const value = target[name];
                if (value === undefined)
                    continue;
                properties[name] = this.encode(value);
            }
            catch {
                // A context that refuses to report a property it nominally has is telling
                // us the property is not usable; leaving it out is the same outcome a
                // context that never had it produces.
            }
        }
        let transform = null;
        try {
            const matrix = this.target.getTransform();
            transform = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
        }
        catch {
            // `getTransform` is the one accessor a very old context may lack. Without it
            // the frame relies on the transform its own operations establish, which for
            // an engine-drawn frame is every frame: `prepare` sets the transform before
            // the game draws.
        }
        let lineDash = null;
        try {
            lineDash = [...this.target.getLineDash()];
        }
        catch {
            // As above: absent means "no dash pattern to restore".
        }
        return { properties, transform, lineDash };
    }
    /**
     * Encode one value for the recording.
     *
     * Plain data is carried as itself. A value the context produced is carried as a
     * reference to the operation that produced it, which is what makes a gradient
     * replayable. Anything else is carried as an opaque marker naming its type: a
     * reader can then say which operation it cannot reproduce, instead of a player
     * failing on a value it cannot explain.
     */
    encode(value) {
        if (isPrimitive(value))
            return value;
        if (typeof value === "object") {
            const id = this.interned.get(value);
            if (id !== undefined)
                return { $ref: id };
            if (Array.isArray(value))
                return value.map((entry) => this.encode(entry));
            // A plain object — a `DOMMatrix2DInit`, an options bag — travels field by
            // field. Anything with a prototype of its own is a host object, and its
            // fields would not reconstruct it.
            const proto = Object.getPrototypeOf(value);
            if (proto === Object.prototype || proto === null) {
                const encoded = {};
                for (const [key, entry] of Object.entries(value)) {
                    encoded[key] = this.encode(entry);
                }
                return encoded;
            }
        }
        return { $opaque: opaqueName(value) };
    }
    /** Record an operation, if a frame is open to record it into. */
    push(op) {
        this.ops?.push(op);
    }
    /**
     * Intern a value the context produced, so later operations can name it.
     *
     * Only objects are interned, and only while recording: an id handed out while
     * disarmed would refer to a creating operation no recording contains, and a
     * later frame that used the value would replay as a reference to nothing.
     */
    intern(value) {
        if (this.ops === null)
            return undefined;
        if (value === null || typeof value !== "object")
            return undefined;
        const existing = this.interned.get(value);
        if (existing !== undefined)
            return existing;
        const id = this.nextId++;
        this.interned.set(value, id);
        return id;
    }
    /**
     * Wrap a context or a value it produced.
     *
     * `target` is `undefined` for the context itself and an interned id for anything
     * else, which is exactly the distinction an operation carries: an operation with
     * no target is one the context performed, and one with a target is an operation
     * performed on a value the context handed out.
     */
    wrap(object, target) {
        const cached = this.wrappers.get(object);
        if (cached !== undefined)
            return cached;
        const methods = target === undefined ? this.methods : new Map();
        const proxy = new Proxy(object, {
            get: (subject, property) => {
                const value = Reflect.get(subject, property, subject);
                if (typeof value !== "function")
                    return value;
                const name = String(property);
                const cachedMethod = methods.get(name);
                if (cachedMethod !== undefined)
                    return cachedMethod;
                const method = (...args) => {
                    // Arguments are unwrapped on the way in and encoded from the unwrapped
                    // values: a game that passes back a gradient passes the wrapper it was
                    // handed, and a native method refuses a proxy where it expects one of
                    // its own objects.
                    const real = args.map((arg) => this.unwrap(arg));
                    // Applied to the real subject, never to the proxy: a native canvas
                    // method called with a proxy as its receiver throws, because the
                    // internal slots it needs are on the object itself.
                    const result = value.apply(subject, real);
                    if (this.ops === null)
                        return result;
                    const id = this.intern(result);
                    this.push({
                        op: "call",
                        ...(target === undefined ? {} : { target }),
                        method: name,
                        args: real.map((arg) => this.encode(arg)),
                        ...(id === undefined ? {} : { id }),
                    });
                    // Hand back the wrapper rather than the value, so calls made on what the
                    // context returned are recorded too. The value is interned first, so the
                    // wrapper and the id name the same thing.
                    return id === undefined ? result : this.wrap(result, id);
                };
                methods.set(name, method);
                return method;
            },
            set: (subject, property, value) => {
                // The recorded value is encoded before the assignment rather than after,
                // because a context normalizes what it is given — a colour written as
                // `#fff` reads back as `#ffffff` — and the recording states what the build
                // did, not what the context made of it.
                if (this.ops !== null) {
                    this.push({
                        op: "set",
                        ...(target === undefined ? {} : { target }),
                        property: String(property),
                        value: this.encode(this.unwrap(value)),
                    });
                }
                return Reflect.set(subject, property, this.unwrap(value), subject);
            },
        });
        this.wrappers.set(object, proxy);
        // The wrapper is registered against itself as well, so a value that reaches the
        // recorder already wrapped is not wrapped a second time, and against the object
        // it stands for, so a wrapper handed back to the context is unwrapped again.
        this.wrappers.set(proxy, proxy);
        this.unwrapped.set(proxy, object);
        return proxy;
    }
    /**
     * The real object behind a wrapper, if this is one.
     *
     * A game that assigns a gradient to `fillStyle` assigns the wrapper it was
     * handed, and a native context refuses a proxy where it expects one of its own
     * objects. Unwrapping on the way in keeps the wrapping invisible to the context
     * while leaving it visible to the recorder.
     */
    unwrap(value) {
        if (value === null || typeof value !== "object")
            return value;
        const real = this.unwrapped.get(value);
        return real ?? value;
    }
}
//# sourceMappingURL=recording.js.map