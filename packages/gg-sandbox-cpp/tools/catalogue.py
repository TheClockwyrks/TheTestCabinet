"""The **identity** half of this arm's catalogue: which function is which, on which object, gated
by what.

Nothing here is prose a model reads. Every word of that — what a function does, what to put in each
argument, what a type's member means — is written on the declaration it describes, in
``Sources/sdk/``, and reflected out of clang's own comment AST by ``signatures.py``. What is here is
the part C++ cannot say: that ``fs::read_file`` **is** gg's ``read_file`` tool, that
``review::request_changes`` is the same capability Swift spells ``review.requestChanges``, and that
``view::open_file`` is bound exactly when ``read_file`` is.

That split is what makes the agreement gate possible: it compares two languages' catalogues by
identity — section, object, key, gate, ending — and lets every spelling differ.

This arm is the one where the two halves nearly coincide, and that is worth naming rather than
leaving as a coincidence. gg's own vocabulary is ``snake_case`` and so is this SDK's, so a tool's
``key`` and its ``name`` are the same string for all thirty-five of them — where Swift's differ for
all but five. The table below still writes both, because the day they diverge is the day one arm
renames a function and the ``key`` is what stops that from renaming the capability.

``signatures.py`` checks this file against the SDK it reflects **in both directions**: a name here
that no object declares, and a function an API object declares that nothing here names, each fail
the reflection rather than reaching a model.
"""

# The API objects a program's surface is divided into, **in the order it is presented in**.
#
# The order is model-facing: it is the sequence the system prompt's API list renders in and the
# sequence the run's agent surface reports. It runs from the objects almost every run has (``fs``,
# ``system``) to the ones a particular shape of agent has (``programs``, ``harness``, ``review``),
# because a model reads a list from the top.
#
# Each name is also the name of a C++ ``namespace`` inside ``namespace gg`` — so ``fs`` here is
# ``namespace gg::fs`` there, and a program reaches it as ``fs::read_file`` because the prelude ends
# with ``using namespace gg;``. That namespace is not decoration: one of these objects is called
# ``system``, and ``<cstdlib>`` declares ``int system(const char *)`` at global scope, so the whole
# surface has to live under a namespace for that one name to be declarable at all.
#
# The object's own one-line description is not here: it is the first paragraph of that namespace's
# own ``///`` documentation.
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


def _tool(key, object_):
    """One gg tool, whose identity is its own name in gg's vocabulary.

    The ``name`` is the ``key`` on this arm, because this SDK spells a function the way the standard
    library spells one and gg's vocabulary is already ``snake_case``. It is written out rather than
    defaulted so the table reads the same as every other arm's.
    """
    return {
        "section": "tools",
        "key": key,
        "object": object_,
        "name": key,
        "gate": key,
        "ending": None,
    }


# Every gg tool a program can call, in `ALL_TOOL_NAMES` order — which is the order gg documents them
# in everywhere else.
TOOLS = [
    _tool("shell", "system"),
    _tool("read_file", "fs"),
    _tool("write_file", "fs"),
    _tool("edit_file", "fs"),
    _tool("list_dir", "fs"),
    _tool("read_skill", "skills"),
    _tool("write_memory", "memory"),
    _tool("update_memory", "memory"),
    _tool("create_memory", "memory"),
    _tool("read_memory", "memory"),
    _tool("edit_memory", "memory"),
    _tool("search_memories", "memory"),
    _tool("delete_memory", "memory"),
    _tool("add_task", "tasks"),
    _tool("update_task", "tasks"),
    _tool("set_blocked_by", "tasks"),
    _tool("complete_task", "tasks"),
    _tool("remove_task", "tasks"),
    _tool("create_epic", "project"),
    _tool("create_issue", "project"),
    _tool("update_issue", "project"),
    _tool("set_issue_blocked_by", "project"),
    _tool("remove_epic", "project"),
    _tool("remove_issue", "project"),
    _tool("wait_for_issue", "project"),
    _tool("evict_file_view", "context"),
    _tool("archive_thread", "context"),
    _tool("search_archive", "context"),
    _tool("compact", "context"),
    _tool("spawn_subagent", "agents"),
    _tool("wait_for_subagents", "agents"),
    _tool("send_message", "agents"),
    _tool("transition_state", "agents"),
    _tool("exec", "agents"),
    _tool("fork", "agents"),
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

# The one function that belongs to no object because it belongs to all of them.
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

# Where the words a model reads about `list` are written, and where its shape is read from.
#
# C++ has no protocol extension and no macro that can carry a doc comment — a comment inside a macro
# body is removed before the macro is ever expanded — so the twelve `list()` declarations cannot
# share one written paragraph the way Swift's protocol default or Rust's `macro_rules!` do. What they
# share instead is the declaration named below: each object's `list()` carries a one-line
# `\\copydoc` of it, which the reflector resolves. So the paragraph is written once and the twelve
# objects cannot drift from it — and the SIGNATURE is taken from the object's own `list()`, because
# that is the call a program writes, with the reflector asserting all twelve are identical.
META_DOC_HOME = ("detail", "api_object_list")

# Every entry, in the order the sections are emitted.
ENTRIES = SESSION + VIEWS + PROGRAMS + TOOLS + HELPERS
