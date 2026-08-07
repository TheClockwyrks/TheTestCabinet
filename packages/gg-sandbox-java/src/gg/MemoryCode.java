package gg;

/**
 * The two code halves a memory may carry beside its prose, and which every write of one accepts.
 *
 * <p>Neither is context: they cost you no window, are never shown back to you, and count against
 * no body limit. Build one with whichever of the three factories says what you have —
 * {@code memory.createMemory("csv", "reading csv", body, MemoryCode.module(source))} — and leave
 * the argument off entirely for a memory that is only prose.
 */
public final class MemoryCode {
    private final String module;
    private final String onUse;

    private MemoryCode(String module, String onUse) {
        this.module = module;
        this.onUse = onUse;
    }

    /**
     * A memory that carries a code module and runs nothing.
     *
     * @param source A Java class body whose {@code public static} methods are bound at
     *     {@code lib.<name>} for the rest of your session.
     * @return the code half to hand to a memory write
     */
    public static MemoryCode module(String source) {
        return new MemoryCode(source, null);
    }

    /**
     * A memory that runs a script when it first comes into use and carries no module.
     *
     * @param script A program gg runs the first time the memory comes into use; whatever it shows
     *     you arrives on your next turn.
     * @return the code half to hand to a memory write
     */
    public static MemoryCode onUse(String script) {
        return new MemoryCode(null, script);
    }

    /**
     * A memory that carries both a module and an on-use script.
     *
     * @param source A Java class body whose {@code public static} methods are bound at
     *     {@code lib.<name>}.
     * @param script A program gg runs the first time the memory comes into use.
     * @return the code half to hand to a memory write
     */
    public static MemoryCode of(String source, String script) {
        return new MemoryCode(source, script);
    }

    /** The module source, or {@code null}. */
    String module() {
        return module;
    }

    /** The on-use script, or {@code null}. */
    String onUseScript() {
        return onUse;
    }
}
