package gg.memories;

import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.List;
import java.util.OptionalInt;

/**
 * Durable memories, which survive a context compaction.
 *
 * <p>A run picks one of three memory strategies and binds only that strategy's calls: the
 * scratchpad's {@code writeMemory} and {@code updateMemory}, or the file-shaped
 * {@code createMemory}, {@code readMemory} and {@code editMemory} — plus {@code searchMemories}
 * where there is no pinned index. {@code deleteMemory} is bound under all three, and the system
 * prompt says which strategy is in force.
 *
 * <p>A memory may carry code, which is a module in this language bound at {@code lib.<name>} in
 * every later program — a helper written once. It costs no context window and is never shown back.
 *
 * @ggmodule memories
 */
public final class Memories {
    private Memories() {
    }

    /**
     * Record a durable memory that survives a context compaction.
     *
     * <p>The scratchpad strategy's write, which keeps the memory in the context window rather than
     * outside it. Every mutation hands back the budget after it, so a program decides whether to
     * write another by reading numbers rather than by parsing a sentence about them.
     *
     * @param name The memory's slug: letters, digits, {@code -}, {@code _} and {@code .}. It is what
     *     every other memory call takes, and no two memories may share one.
     * @param description A one-line description of what the memory holds.
     * @param body The memory's contents.
     * @return how much of the memory budget is now used
     * @throws ToolError {@link ToolErrorCode#CONFLICT} on a duplicate name, and
     *     {@link ToolErrorCode#LIMIT_EXCEEDED} when the body would breach this run's caps.
     * @ggop memories.write_memory
     */
    public static MemoryUsage writeMemory(String name, String description, String body) {
        return write("memories.write_memory", name, description, body, null);
    }

    /**
     * Record a durable memory that also carries code.
     *
     * @param name The memory's slug: letters, digits, {@code -}, {@code _} and {@code .}.
     * @param description A one-line description of what the memory holds.
     * @param body The memory's contents.
     * @param code The module, the on-use script, or both.
     * @return how much of the memory budget is now used
     * @throws ToolError {@link ToolErrorCode#CONFLICT} on a duplicate name, and
     *     {@link ToolErrorCode#LIMIT_EXCEEDED} when the body would breach this run's caps.
     * @ggop memories.write_memory
     */
    public static MemoryUsage writeMemory(String name, String description, String body,
            MemoryCode code) {
        return write("memories.write_memory", name, description, body, code);
    }

    /**
     * Replace a memory's description and body, keyed on its name.
     *
     * <p>Its code is replaced too, so leaving the code out clears whatever the memory carried.
     *
     * @param name The slug of the memory to replace.
     * @param description The one-line description to replace the old one with.
     * @param body The contents to replace the old ones with.
     * @return how much of the memory budget is now used
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when no memory has that name.
     * @ggop memories.update_memory
     */
    public static MemoryUsage updateMemory(String name, String description, String body) {
        return write("memories.update_memory", name, description, body, null);
    }

    /**
     * Replace a memory, giving it code as well as prose.
     *
     * @param name The slug of the memory to replace.
     * @param description The one-line description to replace the old one with.
     * @param body The contents to replace the old ones with.
     * @param code The module, the on-use script, or both, replacing whatever the memory carried.
     * @return how much of the memory budget is now used
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when no memory has that name.
     * @ggop memories.update_memory
     */
    public static MemoryUsage updateMemory(String name, String description, String body,
            MemoryCode code) {
        return write("memories.update_memory", name, description, body, code);
    }

    /**
     * Record a memory whose contents stay out of the context window until they are read.
     *
     * <p>The file-shaped strategies' write. What is in context is the description — the memory's line
     * in the index — rather than the body.
     *
     * @param name The memory's slug: letters, digits, {@code -}, {@code _} and {@code .}.
     * @param description A one-line description of what the memory holds, which is its line in the
     *     index.
     * @param body The memory's initial contents, which stay out of the context window until read.
     * @return how much of the memory budget is now used
     * @throws ToolError {@link ToolErrorCode#CONFLICT} on a duplicate slug, and
     *     {@link ToolErrorCode#LIMIT_EXCEEDED} when the contents, or the index entry, would breach a
     *     limit.
     * @ggop memories.create_memory
     */
    public static MemoryUsage createMemory(String name, String description, String body) {
        return write("memories.create_memory", name, description, body, null);
    }

    /**
     * Record an out-of-context memory that also carries code, bound when it is first read.
     *
     * @param name The memory's slug: letters, digits, {@code -}, {@code _} and {@code .}.
     * @param description A one-line description of what the memory holds.
     * @param body The memory's initial contents.
     * @param code The module bound at {@code lib.<name>} once the memory is read, the script gg runs
     *     on that first read, or both.
     * @return how much of the memory budget is now used
     * @throws ToolError {@link ToolErrorCode#CONFLICT} on a duplicate slug, and
     *     {@link ToolErrorCode#LIMIT_EXCEEDED} when the contents, or the index entry, would breach a
     *     limit.
     * @ggop memories.create_memory
     */
    public static MemoryUsage createMemory(String name, String description, String body,
            MemoryCode code) {
        return write("memories.create_memory", name, description, body, code);
    }

