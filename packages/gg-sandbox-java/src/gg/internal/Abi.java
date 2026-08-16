package gg.internal;

import org.teavm.interop.Address;
import org.teavm.interop.Export;
import org.teavm.interop.Import;

/**
 * <b>The crossing</b> — the whole of what this SDK implements of the WebAssembly canonical ABI, and
 * the only class in it that knows there is a host at all.
 *
 * <p>Nothing here is model-facing. A program never imports this package, no catalogue entry
 * describes it, and no prompt names it; what a model reads is the typed, namespaced surface the
 * {@code gg} classes build on top of it.
 *
 * <h2>Why there is an ABI layer at all</h2>
 *
 * <p>A Java program reaches gg as a <b>WebAssembly component</b>: {@code javac} produces bytecode,
 * TeaVM's {@code WEBASSEMBLY_WASI} backend produces a core module, and gg encodes that module as a
 * component of the {@code jvm-sandbox} world. Every other guest gg drives has a binding generator
 * that writes the canonical ABI for the fifteen typed interfaces of
 * {@code crates/gg/wit/gg-sandbox.wit}. There is no {@code wit-bindgen} for Java and none is coming,
 * so the JVM arms reach gg through <b>one</b> imported function — {@code test-cabinet:gg/wire}'s
 * {@code call} — and the canonical ABI this class implements is therefore <b>a string and two byte
 * lists</b>, which is about forty lines of it.
 *
 * <p>What travels inside those byte lists is {@link Coding}'s business, and gg owns both ends of it.
 *
 * <h2>The arena, and why {@code cabi_realloc} allocates nothing</h2>
 *
 * <p>Both directions of a call need bytes at an address the host can read and write, and TeaVM's
 * garbage collector <b>compacts</b> — it moves objects. That is fine for as long as nothing outside
 * Java holds an address, and the whole design here is to make that window as small as it can be:
 *
 * <ol>
 *   <li>Everything that allocates happens first, in ordinary Java, against {@link #arena}.
 *   <li>The address of the arena is taken, and the import is called. <b>No allocation happens from
 *       here until the call returns.</b>
 *   <li>The host lifts the two arguments out of that memory, runs the call, and lowers the answer
 *       back in — asking {@link #cabiRealloc} for room as the canonical ABI requires. That function
 *       is a <b>bump pointer over the same arena and nothing else</b>: it allocates no Java object,
 *       so no collection can run and the address the host is holding cannot move under it.
 *   <li>The guest reads the answer back out of the arena by ordinary array indexing.
 * </ol>
 *
 * <p>The arena is sized before each call to hold the request plus {@link #RESPONSE_HEADROOM}. The
 * headroom is a fixed 4 MiB against gg's own largest answer: the file read is cut at a 256 KiB byte
 * ceiling and every other cap on the membrane — the 16 KiB shell tail, the view caps, the memory and
 * board caps — is smaller, so the room reserved is more than an order of magnitude past the largest
 * thing gg will send. A response that somehow exceeded it would leave {@link #cabiRealloc} nothing
 * to hand back, and the program would be killed by the trap the canonical ABI defines for that —
 * loudly, which is the right failure for a state gg's own ceilings say cannot arise.
 */
public final class Abi {
    private Abi() {
    }

    /** The bytes reserved for the host's answer, over and above the request — see the class note. */
    private static final int RESPONSE_HEADROOM = 1024 * 1024;

    /** The size of the canonical ABI's return area for a {@code list<u8>}: a pointer and a length. */
    private static final int RETURN_AREA = 8;

    /**
     * The one region the host reads from and writes to.
     *
     * <p>Its first {@link #RETURN_AREA} bytes are the return area the import writes its answer's
     * pointer and length into; everything after them is handed out by {@link #bump}.
     */
    private static byte[] arena = new byte[RETURN_AREA + RESPONSE_HEADROOM];

    /** How much of {@link #arena} is spoken for. Reset at the start of every call. */
    private static int used = RETURN_AREA;

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
        System.arraycopy(name, 0, arena, operation, name.length);
        int payload = bump(request.length);
        System.arraycopy(request, 0, arena, payload, request.length);

        int base = Address.ofData(arena).toInt();
        wireCall(base + operation, name.length, base + payload, request.length, base);

        int answer = Address.ofData(arena).getInt() - base;
        int length = Address.ofData(arena).add(4).getInt();
        byte[] response = new byte[length];
        System.arraycopy(arena, answer, response, 0, length);
        return response;
    }

    /**
     * {@code test-cabinet:gg/wire}'s {@code call}, lowered.
     *
     * <p>The five parameters are what the canonical ABI flattens
     * {@code call: func(op: string, request: list<u8>) -> list<u8>} into: the two pointer/length
     * pairs of the arguments, and the address of the return area the answer's own pointer and length
     * are written to. The module name is the WIT interface id, which is what makes the core import
     * one {@code wit-component} can resolve against the world.
     */
    @Import(module = "test-cabinet:gg/wire", name = "call")
    private static native void wireCall(int op, int opLength, int request, int requestLength,
            int returnArea);

    /**
     * The allocator the canonical ABI requires an exported component to have.
     *
     * <p>A bump pointer, deliberately — see the class note for why allocating a Java object here
     * would be a use-after-move rather than a slow path. It never frees and never reuses: the arena
     * is reset at the start of the next call, which is the only moment at which nothing outside Java
     * holds an address into it.
     *
     * @param original the block being resized; always zero here, because gg's host only ever asks
     *     this to allocate
     * @param originalSize how big that block was
     * @param alignment the alignment the caller needs
     * @param size how many bytes it wants
     * @return the address of the block, or zero when the arena has none left
     */
    @Export(name = "cabi_realloc")
    public static int cabiRealloc(int original, int originalSize, int alignment, int size) {
        if (size == 0) {
            return Address.ofData(arena).toInt();
        }
        int aligned = alignment < 1 ? 1 : alignment;
        int at = (used + aligned - 1) / aligned * aligned;
        if (at + size > arena.length) {
            return 0;
        }
        used = at + size;
        return Address.ofData(arena).toInt() + at;
    }

    /**
     * The canonical ABI return area for a {@code list} with nothing in it.
     *
     * <p>What gg's generated entry class answers {@code bound-tools} with. That export exists
     * because gg instantiates every component of this membrane through the {@code sandbox} world's
     * bindings and a missing export is an instantiation failure; what it means — which of gg's
     * fifteen typed interfaces this component imports — has one true answer for a compiled arm,
     * which is none of them.
     *
     * @return the address of a pointer and a length, both zero
     */
    public static int emptyList() {
        Address area = Address.ofData(arena);
        area.putInt(0);
        area.add(4).putInt(0);
        return area.toInt();
    }

    /** Make sure the arena can hold `bytes` of request and the host's whole answer after it. */
    private static void reserve(int bytes) {
        used = RETURN_AREA;
        // Sixteen bytes of slack for the eight-byte alignment `bump` rounds each of the two
        // arguments up to, so a request that exactly fits cannot leave the headroom short.
        int wanted = RETURN_AREA + bytes + 16 + RESPONSE_HEADROOM;
        if (arena.length < wanted) {
            arena = new byte[wanted];
        }
    }

    /** Take `bytes` from the arena, eight-aligned, and answer where they start. */
    private static int bump(int bytes) {
        int at = (used + 7) / 8 * 8;
        used = at + bytes;
        return at;
    }

    /** A string's UTF-8 bytes, which is the only encoding this membrane speaks. */
    private static byte[] utf8(String value) {
        return value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }
}
