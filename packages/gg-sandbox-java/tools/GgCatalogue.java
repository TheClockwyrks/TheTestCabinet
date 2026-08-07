package tools;

import java.util.List;

/**
 * The <b>identity</b> half of this arm's catalogue: which function is which, on which object,
 * gated by what.
 *
 * <p>Nothing here is prose a model reads. Every word of that — what a function does, what to put
 * in each argument, what a type's member means — is written on the declaration it describes, in
 * {@code src/gg/}, and reflected out of the JDK's own doclet API by {@link GgSignatures}. What is
 * here is the part Java cannot say: that {@code fs.readFile} <b>is</b> gg's {@code read_file}
 * tool, that {@code review.requestChanges} is the same capability Python spells
 * {@code review.request_changes}, and that {@code view.openFile} is bound exactly when
 * {@code read_file} is.
 *
 * <p>That split is what makes the agreement gate possible: it compares two languages' catalogues
 * by identity — section, object, key, gate, ending — and lets every spelling differ.
 *
 * <p>{@link GgSignatures} checks this file against the SDK it reflects in both directions: a name
 * here that no class declares, and a public method of an API object that nothing here names, each
 * fail the reflection rather than reaching a model.
 */
final class GgCatalogue {
    private GgCatalogue() {
    }

    /** One entry: a section, an identity, and where its Java declaration is. */
    record Entry(String section, String key, String object, String name, String className,
            String gate, String ending) {
    }

    /**
     * The API objects a program's surface is divided into, <b>in the order it is presented in</b>,
     * each with the class whose methods it is built from and the field of {@code Gg} that holds
     * it.
     *
     * <p>The order is model-facing: it is the sequence the system prompt's API list renders in and
     * the sequence the run's agent surface reports. It runs from the objects almost every run has
     * ({@code fs}, {@code system}) to the ones a particular shape of agent has ({@code programs},
     * {@code harness}, {@code review}), because a model reads a list from the top.
     *
     * <p>The object's own one-line description is not here: it is the doc comment on the field in
     * {@code gg.Gg} that holds it.
     */
    static final List<String[]> OBJECTS = List.of(
            new String[] {"fs", "Fs"},
            new String[] {"system", "Shell"},
            new String[] {"project", "Project"},
            new String[] {"tasks", "Tasks"},
            new String[] {"memory", "Memory"},
            new String[] {"view", "View"},
            new String[] {"context", "Context"},
            new String[] {"agents", "Agents"},
            new String[] {"skills", "Skills"},
            new String[] {"programs", "Programs"},
            new String[] {"harness", "Harness"},
            new String[] {"review", "Review"});

    /**
     * Every gg tool a program can call, in {@code ALL_TOOL_NAMES} order — which is the order gg
     * documents them in everywhere else.
     *
     * <p>A tool carries its own identity: {@code key} is its name in gg's vocabulary, and every
     * language's catalogue describes the same set of them under its own spellings.
     */
    static final List<Entry> TOOLS = List.of(
            tool("shell", "system", "Shell", "shell"),
            tool("read_file", "fs", "Fs", "readFile"),
            tool("write_file", "fs", "Fs", "writeFile"),
            tool("edit_file", "fs", "Fs", "editFile"),
            tool("list_dir", "fs", "Fs", "listDir"),
            tool("read_skill", "skills", "Skills", "readSkill"),
            tool("write_memory", "memory", "Memory", "writeMemory"),
            tool("update_memory", "memory", "Memory", "updateMemory"),
            tool("create_memory", "memory", "Memory", "createMemory"),
            tool("read_memory", "memory", "Memory", "readMemory"),
            tool("edit_memory", "memory", "Memory", "editMemory"),
            tool("search_memories", "memory", "Memory", "searchMemories"),
            tool("delete_memory", "memory", "Memory", "deleteMemory"),
            tool("add_task", "tasks", "Tasks", "addTask"),
            tool("update_task", "tasks", "Tasks", "updateTask"),
            tool("set_blocked_by", "tasks", "Tasks", "setBlockedBy"),
            tool("complete_task", "tasks", "Tasks", "completeTask"),
            tool("remove_task", "tasks", "Tasks", "removeTask"),
            tool("create_epic", "project", "Project", "createEpic"),
            tool("create_issue", "project", "Project", "createIssue"),
            tool("update_issue", "project", "Project", "updateIssue"),
            tool("set_issue_blocked_by", "project", "Project", "setIssueBlockedBy"),
            tool("remove_epic", "project", "Project", "removeEpic"),
            tool("remove_issue", "project", "Project", "removeIssue"),
            tool("wait_for_issue", "project", "Project", "waitForIssue"),
            tool("evict_file_view", "context", "Context", "evictFileView"),
            tool("archive_thread", "context", "Context", "archiveThread"),
            tool("search_archive", "context", "Context", "searchArchive"),
            tool("compact", "context", "Context", "compact"),
            tool("spawn_subagent", "agents", "Agents", "spawnSubagent"),
            tool("wait_for_subagents", "agents", "Agents", "waitForSubagents"),
            tool("send_message", "agents", "Agents", "sendMessage"),
            tool("transition_state", "agents", "Agents", "transitionState"),
            tool("exec", "agents", "Agents", "exec"),
            tool("fork", "agents", "Agents", "fork"));

