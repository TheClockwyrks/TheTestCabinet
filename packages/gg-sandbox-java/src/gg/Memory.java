package gg;

import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * The {@code memory} object: durable notes that survive context compaction.
 *
 * <p>A run picks one of three memory strategies, and only that strategy's functions are bound — so
 * {@code memory.list()} is the honest answer to "what can I do with memory here?". The scratchpad
 * keeps every memory in the context window ({@code writeMemory}/{@code updateMemory}); the two
 * file-shaped strategies keep the contents <em>outside</em> it
 * ({@code createMemory}/{@code readMemory}/{@code editMemory}), one behind an index that is always
 * in context and one behind {@code searchMemories}. {@code deleteMemory} is bound under all three.
 *
 * <p>Every mutation hands back the budget after it, so a program can decide whether to write
 * another memory by reading numbers rather than by parsing a sentence about them.
 */
public final class Memory extends ApiObject {
    Memory() {
        super("memory");
    }

    @Override
    JSObject target() {
        return Wire.memory();
    }

    /**
     * Record a durable memory that survives context compaction, and hand back how much of the
     * memory budget is now used.
     *
     * @param name The memory's slug: letters, digits, {@code -}, {@code _} and {@code .}. It is
     *     what every other memory call takes, and no two memories may share one.
     * @param description A one-line description of what the memory holds. Where the run keeps a
     *     memory index this is the memory's line in it, and so all you see of the memory until you
     *     read it.
     * @param body The memory's contents.
     * @return how much of the memory budget is now used
     * @throws ToolError {@code CONFLICT} on a duplicate name, and {@code LIMIT_EXCEEDED} when the
     *     body would breach the run's caps — revise or delete a memory rather than accruing more.
     */
    public MemoryUsage writeMemory(String name, String description, String body) {
        return write("write_memory", "writeMemory", name, description, body, null);
    }

    /**
     * Record a durable memory that also carries code.
     *
     * <p>A memory's code costs you no window, is never shown back to you, and counts against no
     * body limit: a module is bound at {@code lib.<name>} in every later program you write, so a
     * helper you get right once you never write again, and an on-use script runs the first time
     * the memory comes into use with its views reaching you on your next turn.
     *
     * @param name The memory's slug: letters, digits, {@code -}, {@code _} and {@code .}.
     * @param description A one-line description of what the memory holds.
     * @param body The memory's contents.
     * @param code The module, the on-use script, or both.
     * @return how much of the memory budget is now used
     * @throws ToolError {@code CONFLICT} on a duplicate name, and {@code LIMIT_EXCEEDED} when the
     *     body would breach the run's caps.
     */
    public MemoryUsage writeMemory(String name, String description, String body,
            MemoryCode code) {
        return write("write_memory", "writeMemory", name, description, body, code);
    }

    /**
     * Replace an existing memory's description and body, keyed on its name, and hand back the
     * memory budget.
     *
     * <p>Its code is replaced too — leaving it out clears whatever the memory carried.
     *
     * @param name The slug of the memory to replace.
     * @param description The one-line description to replace the old one with.
     * @param body The contents to replace the old ones with.
     * @return how much of the memory budget is now used
     * @throws ToolError {@code NOT_FOUND} when no memory has that name.
     */
    public MemoryUsage updateMemory(String name, String description, String body) {
        return write("update_memory", "updateMemory", name, description, body, null);
    }

    /**
     * Replace an existing memory, giving it code as well as prose.
     *
     * @param name The slug of the memory to replace.
     * @param description The one-line description to replace the old one with.
     * @param body The contents to replace the old ones with.
     * @param code The module, the on-use script, or both, replacing whatever the memory carried.
     * @return how much of the memory budget is now used
     * @throws ToolError {@code NOT_FOUND} when no memory has that name.
     */
    public MemoryUsage updateMemory(String name, String description, String body,
            MemoryCode code) {
        return write("update_memory", "updateMemory", name, description, body, code);
    }

    /**
     * Record a new memory whose contents are kept OUT of your context window until you read them,
     * and hand back the memory budget.
     *
     * @param name The memory's slug: letters, digits, {@code -}, {@code _} and {@code .}.
     * @param description A one-line description of what the memory holds, which is its line in the
     *     index.
     * @param body The memory's initial contents. They stay out of your context window until you
     *     read them.
     * @return how much of the memory budget is now used
     * @throws ToolError {@code CONFLICT} on a duplicate slug, and {@code LIMIT_EXCEEDED} when the
     *     contents, or the index entry, would breach a limit.
     */
    public MemoryUsage createMemory(String name, String description, String body) {
        return write("create_memory", "createMemory", name, description, body, null);
    }

