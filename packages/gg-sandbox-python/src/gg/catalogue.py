"""What this guest needs in order to build a program's surface — and nothing a model ever reads.

It is deliberately much smaller than it was. Every fact about what a function is *called*, what it
*does*, which module it lives in and which gg operation it binds is now written on the declaration
itself — the module it is declared in, its `__all__`, its docstring, its `@operation` — so none of
that is here. What is left is the one thing a declaration cannot state, because it is not a fact
about this SDK at all: **what buys a call at run time**.

gg owns that. Its operations table says whether an operation is bought by a gg tool, by a capability,
by a role's ending, or by nothing. The guest is told only the three run facts the host passes to
`run` — the enabled tool names, the ending role, and whether this agent keeps a program library — so
it needs its own reading of the same question to decide which functions a program is given. That
reading is below.

It is **not** the enforcement, and it is not asserted in the signature catalogue either. The host
refuses a withheld call whichever name a program used to reach it, and the committed catalogue
carries no gate at all, because a gate an arm asserted would be an arm asserting something only gg
can be held to. What is here decides the *surface* a model is shown, which is a different and much
weaker claim.
"""

from __future__ import annotations

MODULE_ORDER: tuple[str, ...] = (
    "files",
    "shell",
    "board",
    "tasks",
    "memories",
    "views",
    "context",
    "delegation",
    "skills",
    "programs",
    "session",
    "core",
)
"""Every capability module, in the order a program's surface is presented in.

The ids are gg's own module vocabulary — the same namespaces its operation ids are built on — so this
tuple is the join between `gg.files` the Python module and `files.read_file` the gg operation. The
order is model-facing: it is the sequence the system prompt lists modules in and the sequence the
run's agent surface reports, running from the modules almost every run has to the ones a particular
shape of agent has.

`core` is last and carries no function at all: it holds the types every other module's signatures
name, so it is a module for the sake of the names its types are qualified by.
"""

PACKAGE = "gg"
"""The Python package the modules live in, and therefore the stem of every fully-qualified name.

`gg.files.read_file` is both the key a documentation view is opened by and a path a program can
write, which is the whole reason the modules are real Python modules rather than objects assembled at
run time.
"""

GG_TOOLS: tuple[str, ...] = (
    "shell",
    "read_file",
    "write_file",
    "edit_file",
    "list_dir",
    "read_skill",
    "write_memory",
    "update_memory",
    "create_memory",
    "read_memory",
    "edit_memory",
    "search_memories",
    "delete_memory",
    "add_task",
    "update_task",
    "set_blocked_by",
    "complete_task",
    "remove_task",
    "create_epic",
    "create_issue",
    "update_issue",
    "set_issue_blocked_by",
    "remove_epic",
    "remove_issue",
    "wait_for_issue",
    "evict_file_view",
    "archive_thread",
    "search_archive",
    "compact",
    "spawn_subagent",
    "wait_for_subagents",
    "send_message",
    "transition_state",
    "exec",
    "fork",
)
"""Every gg tool, in `ALL_TOOL_NAMES` order.

This is gg's tool vocabulary rather than this SDK's, and the guest carries it for exactly one reason:
`gg.scope.bound_tools` answers the component's `bound-tools` export with it, and gg compares that
answer against its own `ALL_TOOL_NAMES` on the **committed artifact**. It is the one drift check that
catches a stale `.wasm` rather than a stale source file, so a tool added, renamed or removed in gg
fails against the binary that would otherwise silently not implement it.
"""

TOOL_BOUND: dict[str, str] = {
    "shell.shell": "shell",
    "files.read_file": "read_file",
    "files.read_text_file": "read_file",
    "files.write_file": "write_file",
    "files.edit_file": "edit_file",
    "files.list_dir": "list_dir",
    "skills.read_skill": "read_skill",
    "memories.write_memory": "write_memory",
    "memories.update_memory": "update_memory",
    "memories.create_memory": "create_memory",
    "memories.read_memory": "read_memory",
    "memories.edit_memory": "edit_memory",
    "memories.search_memories": "search_memories",
    "memories.delete_memory": "delete_memory",
    "tasks.add_task": "add_task",
    "tasks.update_task": "update_task",
    "tasks.set_blocked_by": "set_blocked_by",
    "tasks.complete_task": "complete_task",
    "tasks.remove_task": "remove_task",
    "board.create_epic": "create_epic",
    "board.create_issue": "create_issue",
    "board.update_issue": "update_issue",
    "board.set_issue_blocked_by": "set_issue_blocked_by",
    "board.remove_epic": "remove_epic",
    "board.remove_issue": "remove_issue",
    "board.wait_for_issue": "wait_for_issue",
    "context.evict_file_view": "evict_file_view",
    "context.archive_thread": "archive_thread",
    "context.search_archive": "search_archive",
    "context.compact": "compact",
    "delegation.spawn_subagent": "spawn_subagent",
    "delegation.wait_for_subagents": "wait_for_subagents",
    "delegation.send_message": "send_message",
    "delegation.transition_state": "transition_state",
    "delegation.exec": "exec",
    "delegation.fork": "fork",
    "views.open_file": "read_file",
}
"""Every operation a gg **tool** buys, and which tool buys it.

Three of these are not one-to-one, and each says something real. `files.read_text_file` is a helper
rather than a tool of its own, so it is bought by the read it is built on; `views.open_file` performs
that same read on the way to showing the file, so a run with reading withheld must not get one
through a side door. Everything else names the tool that shares its key.
"""

ALWAYS_BOUND: frozenset[str] = frozenset(
    {
        "views.open_text",
        "views.open_docs_view",
        "views.close",
        "views.current",
    }
)
"""The operations nothing gates, bound into every program whatever a run enables.

The same carve-out the endings have, and for the same reason: a run that offers no tools at all must
still be able to show its model something, and must always be able to read what the functions it does
have do.
"""

LIBRARY_BOUND: frozenset[str] = frozenset(
    {
        "programs.history",
        "programs.get",
        "programs.rerun",
    }
)
"""The operations the program-library **capability** buys, all together or not at all.

No tool name stands for this family, which is why the host passes a flag rather than a name in the
enabled set.
"""

ENDING_BOUND: dict[str, str] = {
    "session.finish": "standard",
    "session.approve": "review",
    "session.request_changes": "review",
}
"""The operations a **role's ending** buys, by the role whose programs get them.

Exactly one role's group is bound per program, because an ending is a result and a role's result has
a shape: work reports what was done, a review returns a verdict.
"""
