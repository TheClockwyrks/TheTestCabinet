package tools

/**
 * The **identity** half of this arm's catalogue: which function is which, on which object, gated by
 * what.
 *
 * Nothing here is prose a model reads. Every word of that — what a function does, what to put in each
 * argument, what a type's member means — is written on the declaration it describes, in `src/`, and
 * read out of the Kotlin compiler's own front end by [GgSignatures]. What is here is the part Kotlin
 * cannot say: that `fs.readFile` **is** gg's `read_file` tool, that `review.requestChanges` is the same
 * capability Python spells `review.request_changes`, and that `view.openFile` is bound exactly when
 * `read_file` is.
 *
 * That split is what makes the agreement gate possible: it compares two languages' catalogues by
 * identity — section, object, key, gate, ending — and lets every spelling differ.
 *
 * [GgSignatures] checks this file against the SDK it reflects in both directions: a name here that no
 * class declares, and a public function of an API object that nothing here names, each fail the
 * reflection rather than reaching a model.
 */
internal object GgCatalogue {
    /** One entry: a section, an identity, and where its Kotlin declaration is. */
    data class Entry(
        val section: String,
        val key: String,
        val owner: String?,
        val name: String,
        val className: String,
        val gate: String? = null,
        val ending: String? = null,
    )

    /**
     * The API objects a program's surface is divided into, **in the order it is presented in**, each
     * with the class whose functions it is built from.
     *
     * The order is model-facing: it is the sequence the system prompt's API list renders in and the
     * sequence the run's agent surface reports. It runs from the objects almost every run has (`fs`,
     * `system`) to the ones a particular shape of agent has (`programs`, `harness`, `review`), because
     * a model reads a list from the top.
     *
     * The object's own one-line description is not here: it is the KDoc on the top-level value that
     * holds it, in `src/Gg.kt`.
     */
    val OBJECTS: List<Pair<String, String>> =
        listOf(
            "fs" to "Fs",
            "system" to "Shell",
            "project" to "Project",
            "tasks" to "Tasks",
            "memory" to "Memory",
            "view" to "View",
            "context" to "Context",
            "agents" to "Agents",
            "skills" to "Skills",
            "programs" to "Programs",
            "harness" to "Harness",
            "review" to "Review",
        )

    /**
     * Every gg tool a program can call, in `ALL_TOOL_NAMES` order — which is the order gg documents
     * them in everywhere else.
     *
     * A tool carries its own identity: `key` is its name in gg's vocabulary, and every language's
     * catalogue describes the same set of them under its own spellings.
     */
    val TOOLS: List<Entry> =
        listOf(
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
            tool("fork", "agents", "Agents", "fork"),
        )

    /**
     * Every helper bound alongside a tool: not a tool itself, so it can never perturb the bijection
     * between the guest's bound names and gg's tool vocabulary, but bound into a program's scope and
     * catalogued whenever the tool it is built on is enabled.
     */
    val HELPERS: List<Entry> =
        listOf(
            Entry("helpers", "read_text_file", "fs", "readTextFile", "Fs", gate = "read_file"),
        )

    /**
     * Every model-facing function that **ends a session**, one group per role. None of them is a gg
     * tool; each carries a `key` instead, which is the identity another language's SDK spells its own
     * way.
     */
    val SESSION: List<Entry> =
        listOf(
            Entry("session", "finish", "harness", "finish", "Harness", ending = "standard"),
            Entry("session", "approve", "review", "approve", "Review", ending = "review"),
            Entry(
                "session",
                "request_changes",
                "review",
                "requestChanges",
                "Review",
                ending = "review",
            ),
        )

    /**
     * Every model-facing **view** function — the calls that put material into the agent's own context
     * window.
     *
     * `openFile` is a read, so it is bound exactly when `read_file` is; the other four are ungated, the
     * same carve-out `harness` has and for the same reason: a run that enables no tools at all must
     * still be able to show its model something, and must always be able to read what the functions it
     * does have do.
     */
    val VIEWS: List<Entry> =
        listOf(
            Entry("views", "open_file", "view", "openFile", "View", gate = "read_file"),
            Entry("views", "open_text", "view", "openText", "View"),
            Entry("views", "open_docs_view", "view", "openDocsView", "View"),
            Entry("views", "close", "view", "close", "View"),
            Entry("views", "current", "view", "current", "View"),
        )

    /**
     * Every model-facing function on the **program library**. They carry no gate at all: the whole
     * object is bound or absent together, from a capability rather than from a tool or a role.
     */
    val PROGRAMS: List<Entry> =
        listOf(
            Entry("programs", "history", "programs", "history", "Programs"),
            Entry("programs", "get", "programs", "get", "Programs"),
            Entry("programs", "rerun", "programs", "rerun", "Programs"),
        )

    /**
     * Every model-facing function that belongs to **no** API object, because it belongs to all of them.
     *
     * `list` is the whole of it: every API object inherits one from `ApiObject` with that object's own
     * name closed over, so the function a program calls takes no arguments and there is no one object
     * it hangs off.
     */
    val META: List<Entry> =
        listOf(Entry("meta", "list", null, "list", "ApiObject"))

    /**
     * The declarations in `src/` that are not part of the catalogue's `types` section: the twelve API
     * objects, the base class every one of them inherits `list` from, and the namespace a code module
     * binds at.
     *
     * There is no holder class to exclude beside them, because Kotlin needs none: the surface is
     * thirteen top-level values, which is what makes a program need no import at all.
     */
    val NOT_A_TYPE: List<String> =
        listOf(
            "ApiObject",
            "Lib",
            "Fs",
            "Shell",
            "Project",
            "Tasks",
            "Memory",
            "View",
            "Context",
            "Agents",
            "Skills",
            "Programs",
            "Harness",
            "Review",
        )

    /** Every entry, in the order the catalogue's sections carry them. */
    val ALL: List<Entry> = META + SESSION + VIEWS + PROGRAMS + TOOLS + HELPERS

    private fun tool(key: String, owner: String, className: String, name: String) =
        Entry("tools", key, owner, name, className, gate = key)
}
