"""The **identity** half of this arm's catalogue: which function is which, on which object, gated
by what.

Nothing here is prose a model reads. Every word of that — what a function does, what to put in each
argument, what a type's member means — is written on the declaration it describes, in ``Sources/``,
and reflected out of the SDK's own symbol graph by ``signatures.py``. What is here is the part Swift
cannot say: that ``fs.readFile`` **is** gg's ``read_file`` tool, that ``review.requestChanges`` is
the same capability Rust spells ``review::request_changes``, and that ``view.openFile`` is bound
exactly when ``read_file`` is.

That split is what makes the agreement gate possible: it compares two languages' catalogues by
identity — section, object, key, gate, ending — and lets every spelling differ.

``signatures.py`` checks this file against the SDK it reflects **in both directions**: a name here
that no object declares, and a public method of an API object that nothing here names, each fail the
reflection rather than reaching a model.
"""

# The API objects a program's surface is divided into, **in the order it is presented in**.
#
# The order is model-facing: it is the sequence the system prompt's API list renders in and the
# sequence the run's agent surface reports. It runs from the objects almost every run has (``fs``,
# ``system``) to the ones a particular shape of agent has (``programs``, ``harness``, ``review``),
# because a model reads a list from the top.
#
# Each name is also the name of the Swift type — a caseless ``enum``, which is Swift's own namespace
# — so ``fs`` here is ``public enum fs`` there. That is a deliberate departure from Swift's
# UpperCamelCase convention for types, and the only one this SDK makes: an object's name is gg's
# IDENTITY, on the wire and in the console's grouping, and no language may rename it.
#
# The object's own one-line description is not here: it is the first paragraph of that type's own
# ``///`` documentation.
OBJECTS = [
    "fs",
    "system",
    "project",
    "tasks",
    "memory",
    "view",
    "context",
    "agents",
    "skills",
    "programs",
    "harness",
    "review",
]


def _tool(key, object_, name):
    """One gg tool, whose identity is its own name in gg's vocabulary."""
    return {
        "section": "tools",
        "key": key,
        "object": object_,
        "name": name,
        "gate": key,
        "ending": None,
    }


# Every gg tool a program can call, in `ALL_TOOL_NAMES` order — which is the order gg documents them
# in everywhere else.
#
# Swift spells a gg tool in `camelCase`, because that is what Swift spells a function in. gg's own
# vocabulary is `snake_case`, so on this arm the `key` and the `name` differ for all but the five
# whose names are one word — which is exactly what the `key` is for.
TOOLS = [
    _tool("shell", "system", "shell"),
    _tool("read_file", "fs", "readFile"),
    _tool("write_file", "fs", "writeFile"),
    _tool("edit_file", "fs", "editFile"),
    _tool("list_dir", "fs", "listDir"),
    _tool("read_skill", "skills", "readSkill"),
    _tool("write_memory", "memory", "writeMemory"),
    _tool("update_memory", "memory", "updateMemory"),
    _tool("create_memory", "memory", "createMemory"),
    _tool("read_memory", "memory", "readMemory"),
    _tool("edit_memory", "memory", "editMemory"),
    _tool("search_memories", "memory", "searchMemories"),
    _tool("delete_memory", "memory", "deleteMemory"),
    _tool("add_task", "tasks", "addTask"),
    _tool("update_task", "tasks", "updateTask"),
    _tool("set_blocked_by", "tasks", "setBlockedBy"),
    _tool("complete_task", "tasks", "completeTask"),
    _tool("remove_task", "tasks", "removeTask"),
    _tool("create_epic", "project", "createEpic"),
    _tool("create_issue", "project", "createIssue"),
    _tool("update_issue", "project", "updateIssue"),
    _tool("set_issue_blocked_by", "project", "setIssueBlockedBy"),
    _tool("remove_epic", "project", "removeEpic"),
    _tool("remove_issue", "project", "removeIssue"),
    _tool("wait_for_issue", "project", "waitForIssue"),
    _tool("evict_file_view", "context", "evictFileView"),
    _tool("archive_thread", "context", "archiveThread"),
    _tool("search_archive", "context", "searchArchive"),
    _tool("compact", "context", "compact"),
    _tool("spawn_subagent", "agents", "spawnSubagent"),
    _tool("wait_for_subagents", "agents", "waitForSubagents"),
    _tool("send_message", "agents", "sendMessage"),
    _tool("transition_state", "agents", "transitionState"),
    _tool("exec", "agents", "exec"),
    _tool("fork", "agents", "fork"),
]