    /**
     * Every helper bound alongside a tool: not a tool itself, so it can never perturb the
     * bijection between the guest's bound names and gg's tool vocabulary, but bound into a
     * program's scope and catalogued whenever the tool it is built on is enabled.
     */
    static final List<Entry> HELPERS = List.of(
            new Entry("helpers", "read_text_file", "fs", "readTextFile", "Fs", "read_file", null));

    /**
     * Every model-facing function that <b>ends a session</b>, one group per role. None of them is
     * a gg tool; each carries a {@code key} instead, which is the identity another language's SDK
     * spells its own way.
     */
    static final List<Entry> SESSION = List.of(
            new Entry("session", "finish", "harness", "finish", "Harness", null, "standard"),
            new Entry("session", "approve", "review", "approve", "Review", null, "review"),
            new Entry("session", "request_changes", "review", "requestChanges", "Review", null,
                    "review"));

    /**
     * Every model-facing <b>view</b> function — the calls that put material into the agent's own
     * context window.
     *
     * <p>{@code openFile} is a read, so it is bound exactly when {@code read_file} is; the other
     * four are ungated, the same carve-out {@code harness} has and for the same reason: a run that
     * enables no tools at all must still be able to show its model something, and must always be
     * able to read what the functions it does have do.
     */
    static final List<Entry> VIEWS = List.of(
            new Entry("views", "open_file", "view", "openFile", "View", "read_file", null),
            new Entry("views", "open_text", "view", "openText", "View", null, null),
            new Entry("views", "open_docs_view", "view", "openDocsView", "View", null, null),
            new Entry("views", "close", "view", "close", "View", null, null),
            new Entry("views", "current", "view", "current", "View", null, null));

    /**
     * Every model-facing function on the <b>program library</b>. They carry no gate at all: the
     * whole object is bound or absent together, from a capability rather than from a tool or a
     * role.
     */
    static final List<Entry> PROGRAMS = List.of(
            new Entry("programs", "history", "programs", "history", "Programs", null, null),
            new Entry("programs", "get", "programs", "get", "Programs", null, null),
            new Entry("programs", "rerun", "programs", "rerun", "Programs", null, null));

    /**
     * Every model-facing function that belongs to <b>no</b> API object, because it belongs to all
     * of them.
     *
     * <p>{@code list} is the whole of it: every API object inherits one from {@code gg.ApiObject}
     * with that object's own name closed over, so the function a program calls takes no arguments
     * and there is no one object it hangs off.
     */
    static final List<Entry> META = List.of(
            new Entry("meta", "list", null, "list", "ApiObject", null, null));

    /**
     * The classes in {@code gg} that are not part of the catalogue's {@code types} section: the
     * twelve API objects, the class that holds them, the base class every one of them inherits
     * {@code list} from, and the namespace a code module binds at.
     */
    static final List<String> NOT_A_TYPE = List.of("Gg", "ApiObject", "Lib", "Fs", "Shell",
            "Project", "Tasks", "Memory", "View", "Context", "Agents", "Skills", "Programs",
            "Harness", "Review");

    private static Entry tool(String key, String object, String className, String name) {
        return new Entry("tools", key, object, name, className, key, null);
    }
}
