"""What this guest needs in order to build a program's surface — and nothing a model ever reads.

It is deliberately much smaller than it was, and it lost its whole reason for existing in the
process. Every fact about what a function is *called*, what it *does*, which module it lives in and
which gg operation it binds is written on the declaration itself — the module it is declared in, its
`__all__`, its docstring, its `@operation`. And the one thing a declaration could not state — **what
buys a call at run time** — is no longer this guest's business at all.

gg owns that, and gg enforces it. Its operations table says whether an operation is bought by a gg
tool, by a capability, by a role's ending, or by nothing, and the **membrane** checks it when the
call arrives. This guest binds every function it has into every program's surface,
unconditionally: the SDK is static, a withheld call is a call that reaches the host and is refused
there with a sentence naming what is missing, and there is no reading of a run's enabled set anywhere
in this package any more.

What is left here is the module vocabulary a surface is assembled from, and the one table that is a
claim about *this package* rather than about a run: which gg tool each operation this SDK implements
would dispatch, read by `gg.scope.bound_tools` and by nothing else.
"""

from __future__ import annotations

MODULE_ORDER: tuple[str, ...] = (
    "docs",
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

`docs` is first because it is the one module no run can withhold and the one a session begins in:
the prompt names modules and no function, so finding a name is the first thing a program does and
every other module is reached through it.

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
"""Every operation a gg **tool** would dispatch, and which tool it is.

It no longer decides anything a program can see: the surface is static, so this table is read by
`gg.scope.bound_tools` alone — the export gg compares against its own tool vocabulary on the
committed artifact. What buys a call at *run time* is gg's own operations table, checked at the
membrane; what is here is only "which gg tool does this SDK implement a function for", which is a
claim about this package rather than about a run.

Three of these are not one-to-one, and each says something real. `files.read_text_file` is a helper
rather than a tool of its own, so it is bought by the read it is built on; `views.open_file` performs
that same read on the way to showing the file, so a run with reading withheld must not get one
through a side door. Everything else names the tool that shares its key.
"""
