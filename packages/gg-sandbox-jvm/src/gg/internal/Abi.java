package gg.internal;

import org.teavm.interop.Address;
import org.teavm.interop.Export;
import org.teavm.interop.Import;
import org.teavm.interop.StaticInit;

/**
 * <b>The crossing</b> — the whole of what this SDK implements of the WebAssembly canonical ABI, and
 * the only class in it that knows there is a host at all.
 *
 * <p><b>Both JVM arms compile this file.</b> It lives in {@code packages/gg-sandbox-jvm} beside
 * {@link Value} and {@link Frames}, and each arm's {@code build.sh} compiles the three into its own
 * SDK jar — because a second canonical-ABI implementation would be a second thing to keep in step
 * with one WIT, which is the whole point of there being one door. Everything above the frames is the
 * arm's own: {@code gg.internal.Coding} on the Java arm and {@code gg.internal.ggCall} on the Kotlin
 * one, each raising the failure class its own model-facing surface documents.
 *
 * <p>Nothing here is model-facing, and nothing describes it to a model: no catalogue entry covers
 * {@code gg.internal} (each arm's {@code signatures.sh} excludes the package) and no prompt names it.
 * What makes it non-model-facing is that silence rather than any barrier — a program that wrote
 * {@code import gg.internal.Frames;} would compile, because the jar a program is compiled against is
 * one jar. That is the same position every arm's SDK is in, and the seam's rule it serves is a rule
 * about what a model is <i>offered</i>: what a model reads is the typed, namespaced surface the
 * {@code gg} classes build on top of this.
 *
 * <h2>Why there is an ABI layer at all</h2>
 *
 * <p>A Java program reaches gg as a <b>WebAssembly component</b>: {@code javac} produces bytecode,
 * TeaVM's {@code WEBASSEMBLY_WASI} backend produces a core module, and gg encodes that module as a
 * component of the {@code jvm-sandbox} world. Every other guest gg drives has a binding generator
 * that writes the canonical ABI for the fifteen typed interfaces of
 * {@code crates/gg/wit/gg-sandbox.wit}. There is no {@code wit-bindgen} for Java and none is coming,
 * so the JVM arms reach gg through <b>one door</b> — {@code test-cabinet:gg/wire} — and the canonical
 * ABI this class implements is therefore <b>a string, two byte lists and a scalar</b>, which is
 * about forty lines of it.
 *
 * <p>What travels inside those byte lists is {@link Frames}' business, and gg owns both ends of it.
 *
 * <h2>Two regions, because two allocators share one {@code cabi_realloc}</h2>
 *
 * <p>A component exports <b>one</b> {@code cabi_realloc}, and two quite different callers use it.
 * gg's host asks for room to write an answer into. And so does the {@code wasi_snapshot_preview1}
 * reactor adapter gg encodes the component with: measured against wasmtime 45.0.3's adapter, its
 * {@code State::new} allocates its <b>entire state — one 64 KiB wasm page, asserted by the adapter
 * to be exactly that</b> — through the main module's {@code cabi_realloc}, on the first WASI call,
 * and holds the pointer for the life of the program. Every later WASI call checks two magic numbers
 * in it.
 *
 * <p>So the two callers want opposite things. The adapter's block must be handed out once and never
 * touched again. gg's answers want the room back. One recycled arena serving both is what earlier
 * versions of this file did, and both ways of getting it wrong were measured on the production
 * route:
 *
 * <ul>
 *   <li><b>An arena too small.</b> A 64 KiB arena leaves the adapter's 64 KiB state one word short,
 *       {@code cabi_realloc} answers zero, and the adapter writes its state <b>to address zero</b>.
 *       The next write to standard error dies inside the adapter with
 *       {@code wasm trap: cannot leave component instance} and an empty stderr.
 *   <li><b>An arena replaced.</b> Sizing it past 64 KiB only moves the failure. A per-call arena
 *       leaves the state in a buffer nothing refers to any more, and the first collection that
 *       reuses it turns the next write to standard error into {@code assertion failed at adapter
 *       line 2804} — the adapter's own magic-number check, naming no file, no line and no fault a
 *       model could act on. A larger heap postpones the collection and hides it, which is exactly
 *       how it survived a review.
 * </ul>
 *
 * <p>Hence {@link #HOSTED}, handed out once and never reclaimed, and {@link #wire}, sized per call.
 * {@link #cabiRealloc} tells them apart by {@link #taking} — which is true across the one imported
 * call whose answer this SDK is receiving, and false everywhere else, which is exactly when the
 * caller is the adapter.
 *
 * <h2>The arena, and why {@code cabi_realloc} allocates no Java object</h2>
 *
 * <p>Both directions of a call need bytes at an address the host can read and write, and TeaVM's
 * garbage collector <b>compacts</b> — it moves objects. That is fine for as long as nothing outside
 * Java holds an address, and the whole design here is to make that window as small as it can be:
 *
 * <ol>
 *   <li>Everything that allocates happens first, in ordinary Java, against {@link #wire}.
 *   <li>The address of that region is taken, and the import is called. <b>No allocation happens from
 *       here until the call returns.</b>
 *   <li>The host reads what it needs out of that memory, and where it writes into it — as the
 *       canonical ABI's {@code list<u8>} return requires — it asks {@link #cabiRealloc} for room.
 *       That function allocates <b>no Java object</b>, so no collection can run and the address the
 *       host is holding cannot move under it.
 *   <li>The guest reads the answer back out by ordinary array indexing.
 * </ol>
 *
 * <p>{@link #HOSTED} is the one address held across arbitrary Java execution, and it is held for the
 * whole program. It is allocated in this class's static initialiser, which {@code @StaticInit} runs
 * before anything else can, and it is never replaced. Whether TeaVM's collector may <i>move</i> a
 * long-lived array out from under an adapter that is pointing at it is the residual risk of this
 * design, and it is measured rather than assumed: {@code jvm.wire.test.rs} drives thirteen gg calls
 * with four megabytes allocated between each pair and a write to standard error after every one,
 * and every one of those writes reads the state through the address the adapter took at the first.
 *
 * <h2>Why one call is two, and why there is no headroom constant</h2>
 *
 * <p>A bump pointer can only hand back room the region already has, and the guest cannot know how
 * long an answer is until the answer exists. An earlier arrangement reserved a fixed headroom for
 * it, and that is a ceiling however large it is written: an answer past it leaves
 * {@link #cabiRealloc} nothing to return. gg's own ceilings do not bound it either — the file read
 * is cut at 256 KiB, but {@code skills.read_skill} and {@code memories.read_memory} hand back
 * whatever is on disk, uncapped.
 *
 * <p>So {@link #call} makes <b>two</b> imported calls. {@code wire.call} runs the operation and
 * answers how many bytes its result is, holding them; between the two the guest sizes {@link #wire}
 * to exactly that — an ordinary Java allocation, at the one moment nothing outside Java holds an
 * address into it — and {@code wire.take} hands the bytes over into room that is now certain to
 * exist. Any answer gg can produce fits. The remaining ceiling is the Java heap itself, and reaching
 * that is a resource fault the runtime reports in the model's own coordinates
 * ({@code at Program.main(Program.java:4)}, then {@code Out of memory}).
 */
