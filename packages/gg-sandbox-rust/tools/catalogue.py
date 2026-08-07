"""The **identity** half of this arm's catalogue: which function is which, on which object, gated
by what.

Nothing here is prose a model reads. Every word of that — what a function does, what to put in each
argument, what a type's member means — is written on the declaration it describes, in ``src/``, and
reflected out of ``rustdoc``'s own JSON by ``signatures.py``. What is here is the part Rust cannot
say: that ``fs::read_file`` **is** gg's ``read_file`` tool, that ``review::request_changes`` is the
same capability Java spells ``review.requestChanges``, and that ``view::open_file`` is bound exactly
when ``read_file`` is.

That split is what makes the agreement gate possible: it compares two languages' catalogues by
identity — section, object, key, gate, ending — and lets every spelling differ.

``signatures.py`` checks this file against the SDK it reflects **in both directions**: a name here
that no module declares, and a public function of an API object that nothing here names, each fail
the reflection rather than reaching a model.
"""

# The API objects a program's surface is divided into, **in the order it is presented in**, each
# with the module whose functions it is built from.
#
# The order is model-facing: it is the sequence the system prompt's API list renders in and the
# sequence the run's agent surface reports. It runs from the objects almost every run has (``fs``,
# ``system``) to the ones a particular shape of agent has (``programs``, ``harness``, ``review``),
# because a model reads a list from the top. `signatures.py` checks it against the order the modules
# are declared in `src/lib.rs`, so the two cannot drift.
#
# The object's own one-line description is not here: it is the first line of the module's own `//!`
# documentation.
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
# Rust spells a gg tool with gg's own name for it, because gg's vocabulary is already `snake_case`.
# That makes this arm the only one whose `key` and `name` are equal for every tool, and it is a
# coincidence of spelling rather than an identity: `signatures.py` still reads the pair.
TOOLS = [
    _tool("shell", "system", "shell"),
    _tool("read_file", "fs", "read_file"),
    _tool("write_file", "fs", "write_file"),
    _tool("edit_file", "fs", "edit_file"),
    _tool("list_dir", "fs", "list_dir"),
    _tool("read_skill", "skills", "read_skill"),
    _tool("write_memory", "memory", "write_memory"),
    _tool("update_memory", "memory", "update_memory"),
    _tool("create_memory", "memory", "create_memory"),
    _tool("read_memory", "memory", "read_memory"),
    _tool("edit_memory", "memory", "edit_memory"),
    _tool("search_memories", "memory", "search_memories"),
    _tool("delete_memory", "memory", "delete_memory"),
    _tool("add_task", "tasks", "add_task"),
    _tool("update_task", "tasks", "update_task"),
    _tool("set_blocked_by", "tasks", "set_blocked_by"),
    _tool("complete_task", "tasks", "complete_task"),
    _tool("remove_task", "tasks", "remove_task"),
    _tool("create_epic", "project", "create_epic"),
    _tool("create_issue", "project", "create_issue"),
    _tool("update_issue", "project", "update_issue"),
    _tool("set_issue_blocked_by", "project", "set_issue_blocked_by"),
    _tool("remove_epic", "project", "remove_epic"),
    _tool("remove_issue", "project", "remove_issue"),
    _tool("wait_for_issue", "project", "wait_for_issue"),
    _tool("evict_file_view", "context", "evict_file_view"),
    _tool("archive_thread", "context", "archive_thread"),
    _tool("search_archive", "context", "search_archive"),
    _tool("compact", "context", "compact"),
    _tool("spawn_subagent", "agents", "spawn_subagent"),
    _tool("wait_for_subagents", "agents", "wait_for_subagents"),
    _tool("send_message", "agents", "send_message"),
    _tool("transition_state", "agents", "transition_state"),
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
        "name": "read_text_file",
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
        "name": "request_changes",
        "gate": None,
        "ending": "review",
    },
]

# The `view` object: how material enters the agent's own context window. `open_file` is a read and is
# bound exactly when `read_file` is; the other four are bound whatever a run enables, because a run
# with no tools at all must still be able to show its model something.
VIEWS = [
    {
        "section": "views",
        "key": "open_file",
        "object": "view",
        "name": "open_file",
        "gate": "read_file",
        "ending": None,
    },
    {
        "section": "views",
        "key": "open_text",
        "object": "view",
        "name": "open_text",
        "gate": None,
        "ending": None,
    },
    {
        "section": "views",
        "key": "open_docs_view",
        "object": "view",
        "name": "open_docs_view",
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

# The one function that belongs to no object because it belongs to all of them. It is declared once,
# by `meta::directory_of!`, and expanded into every object module — so the reflector reads it from
# one of them and asserts the rest are the same declaration.
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

# Every entry, in the order the sections are emitted.
ENTRIES = SESSION + VIEWS + PROGRAMS + TOOLS + HELPERS