    /**
     * Record a new out-of-context memory that also carries code, bound once you read it.
     *
     * @param name The memory's slug: letters, digits, {@code -}, {@code _} and {@code .}.
     * @param description A one-line description of what the memory holds.
     * @param body The memory's initial contents.
     * @param code The module bound at {@code lib.<name>} once you read the memory, the script gg
     *     runs on that first read, or both.
     * @return how much of the memory budget is now used
     * @throws ToolError {@code CONFLICT} on a duplicate slug, and {@code LIMIT_EXCEEDED} when the
     *     contents, or the index entry, would breach a limit.
     */
    public MemoryUsage createMemory(String name, String description, String body,
            MemoryCode code) {
        return write("create_memory", "createMemory", name, description, body, code);
    }

    /**
     * Read one memory's full contents, by slug — the only thing that brings them into your
     * context.
     *
     * <p>If the memory carries code, reading it also loads that code: the reply names the
     * {@code lib.<key>} it is bound at, and it stays bound for the rest of your session.
     *
     * @param name The memory's slug.
     * @return the memory's contents
     * @throws ToolError {@code NOT_FOUND} when no memory has that slug.
     */
    public String readMemory(String name) {
        return Wire.asString(Wire.call("read_memory", target(), object(), "readMemory",
                Wire.args(Wire.text(name))));
    }

    /**
     * Revise a memory in place by replacing the one exact occurrence of {@code search} with
     * {@code replace}, and hand back the memory budget.
     *
     * <p>Append by quoting the last line and replacing it with itself plus what you are adding.
     *
     * @param name The slug of the memory to revise.
     * @param search The exact text to find in its contents. It must appear exactly once.
     * @param replace The text to put in its place.
     * @return how much of the memory budget is now used
     * @throws ToolError {@code NOT_FOUND} when the text does not appear, {@code CONFLICT} when it
     *     appears more than once, {@code LIMIT_EXCEEDED} when the result would be too long, and
     *     {@code INVALID_ARGUMENT} when the edit would leave the memory empty — delete it instead.
     */
    public MemoryUsage editMemory(String name, String search, String replace) {
        JSObject edit = Wire.object();
        Wire.set(edit, "name", Wire.text(name));
        Wire.set(edit, "search", Wire.text(search));
        Wire.set(edit, "replace", Wire.text(replace));
        return Read.memoryUsage(Wire.call("edit_memory", target(), object(), "editMemory",
                Wire.args(edit)));
    }

    /**
     * Find the memories mentioning any of {@code keywords}, best first.
     *
     * <p>Plain case-insensitive substring matching over each memory's slug, description and
     * contents, ranked by how many of your keywords a memory mentions and then by how often. Pass
     * several specific words rather than one sentence, then {@code memory.readMemory} the hits
     * worth having in full. A search that matches nothing is an empty list.
     *
     * @param keywords The words to look for. Several specific words rank better than one sentence,
     *     because a memory is ranked by how many of them it mentions.
     * @return every memory that mentioned one, best first
     * @throws ToolError {@code INVALID_ARGUMENT} when every keyword is empty.
     */
    public List<MemoryHit> searchMemories(String... keywords) {
        return Read.memoryHits(Wire.call("search_memories", target(), object(), "searchMemories",
                Wire.args(Wire.texts(keywords))));
    }

    /**
     * Evict a memory by name, freeing room in the budget, and hand back what is left in use.
     *
     * @param name The memory's slug.
     * @return how much of the memory budget is now used
     * @throws ToolError {@code NOT_FOUND} when no memory has that name.
     */
    public MemoryUsage deleteMemory(String name) {
        return Read.memoryUsage(Wire.call("delete_memory", target(), object(), "deleteMemory",
                Wire.args(Wire.text(name))));
    }

    /** The memory record every write of one takes, as the guest's own function wants it. */
    private MemoryUsage write(String tool, String name, String slug, String description,
            String body, MemoryCode code) {
        JSObject written = Wire.object();
        Wire.set(written, "name", Wire.text(slug));
        Wire.set(written, "description", Wire.text(description));
        Wire.set(written, "body", Wire.text(body));
        if (code != null && code.module() != null) {
            Wire.set(written, "code", Wire.text(code.module()));
        }
        if (code != null && code.onUseScript() != null) {
            Wire.set(written, "onUse", Wire.text(code.onUseScript()));
        }
        return Read.memoryUsage(Wire.call(tool, target(), object(), name, Wire.args(written)));
    }
}
