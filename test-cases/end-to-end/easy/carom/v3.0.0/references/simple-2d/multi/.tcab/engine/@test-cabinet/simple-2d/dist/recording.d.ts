/**
 * Draw-command recording: the engine's flight recorder.
 *
 * A recording is the list of operations a build issued against its 2D context,
 * frame by frame, in the order it issued them. Replaying it re-issues those
 * operations against another context and reproduces the picture the build drew —
 * so the evidence a reviewer sees is the build's own drawing rather than a
 * re-shoot of it.
 *
 * Six decisions shape the format, and each of them is what makes a later property
 * true:
 *
 * 1. **Every frame carries the context state it inherited.** A frame's own
 *    operations are not enough to draw it: a game that sets `font` once on its
 *    first frame relies on the context still carrying it a thousand frames later.
 *    Recording the inherited state at the top of each frame makes every frame
 *    independently renderable, which is what lets a player seek to frame 900
 *    without replaying the 899 before it. That is the whole reason two recordings
 *    can be scrubbed side by side in step.
 * 2. **The state a frame inherited includes the parts a context will not report.**
 *    A build may `save` on one frame and `restore` on the next, it may set a clip
 *    that is still in force a hundred frames later, and it may open a path on one
 *    frame and fill it on the next. None of the three can be read back, so the
 *    recorder shadows all of them: a frame names the states the context had saved
 *    when it opened, and each state carries the clip segments in force and the path
 *    that was current.
 * 3. **What a frame draws with lives in tables the whole recording shares.** A
 *    gradient is created through the context and then mutated through the object
 *    the context returned, so a recorder that only watched the context would record
 *    the creation and miss every colour stop. The four producing calls are wrapped,
 *    their mutations are collected as that value's recipe, and a *use* of the value
 *    records as an index into the recording's resource table. Recording the recipe
 *    against the frame that happened to create the value would leave an inherited
 *    fill naming an operation a later frame does not contain, and frame
 *    independence would be a claim rather than a property. Bitmap sources are
 *    carried the same way, as captured pixels in an image table, because a
 *    sprite-based build's picture is mostly what it blits.
 * 4. **A value is resolved when it is observed and interned when it is used.** A
 *    style property holds a live reference, so what a gradient paints is decided at
 *    the paint and not at the assignment; `createPattern`, in the other direction,
 *    copies its source at the call, so what a pattern holds is decided at the
 *    producing call and not at the use. Encoding therefore runs in two stages: a
 *    value is turned into a portable form the moment the recorder sees it — host
 *    objects become captured bytes, nested recipes or markers, and numbers are
 *    rounded — and that form is interned into the running recording's tables at the
 *    moment of use. Only the table indices are deferred.
 * 5. **Each distinct entry is written once.** Consecutive frames issue very nearly
 *    the same operations under very nearly the same state, and a sprite that sits
 *    still is the identical call every frame. Operations, states, resources and
 *    images are interned on their canonical JSON and named by index, which bounds
 *    what a recording costs to store and what a reviewer's browser pays to hold it.
 * 6. **Recording is bracketed by the frame, not by the engine's lifetime.** The
 *    recorder is armed and disarmed by the caller, so a validator records the
 *    section of a scenario its check is about and pays nothing for the setup that
 *    got there. What is shadowed — the produced values, the save stack, the clip and
 *    the path — is maintained whether or not the recorder is armed, because a build
 *    establishes all four long before a caller arms anything. Each is bounded, so an
 *    engine that is never asked to record holds what its own drawing is worth and
 *    nothing per frame, and a frame that inherited a shadow cut down to its bound
 *    says so rather than replaying under a state close to the build's in silence.
 *
 * The recorder must never disturb what the build draws. Every value it encodes is
 * something the build handed over, so encoding runs behind a guard, carries a
 * visited set and a depth bound, and degrades to an opaque marker rather than
 * throwing out of a trap the build is standing in.
 *
 * What is deliberately outside a recording: the diagnostics overlay, which is
 * chrome drawn over the finished picture rather than part of it, and anything a
 * game draws to a surface of its own rather than through the context the engine
 * handed it. The second is not preventable — a game may reach `ctx.canvas` and
 * get an unwrapped context back — but it is detectable, because a frame that
 * emits no operations while its pixels change is a frame that drew somewhere
 * else. The one thing done *to* that canvas element that the recorder cannot let
 * pass is a write to its backing store size, which resets the context and
 * everything shadowed with it, so the element carries the recorder's own accessors
 * for `width` and `height`.
 */