@StaticInit
public final class Abi {
    private Abi() {
    }

    /** The size of the canonical ABI's return area for a {@code list<u8>}: a pointer and a length. */
    private static final int RETURN_AREA = 8;

    /**
     * The bytes of slack a region carries over what is spoken for.
     *
     * <p>{@link #bump} rounds each block it hands out up to eight bytes, and so may the alignment the
     * host asks for; sixteen bytes is more than the two roundings one call can ask for, so a request
     * or an answer that exactly fits cannot leave a region a byte short.
     */
    private static final int SLACK = 16;

    /**
     * The region the <b>adapter</b> is served from — handed out once, never reclaimed, never
     * replaced.
     *
     * <p>Sized at four times the 64 KiB the {@code wasi_snapshot_preview1} reactor adapter's state
     * takes, which is measured and is the only thing known to come out of here: the rest of that
     * adapter's allocation goes through its own {@code cabi_import_realloc}, inside the state it
     * already has. The multiple is room for an adapter that grew a second block rather than a number
     * anything needs today, and the whole of it is 256 KiB of a 128 MiB heap.
     */
    private static final byte[] HOSTED = new byte[4 * 64 * 1024];

    /** How much of {@link #HOSTED} has been handed out. It never goes back down. */
    private static int hostedUsed;

    /**
     * The region <b>gg's own call</b> is served from: the request on the way out, and the answer on
     * the way back.
     *
     * <p>Replaced whenever a call needs more than it has, which is safe because nothing outside Java
     * holds an address into it between calls. It starts empty because the first call sizes it.
     */
    private static byte[] wire = new byte[RETURN_AREA + SLACK];

    /** How much of {@link #wire} is spoken for. Reset by {@link #reserve}. */
    private static int wireUsed = RETURN_AREA;

    /**
     * Whether {@link #cabiRealloc} is being called <b>by gg</b> rather than by the adapter.
     *
     * <p>True across {@link #wireTake} and nowhere else, which is the whole of how one exported
     * allocator serves two callers with opposite lifetimes. See the class note.
     */
    private static boolean taking;

    /**
     * Make one gg call.
     *
     * @param op the rendered operation id — {@code files.read_file}
     * @param request the encoded arguments
     * @return the encoded response
     */
    public static byte[] call(String op, byte[] request) {
        byte[] name = utf8(op);
        reserve(name.length + request.length);

        // Everything that can allocate is done before the address is taken, and nothing between
        // taking it and the call returning allocates at all. See the class note.
        int operation = bump(name.length);
        System.arraycopy(name, 0, wire, operation, name.length);
        int payload = bump(request.length);
        System.arraycopy(request, 0, wire, payload, request.length);

        int base = Address.ofData(wire).toInt();
        int length = wireCall(base + operation, name.length, base + payload, request.length);

        // The one moment the guest may allocate: the host is holding nothing, and what it will write
        // is now a known size. See the class note.
        reserve(length);
        base = Address.ofData(wire).toInt();
        taking = true;
        wireTake(base);
        taking = false;
        int answer = Address.ofData(wire).getInt() - base;
        int handed = Address.ofData(wire).add(4).getInt();
        byte[] response = new byte[handed];
        System.arraycopy(wire, answer, response, 0, handed);
        return response;
    }