# Every helper bound alongside a tool: not a tool itself, so it can never perturb the bijection
# between the guest's bound names and gg's tool vocabulary, but bound into a program's scope and
# catalogued whenever the tool it is built on is enabled.
HELPERS = [
    {
        "section": "helpers",
        "key": "read_text_file",
        "object": "fs",
        "name": "readTextFile",
        "gate": "read_file",
        "ending": None,
    }
]

# Every model-facing function that **ends a session**, one group per role. None of them is a gg tool;
# each carries a `key` instead, which is the identity another language's SDK spells its own way.
SESSION = [
    {
        "section": "session",
        "key": "finish",
        "object": "harness",
        "name": "finish",
        "gate": None,
        "ending": "standard",
    },
    {
        "section": "session",
        "key": "approve",
        "object": "review",
        "name": "approve",
        "gate": None,
        "ending": "review",
    },
    {
        "section": "session",
        "key": "request_changes",
        "object": "review",
        "name": "requestChanges",
        "gate": None,
        "ending": "review",
    },
]

# The `view` object: how material enters the agent's own context window. `openFile` is a read and is
# bound exactly when `read_file` is; the other four are bound whatever a run enables, because a run
# with no tools at all must still be able to show its model something.
VIEWS = [
    {
        "section": "views",
        "key": "open_file",
        "object": "view",
        "name": "openFile",
        "gate": "read_file",
        "ending": None,
    },
    {
        "section": "views",
        "key": "open_text",
        "object": "view",
        "name": "openText",
        "gate": None,
        "ending": None,
    },
    {
        "section": "views",
        "key": "open_docs_view",
        "object": "view",
        "name": "openDocsView",
        "gate": None,
        "ending": None,
    },
    {
        "section": "views",
        "key": "close",
        "object": "view",
        "name": "close",
        "gate": None,
        "ending": None,
    },
    {
        "section": "views",
        "key": "current",
        "object": "view",
        "name": "current",
        "gate": None,
        "ending": None,
    },
]

# The program library, whose whole object is bound or absent together — from a capability rather than
# from a tool or a role, which is why none of these carries a gate at all.
PROGRAMS = [
    {
        "section": "programs",
        "key": "history",
        "object": "programs",
        "name": "history",
        "gate": None,
        "ending": None,
    },
    {
        "section": "programs",
        "key": "get",
        "object": "programs",
        "name": "get",
        "gate": None,
        "ending": None,
    },
    {
        "section": "programs",
        "key": "rerun",
        "object": "programs",
        "name": "rerun",
        "gate": None,
        "ending": None,
    },
]

# The one function that belongs to no object because it belongs to all of them.
#
# On this arm it is declared exactly once and by construction: `ApiObject` is the protocol every API
# object conforms to, and `list()` is its extension's default implementation — so there are not
# twelve declarations to keep equal, there is one, and the reflector reads it from the protocol
# rather than from any object.
META = [
    {
        "section": "meta",
        "key": "list",
        "object": None,
        "name": "list",
        "gate": None,
        "ending": None,
    }
]

# The Swift type whose extension declares `list`, and the name it declares it under.
META_PROTOCOL = "ApiObject"

# Every entry, in the order the sections are emitted.
ENTRIES = SESSION + VIEWS + PROGRAMS + TOOLS + HELPERS
