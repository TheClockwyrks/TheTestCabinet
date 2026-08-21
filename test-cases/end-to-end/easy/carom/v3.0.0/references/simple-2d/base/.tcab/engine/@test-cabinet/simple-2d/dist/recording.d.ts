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
import type { Recording } from "./contract";
/**
 * The version this recorder writes and a player must understand.
 *
 * A reader takes it first and can then refuse a recording it does not know how to
 * draw, rather than drawing a wrong picture confidently. It is bumped whenever the
 * meaning of anything below changes, which is a different event from the engine
 * package's own version: a recording outlives the run that produced it and is read
 * by a console that was built separately.
 */
export declare const RECORDING_FORMAT = 1;
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
export declare class ContextRecorder {
    /** The wrapper the engine draws through and hands to the game. */
    readonly context: CanvasRenderingContext2D;
    private readonly target;
    /**
     * Method wrappers, cached by property name.
     *
     * A trap that built a fresh closure per read would allocate one for every draw
     * call of every frame, which for a game issuing a few hundred operations at sixty
     * frames a second is tens of thousands of closures a second thrown away. The
     * wrapper for a given name never varies, so it is built once.
     */
    private readonly methods;
    /** Ids handed to values the context returned, so a later use records as a ref. */
    private readonly interned;
    /** Wrappers for interned values, so calls made on them are recorded. */
    private readonly wrappers;
    /** The inverse of {@link wrappers}: a wrapper to the object it stands for. */
    private readonly unwrapped;
    private nextId;
    /** The frames closed so far, or `null` while the recorder is disarmed. */
    private frames;
    /** The operations of the frame in progress, or `null` between frames. */
    private ops;
    /** The state the open frame inherited, captured when the frame opened. */
    private pendingState;
    /** What the recording says it was drawn at, fixed when the recorder is armed. */
    private design;
    constructor(target: CanvasRenderingContext2D);
    /** Whether operations are being captured. */
    get active(): boolean;
    /**
     * Arm the recorder.
     *
     * The design size and background are taken here rather than read back from the
     * canvas later, because a recording states the coordinate system its operations
     * were issued in and that is the engine's fixed logical size, not whatever the
     * element happens to be sized to when the recording is closed.
     */
    start(design: {
        width: number;
        height: number;
        background: string | null;
    }): void;
    /** Disarm, and hand back everything captured since {@link start}. */
    stop(): Recording;
    /**
     * Open a frame.
     *
     * The state snapshot is taken here, before the frame's first operation, so it is
     * the state the frame *inherited*. Taking it after the frame's own sets would
     * record the state the frame left behind, and replaying a frame from that would
     * draw its first operations under its last operation's style.
     */
    beginFrame(): void;
    /**
     * Close a frame and keep it.
     *
     * A frame that opened while the recorder was armed and closes after it was
     * disarmed is dropped rather than kept: the recording it would have joined has
     * already been handed to its caller, and a half-frame appended to nothing is a
     * frame no reader could ask for.
     */
    endFrame(info: {
        count: number;
        timeMs: number;
        deltaMs: number;
    }, surface: {
        width: number;
        height: number;
    }): void;
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
    private snapshotState;
    /**
     * Encode one value for the recording.
     *
     * Plain data is carried as itself. A value the context produced is carried as a
     * reference to the operation that produced it, which is what makes a gradient
     * replayable. Anything else is carried as an opaque marker naming its type: a
     * reader can then say which operation it cannot reproduce, instead of a player
     * failing on a value it cannot explain.
     */
    private encode;
    /** Record an operation, if a frame is open to record it into. */
    private push;
    /**
     * Intern a value the context produced, so later operations can name it.
     *
     * Only objects are interned, and only while recording: an id handed out while
     * disarmed would refer to a creating operation no recording contains, and a
     * later frame that used the value would replay as a reference to nothing.
     */
    private intern;
    /**
     * Wrap a context or a value it produced.
     *
     * `target` is `undefined` for the context itself and an interned id for anything
     * else, which is exactly the distinction an operation carries: an operation with
     * no target is one the context performed, and one with a target is an operation
     * performed on a value the context handed out.
     */
    private wrap;
    /**
     * The real object behind a wrapper, if this is one.
     *
     * A game that assigns a gradient to `fillStyle` assigns the wrapper it was
     * handed, and a native context refuses a proxy where it expects one of its own
     * objects. Unwrapping on the way in keeps the wrapping invisible to the context
     * while leaving it visible to the recorder.
     */
    private unwrap;
}
//# sourceMappingURL=recording.d.ts.map