    /**
     * {@code test-cabinet:gg/wire}'s {@code call}, lowered.
     *
     * <p>The four parameters are what the canonical ABI flattens
     * {@code call: func(op: string, request: list<u8>) -> u32} into: the two pointer/length pairs of
     * the arguments. The result is a scalar, so this half needs no return area and asks
     * {@link #cabiRealloc} for nothing. The module name is the WIT interface id, which is what makes
     * the core import one {@code wit-component} can resolve against the world.
     */
    @Import(module = "test-cabinet:gg/wire", name = "call")
    private static native int wireCall(int op, int opLength, int request, int requestLength);

    /**
     * {@code test-cabinet:gg/wire}'s {@code take}, lowered.
     *
     * <p>{@code take: func() -> list<u8>} flattens to the address of the return area the answer's own
     * pointer and length are written into — and the answer's bytes are what {@link #cabiRealloc}
     * hands the host room for. It is the only imported call this SDK receives bytes through, which is
     * what makes {@link #taking} a reliable way to tell gg's allocation from the adapter's.
     */
    @Import(module = "test-cabinet:gg/wire", name = "take")
    private static native void wireTake(int returnArea);

    /**
     * The allocator the canonical ABI requires an exported component to have.
     *
     * <p>A bump pointer over one of two regions — see the class note for which, and for why
     * allocating a Java object here would be a use-after-move rather than a slow path. Neither
     * region frees: {@link #HOSTED} never reclaims anything at all, and {@link #wire} is reset by
     * {@link #reserve}, which runs only where nothing outside Java holds an address into it.
     *
     * @param original the block being resized, or zero to allocate
     * @param originalSize how big that block was
     * @param alignment the alignment the caller needs
     * @param size how many bytes it wants
     * @return the address of the block, or zero when the region has none left
     */
    @Export(name = "cabi_realloc")
    public static int cabiRealloc(int original, int originalSize, int alignment, int size) {
        byte[] region = taking ? wire : HOSTED;
        int base = Address.ofData(region).toInt();
        if (size == 0) {
            return base;
        }
        // ALIGNED ON THE ADDRESS, NOT ON THE OFFSET, and the difference is a trap. A Java array's
        // data does not start on an eight-byte boundary just because it is an array: measured, a
        // region whose offsets were eight-aligned handed the preview1 adapter a block one word out,
        // and the first `clock_time_get` — which writes a `u64` through it — died with
        // `wasm trap: pointer not aligned` before a single line of the program's own output.
        int aligned = alignment < 1 ? 1 : alignment;
        int at = used(region);
        int drift = (base + at) % aligned;
        if (drift != 0) {
            at += aligned - drift;
        }
        if (at + size > region.length) {
            return 0;
        }
        use(region, at + size);
        // A resize keeps what was in the old block, because the canonical ABI's caller may already
        // have written into it. gg's host never asks for one; the adapter may.
        if (original != 0 && originalSize > 0) {
            int from = original - base;
            if (from >= 0 && from + originalSize <= region.length) {
                System.arraycopy(region, from, region, at, Math.min(originalSize, size));
            }
        }
        return base + at;
    }

    /**
     * The canonical ABI return area for a {@code list} with nothing in it.
     *
     * <p>What gg's generated entry class answers {@code bound-operations} with. That export exists
     * because gg instantiates every component of this membrane through the {@code sandbox} world's
     * bindings and a missing export is an instantiation failure; what it means — which of gg's
     * fifteen typed interfaces this component imports — has one true answer for a compiled arm,
     * which is none of them.
     *
     * @return the address of a pointer and a length, both zero
     */
    public static int emptyList() {
        Address area = Address.ofData(wire);
        area.putInt(0);
        area.add(4).putInt(0);
        return area.toInt();
    }

    /** How much of `region` is spoken for. */
    private static int used(byte[] region) {
        return region == HOSTED ? hostedUsed : wireUsed;
    }

    /** Record that `region` is spoken for up to `at`. */
    private static void use(byte[] region, int at) {
        if (region == HOSTED) {
            hostedUsed = at;
        } else {
            wireUsed = at;
        }
    }

    /** Make sure {@link #wire} can hold `bytes` handed out after the return area, and start over. */
    private static void reserve(int bytes) {
        wireUsed = RETURN_AREA;
        int wanted = RETURN_AREA + bytes + SLACK;
        if (wire.length < wanted) {
            wire = new byte[wanted];
        }
    }

    /** Take `bytes` from {@link #wire}, eight-aligned, and answer where they start. */
    private static int bump(int bytes) {
        int at = (wireUsed + 7) / 8 * 8;
        wireUsed = at + bytes;
        return at;
    }

    /** A string's UTF-8 bytes, which is the only encoding this membrane speaks. */
    private static byte[] utf8(String value) {
        return value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }
}