import type { Recording } from "./contract";
/**
 * The version this recorder writes and a player must understand.
 *
 * A reader takes it first and can then refuse a document that is not a recording,
 * rather than drawing a wrong picture confidently. There is one recording format
 * and it is version 1: the engine reads no other shape and writes no other shape,
 * so a recording that states anything else was not written by a recorder.
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
 * While disarmed the wrapper forwards, keeps each produced value's recipe, and
 * shadows the state a context will not report; it collects no frames and interns
 * nothing, because a table index is only meaningful inside a running recording.
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
    /** Wrappers for values the context produced, so mutations of them are recorded. */
    private readonly wrappers;
    /** The inverse of {@link wrappers}: a wrapper to the object it stands for. */
    private readonly unwrapped;
    /**
     * The recipe of each value the context produced, keyed on the value itself.
     *
     * Never rebuilt. A gradient made before the recorder was ever armed is the case
     * the format exists for, and a recipe reset at arming would record every fill
     * with it as opaque — so a recipe holds resolved values and is interned into
     * whichever recording is running when the value is used.
     */
    private readonly recipes;
    /** Where each fixed bitmap source was captured to, and under what identity. */
    private fixedImages;
    /**
     * Where one set of captured bytes landed in this recording's table.
     *
     * A sprite sheet is one capture and hundreds of uses a frame, and interning is
     * keyed on canonical JSON — which for a captured image is the whole data URL. The
     * bytes that came back from one capture are one object, however many uses resolve
     * to it, so where they landed is remembered against that object rather than
     * rebuilt from megabytes of string every time something draws it.
     */
    private placed;
    /** The image bytes this recording holds, against {@link CAPTURE_BUDGET}. */
    private captured;
    /**
     * The context images are captured through: absent until asked for, `null` once
     * asked for and unavailable.
     */
    private scratch;
    private images;
    private resources;
    private operations;
    private states;
    private imageIndex;
    private resourceIndex;
    private operationIndex;
    private stateIndex;
    /** The states the context has saved, outermost first. */
    private saved;
    /**
     * Whether the save stack is missing entries the bound dropped.
     *
     * Cleared only by a reset of the context, which empties the stack outright. A
     * build that overflowed the bound and then restored back out of it is no longer
     * missing anything, and the recorder cannot tell that from a build still inside
     * the entries it dropped — so every frame from the overflow to the next reset says
     * it was cut down, which over-reports where the alternative under-reports.
     */
    private stackTruncated;
    /** The clip in force, as the segments that built it. */
    private clip;
    /** The path operations issued since the last `beginPath`, by transform. */
    private path;
    /** What the recording last said each style property holds, for the produced ones. */
    private emitted;
    /** The transform in force, or `undefined` when a call may have moved it. */
    private transform;
    /** The backing store the shadowed state describes, or `null` before the first read. */
    private surface;
    /** The frames closed so far, or `null` while the recorder is disarmed. */
    private frames;
    /** The operations of the frame in progress, by index, or `null` between frames. */
    private pending;
    /** The state the open frame inherited, captured when the frame opened. */
    private pendingState;
    /** The states saved under the open frame, captured when the frame opened. */
    private pendingStack;
    /** Whether anything the open frame inherited was cut down to a bound. */
    private pendingTruncated;
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
     *
     * What the recorder shadows — the recipes, the save stack, the clip, the path — is
     * not touched: it describes the context as it stands, which arming does not
     * change.
     */
    start(design: {
        width: number;
        height: number;
        background: string | null;
    }): void;
    /** Disarm, and hand back everything captured since {@link start}. */
    stop(): Recording;
    /**
     * The frames re-expressed against tables holding only what those frames name.
     *
     * AN OPERATION IS INTERNED WHEN IT IS RECORDED AND A FRAME MAY LOSE IT
     * AFTERWARDS. A canvas wiped part-way through a frame erases the pixels the
     * operations before it drew, so {@link wiped} drops them from the frame — and
     * what they interned into `ops`, `resources` and `images` stays behind, named by
     * nothing. `Recording.ops` states every distinct operation the recording holds,
     * so the tables are built from the frames rather than the frames from the
     * tables: the close is the first moment at which what a frame holds is settled.
     *
     * Every entry here is reached from a frame, and every reference inside one is
     * rewritten as it is reached, transitively: a frame names its own state and the
     * states saved under it, whose style properties and clip and path segments name
     * operations and resources, whose own creating calls may name images. So every
     * index a frame carries addresses the table it was written into, and a document
     * cannot name an entry it does not hold.
     *
     * An entry is deduplicated on the index it came from rather than on its content.
     * The table it is read out of was interned on the way in, so no two of its
     * entries are equal, and a rewrite that sends distinct indices to distinct
     * indices leaves them distinct — the two dedups agree entry for entry and in the
     * same order. Content dedup would mean canonicalizing every operation reference
     * of every frame a second time, which for a recording of tens of thousands of
     * frames is the whole document walked again to learn what interning already
     * settled; this walk costs a map lookup per reference and one rewrite per entry
     * the document keeps.
     */
    private retable;
    /**
     * Empty tables, and nothing that names an entry in one.
     *
     * Called on the way in and on the way out, because the caller owns the recording
     * it was handed: a table this recorder went on writing into would be a document
     * changing under its reader, and an index kept from it would name an entry the
     * next recording does not have.
     */
    private resetTables;
    /**
     * Open a frame.
     *
     * The state snapshot is taken here, before the frame's first operation, so it is
     * the state the frame *inherited*. Taking it after the frame's own sets would
     * record the state the frame left behind, and replaying a frame from that would
     * draw its first operations under its last operation's style. The states saved
     * under it are taken at the same moment and for the same reason: a `restore`
     * among the frame's operations pops to one of them.
     */
    beginFrame(): void;
    /**
     * Take the state the open frame inherits, and the states saved under it.
     *
     * Taken again whenever the context is reset inside the frame, because the
     * operations recorded before the reset go with it: what is left of the frame
     * inherits the state the reset left rather than the one it discarded. The engine's
     * own frame preparation resizes the backing store from inside the frame bracket,
     * so this is reachable in the code that exists today.
     */
    private snapshot;
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
     * The canvas state as it stands, read defensively.
     *
     * Every read is guarded because the set of properties a context carries is not
     * the same everywhere: a native canvas used by a validator implements most of
     * this list and not all of it, and a browser adds to it over time. A property
     * that is absent, or that throws on read, is omitted — a replay that restores
     * one property fewer draws a slightly different frame, while a recorder that
     * threw here would take the whole run down over a property nobody used.
     *
     * The values are the context's own, held rather than resolved, because a style
     * property holds a live reference: what a gradient in one paints is settled when
     * the state is encoded, not when it was read.
     */
    private readState;
    /**
     * The transform in force, or `null` from a context that cannot report one.
     *
     * `getTransform` is the one accessor a very old context may lack. Without it a
     * frame relies on the transform its own operations establish, which for an
     * engine-drawn frame is every frame: `prepare` sets the transform before the game
     * draws.
     *
     * Held until a call moves it, because every path operation asks for it and a
     * context answers with a freshly allocated matrix.
     */
    private readTransform;
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
     * The element is therefore given its own `width` and `height`, each forwarding to
     * the accessor it inherits and telling the recorder afterwards. Whatever the new
     * size, the reset is seen where it happened.
     *
     * A canvas the accessors cannot be installed on — one carrying its dimensions as
     * plain fields, one that refuses a property definition, a context that will not
     * say what it draws into — is left alone and falls back to {@link checkSurface}.
     * Nothing here may throw: this runs at construction, and a recorder that failed
     * here would take down an engine that had not asked to record anything.
     */
    private watch;
    /**
     * Notice a canvas resize the accessors did not announce.
     *
     * The fallback for a canvas {@link watch} could not install itself on. The backing
     * store size is read before each shadowed operation and before each state
     * snapshot, and a size that differs from the one last seen is a context that was
     * reset between the two.
     */
    private checkSurface;
    /**
     * Give up everything the recorder shadows: the context it described is gone.
     *
     * A canvas reset returns the transform to the identity and the properties to their
     * defaults, and discards the clip, the current path and the save stack. What the
     * context still reports corrects itself on the next read; the three write-only
     * shadows have to be dropped here.
     *
     * A reset **during** a frame also invalidates the operations that frame has
     * already recorded: the wipe erased the pixels they drew, and replaying them would
     * paint those pixels back over a frame that never had them. They are dropped and
     * the inherited state is taken again, so what the frame says is what it draws.
     * What they interned goes with them at the close, where {@link retable} settles
     * the tables from the frames that are left.
     */
    private wiped;
    /** A shadowed state, and the path in force, as the recording writes them. */
    private encodeState;
    /** One run of path operations as the recording writes it. */
    private encodeSegment;
    /**
     * What the recording last said about each style property holding a produced value.
     *
     * Rebuilt from a state snapshot, because encoding that snapshot is what stated it.
     */
    private emissions;
    /**
     * Re-state any style property whose produced value has moved on since it was set.
     *
     * A canvas style property holds a live reference, so a gradient given another
     * colour stop after it was assigned paints under that stop without ever being
     * assigned again — and a recording that said what the assignment said would paint
     * the frame under stops the build had already left behind, with nothing reported.
     * The corrective assignment goes in front of the painting operation, so what the
     * frame holds is what the context is about to paint.
     */
    private correct;
    /** A value the recorder saw and used at the same moment: resolved, then interned. */
    private encode;
    /**
     * One value the build supplied, resolved, with the guard the traps rely on.
     *
     * {@link resolve} degrades rather than throwing at every point it can reach, and
     * this is the outer promise that it did: a value the recorder failed to resolve at
     * all still records as a marker, so the operation carrying it is written and
     * reported rather than dropped with nothing said.
     */
    private resolveValue;
    /**
     * The arguments of one call, resolved before the call is made.
     *
     * Before, because a call may change what its own argument holds:
     * `ctx.drawImage(ctx.canvas, …)` is the ordinary trails blit, and capturing its
     * source afterwards would record the surface as the blit left it — a replay that
     * composites the result on top of itself.
     */
    private resolveArgs;
    /**
     * Whether anything is going to hold the resolved arguments of this call.
     *
     * Resolving is not free — a bitmap argument is read out as pixels, which for a
     * full-screen surface is a PNG encode — so it is done only where the answer is
     * kept. A mutation of a produced value and the four producing calls are collected
     * whether or not the recorder is armed, and so are the path and the clip;
     * everything else is an operation of a frame, and a blit issued while nothing is
     * recording pays nothing for it.
     */
    private resolving;
    /** One resolved operation as the recording writes it. */
    private carryOp;
    /**
     * Resolve one value the build supplied into a form the recording can hold.
     *
     * The first encoding stage, and the one that has to happen at the moment the
     * recorder sees the value: a bitmap source is read here because the build may
     * repaint it afterwards, and a produced value is snapshotted here because it goes
     * on being mutated. Plain data is carried as itself, with every number rounded.
     *
     * The value belongs to the build, so this is total by construction. A cycle, a
     * getter that throws and a structure nested past {@link ENCODE_DEPTH} each resolve
     * to a marker, because the pixels a build draws must be the same whether or not
     * anything is being captured.
     */
    private resolve;
    /**
     * An array or a plain object, field by field, or a marker for anything else.
     *
     * This is what keeps the answers to `getLineDash` and `getContextAttributes` out
     * of the resource table. Anything with a prototype of its own is a host object,
     * and its fields would not reconstruct it.
     *
     * A node is resolved once per walk and shared from there. The guard against a
     * cycle has to be the path currently being walked rather than everything seen, and
     * without the memo beside it a value that reaches the same node down twenty
     * different paths is expanded two to the twentieth times — measured at eleven
     * seconds inside a trap the build is standing in.
     */
    private resolveData;
    /** A produced value as of now: its recipe so far, or a marker for one past rebuilding. */
    private produced;
    /**
     * Intern a resolved value into the running recording's tables.
     *
     * The second encoding stage. Everything here is a lookup: captured bytes and
     * recipes become the indices of the entries they were interned at, and plain data
     * passes through as itself.
     */
    private carry;
    /**
     * One set of captured bytes in the image table, at the index it shares with equal
     * bytes.
     *
     * The budget is checked after the lookup, so a recording that has stopped
     * capturing keeps resolving every set of bytes it already holds: a canvas repainted
     * back to a picture the table has costs nothing and resolves, where checking first
     * would degrade an image the document already carries.
     */
    private carryImage;
    /** One produced value in the resource table, as the recipe that rebuilds it. */
    private carryResource;
    /**
     * Record an operation the context performed on itself.
     *
     * An operation needs a frame open to belong to, and is dropped otherwise. The
     * interning happens here rather than at the call site so that a dropped operation
     * costs none of it and adds nothing to the shared tables.
     */
    private push;
    /**
     * Record a mutation of a value the context produced.
     *
     * It joins that value's recipe wherever the recorder is in its frame cycle, and
     * whether or not it is armed, because the recipe is what a later use of the value
     * replays. Past {@link RECIPE_STEPS} the mutation is dropped and the value is
     * marked: a recipe that cannot be completed is a value a player must report
     * rather than rebuild from half of it.
     */
    private step;
    /**
     * Keep the part of the context state a context will not report back.
     *
     * The save stack, the clip and the current path are all write-only from outside,
     * and all three survive a frame boundary, so a frame that inherits any of them has
     * to be handed it by the recorder. Maintained whether or not the recorder is
     * armed, because a clip set before the first captured frame is still in force
     * during it.
     */
    private shadow;
    /**
     * Add one operation to a run of segments, under the transform in force.
     *
     * A path is given in user space, so a run of operations issued under one transform
     * is one segment and a transform between two of them starts another. A player
     * replays each segment under the transform it carries, which is what makes a path
     * built across a translate land where the build put it — and what makes a `clip`
     * taken under one transform intersect the region the build meant.
     */
    private extend;
    /**
     * Take charge of a value one of the four producing calls returned.
     *
     * The call itself is *not* an operation: it is the first line of the returned
     * value's recipe, and it is written into the recording only if and when the value
     * is used. A gradient nothing ever fills with is a gradient the picture does not
     * contain, and its source image is not one the recording carries.
     *
     * Its arguments are resolved here, because `createPattern` copies its source when
     * it is called: a pattern made from a canvas that is repainted afterwards holds the
     * picture the canvas carried at this moment.
     */
    private produce;
    /**
     * Capture the pixels of a value a canvas can draw, or a marker where it cannot.
     *
     * `null` for a value that is not one at all. A source that reports no size, a
     * canvas tainted by a cross-origin image, a host with no canvas to capture
     * through, and a recording that has reached its budget all degrade to a marker
     * rather than propagating, because a recorder that threw here would take down the
     * frame it was watching.
     */
    private image;
    /**
     * Read one bitmap source, reusing what was already read where that is honest.
     *
     * A fixed source is looked up against the identity it had when it was captured —
     * for an `<img>`, the file it points at and the resolution that file turned out to
     * have — so it is read once however many operations draw it, and re-pointing one
     * captures again. A source whose content can change is read at every use, because
     * nothing about it says whether it still holds the pixels it held before; two
     * reads that answer the same bytes share one entry, which is what an unchanging
     * surface costs and what a surface repainted every frame is worth.
     */
    private readBitmap;
    /** One source's pixels as a PNG data URL, or `null` if there is no way to take one. */
    private snap;
    /**
     * The scratch context, sized and blanked for this capture.
     *
     * Built once and resized per capture rather than built per capture: writing the
     * size also blanks the canvas, which is exactly the preparation each capture
     * needs — a smaller or partly transparent source drawn over the last capture would
     * otherwise be recorded with the last capture showing through it — and a build
     * that blits a sprite a hundred times a frame would churn a hundred canvases.
     */
    private scratchContext;
    /**
     * A canvas to capture through, from whichever of the two worlds this is.
     *
     * In a browser that is a detached element. In-process — which is how a validator
     * runs, over a native canvas with no document behind it — it is a fresh instance
     * of the same class the engine's own canvas is, which is how that implementation
     * builds one. Both are asked for a 2D context and for `toDataURL`, and a host that
     * supplies neither leaves every image opaque rather than failing the run.
     */
    private buildScratch;
    /**
     * Wrap the context, or a value it produced.
     *
     * `resource` is what the two wrappers differ by, and it is exactly the distinction
     * an operation carries: a call on the context is an operation of the frame, and a
     * call on a value the context handed out is a line of that value's recipe. The
     * recipe is looked up per call rather than captured here, so a value a build held
     * across two recordings goes on collecting its mutations into the one recipe it
     * has always had.
     *
     * Every recording decision inside the traps is guarded, and the forwarding is not:
     * what the build asked the context to do happens whatever the recorder makes of
     * it, which is the property that lets a build be captured at all.
     */
    private wrap;
    /**
     * Note what an assignment stated about a property.
     *
     * A property that now holds a produced value is one whose recipe may grow before
     * the next paint, and this is the figure that growth is measured against. One that
     * holds anything else holds a value that cannot change behind the recording.
     */
    private note;
    /**
     * The wrapper for a value the recorder tracks, or the value itself.
     *
     * A produced value read back off the context is the same object the build was
     * handed at the producing call, so it comes back through the same wrapper and its
     * mutations go on joining the one recipe it has always had. Anything else — a
     * colour string, a number, the canvas element — is its own.
     *
     * Guarded, because this stands between the build and every non-function property
     * of its context: a value that cannot be wrapped is handed over as itself rather
     * than turned into a throw from inside a read the build is standing in.
     */
    private tracked;
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