    /**
     * Read one memory's full contents by slug, which is what brings them into the context window.
     *
     * <p>A memory that carries code has that code loaded by the same read: the reply names the
     * {@code lib.<key>} it is bound at, and it stays bound for the rest of the session.
     *
     * @param name The memory's slug.
     * @return the memory's contents
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when no memory has that slug.
     * @ggop memories.read_memory
     */
    public static String readMemory(String name) {
        return Coding.call("memories.read_memory", Value.of(name)).text();
    }

    /**
     * Revise a memory in place, replacing the one exact occurrence of some text.
     *
     * <p>Appending is quoting the last line and replacing it with itself plus what is being added.
     *
     * @param name The slug of the memory to revise.
     * @param search The exact text to find in its contents. It must appear exactly once.
     * @param replace The text to put in its place.
     * @return how much of the memory budget is now used
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when the text does not appear,
     *     {@link ToolErrorCode#CONFLICT} when it appears more than once,
     *     {@link ToolErrorCode#LIMIT_EXCEEDED} when the result would be too long, and
     *     {@link ToolErrorCode#INVALID_ARGUMENT} when the edit would leave the memory empty.
     * @ggop memories.edit_memory
     */
    public static MemoryUsage editMemory(String name, String search, String replace) {
        Value edit = Value.record()
                .put("name", Value.of(name))
                .put("search", Value.of(search))
                .put("replace", Value.of(replace));
        return Read.memoryUsage(Coding.call("memories.edit_memory", edit));
    }

    /**
     * Find the memories mentioning any of some keywords, best first.
     *
     * <p>Plain case-insensitive substring matching over each memory's slug, description and
     * contents, ranked by how many distinct keywords a memory mentions and then by how often.
     * Several specific words rank better than one sentence. A search that matches nothing is an
     * empty list.
     *
     * @param keywords The words to look for. Several specific words rank better than one sentence,
     *     because a memory is ranked by how many of them it mentions.
     * @return every memory that mentioned one, best first
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} when every keyword is empty.
     * @ggop memories.search_memories
     */
    public static List<MemoryHit> searchMemories(String... keywords) {
        return Read.memoryHits(Coding.call("memories.search_memories", Value.texts(keywords)));
    }

    /**
     * Evict a memory by name, freeing room in the budget.
     *
     * @param name The memory's slug.
     * @return how much of the memory budget is now used
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when no memory has that name.
     * @ggop memories.delete_memory
     */
    public static MemoryUsage deleteMemory(String name) {
        return Read.memoryUsage(Coding.call("memories.delete_memory", Value.of(name)));
    }

    /** The `memory-input` record every write of one takes, as gg's own WIT declares it. */
    private static MemoryUsage write(String op, String slug, String description, String body,
            MemoryCode code) {
        Value written = Value.record()
                .put("name", Value.of(slug))
                .put("description", Value.of(description))
                .put("body", Value.of(body))
                .put("code", Value.of(code == null ? null : code.module()))
                .put("on-use", Value.of(code == null ? null : code.onUseScript()));
        return Read.memoryUsage(Coding.call(op, written));
    }

    // -------------------------------------------------------------------------------------------
    // The types the memory store takes and hands back
    // -------------------------------------------------------------------------------------------

    /**
     * How much of the run's durable-memory budget is used, after the call that returned it.
     *
     * <p>Every maximum is optional: each limit can be turned off, and a run's memory strategy applies
     * only some of them, so an empty one means nothing bounds that axis.
     *
     * @param count Memories currently held.
     * @param maxCount The most memories this run allows, where it limits the count.
     * @param totalChars Characters of body currently held, across every memory.
     * @param maxTotalChars The most characters of body this run allows in total, where it limits the
     *     aggregate.
     * @param indexChars Characters the memory index occupies, under a run that keeps one.
     * @param maxIndexChars The most characters the index may occupy, where it is limited.
     */
    public record MemoryUsage(int count, OptionalInt maxCount, int totalChars,
            OptionalInt maxTotalChars, OptionalInt indexChars, OptionalInt maxIndexChars) {
    }

    /**
     * One memory a search matched, and the numbers it was ranked by.
     *
     * @param name The memory's slug — what {@link Memories#readMemory} takes.
     * @param description Its description, or empty where it was created without one.
     * @param matched How many distinct keywords it matched, which is the primary ranking.
     * @param occurrences How many times those keywords occur in it, which is the tiebreak.
     * @param excerpt A short window of the memory around its first match.
     */
    public record MemoryHit(String name, String description, int matched, int occurrences,
            String excerpt) {

        /**
         * Read this memory in full, which is {@link Memories#readMemory} on its own slug.
         *
         * @return the memory's contents
         * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when the memory has since been deleted.
         * @ggalias memories.read_memory
         */
        public String read() {
            return Memories.readMemory(name);
        }
    }

    /**
     * The two code halves a memory may carry beside its prose.
     *
     * <p>Neither is context: they cost no window, are never shown back, and count against no body
     * limit. One of the three factories says which halves are in hand, and leaving the argument off
     * entirely is a memory that is only prose.
     */
    public static final class MemoryCode {
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
         *     {@code lib.<name>} for the rest of the session.
         * @return the code half to hand to a memory write
         */
        public static MemoryCode module(String source) {
            return new MemoryCode(source, null);
        }

        /**
         * A memory that runs a script when it first comes into use and carries no module.
         *
         * @param script A program gg runs the first time the memory comes into use; whatever it
         *     shows arrives on the next turn.
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
}
