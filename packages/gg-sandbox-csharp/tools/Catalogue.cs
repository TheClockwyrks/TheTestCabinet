// The IDENTITY half of this arm's catalogue: which function is which, on which object, gated by
// what.
//
// Nothing here is prose a model reads. Every word of that — what a function does, what to put in
// each argument, what a type's member means — is written on the declaration it describes, in
// `src/Gg/`, and reflected out of Roslyn's own reading of those XML documentation comments by
// `Signatures.cs`. What is here is the part C# cannot say: that `fs.ReadFile` IS gg's `read_file`
// tool, that `review.RequestChanges` is the same capability Ruby spells `review.request_changes`,
// and that `view.OpenFile` is bound exactly when `read_file` is.
//
// That split is what makes the agreement gate possible: it compares two languages' catalogues by
// identity — section, object, key, gate, ending — and lets every spelling differ.
//
// `Signatures.cs` checks this file against the SDK it reflects IN BOTH DIRECTIONS: a name here that
// no object declares, and a public function an API object declares that nothing here names, each
// fail the reflection rather than reaching a model.

using System.Collections.Generic;

namespace Tools;

/// One catalogue entry's identity.
internal sealed record Entry(
    string Section,
    string Key,
    string? Object,
    string Name,
    string? Gate,
    string? Ending);

internal static class Catalogue
{
    // The API objects a program's surface is divided into, IN THE ORDER IT IS PRESENTED IN.
    //
    // The order is model-facing: it is the sequence the system prompt's API list renders in and the
    // sequence the run's agent surface reports. It runs from the objects almost every run has to the
    // ones a particular shape of agent has, because a model reads a list from the top.
    //
    // Each name is also the name of a `static class` in `namespace Gg`, brought into every program's
    // scope by the `global using Gg;` in `src/Gg/GlobalUsings.cs` — so `fs` here is `Gg.fs` there and
    // a program writes `fs.ReadFile`. Lower-case type names are the one place this SDK departs from
    // C#'s naming conventions, and it is not a choice: an object's name is IDENTITY, shared with
    // every other arm, and it is what the console groups by and what a documentation lookup routes
    // on. Everything a language is free to spell — every method, type, member and argument — is
    // PascalCase, as C# expects.
    internal static readonly string[] Objects =
    [
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
    ];

    // Every gg tool a program can call, in `ALL_TOOL_NAMES` order — which is the order gg documents
    // them in everywhere else. The `Name` is this SDK's PascalCase spelling of the tool's own name.
    private static Entry Tool(string key, string obj, string name) =>
        new("tools", key, obj, name, key, null);

    internal static readonly Entry[] Tools =
    [
        Tool("shell", "system", "Shell"),
        Tool("read_file", "fs", "ReadFile"),
        Tool("write_file", "fs", "WriteFile"),
        Tool("edit_file", "fs", "EditFile"),
        Tool("list_dir", "fs", "ListDir"),
        Tool("read_skill", "skills", "ReadSkill"),
        Tool("write_memory", "memory", "WriteMemory"),
        Tool("update_memory", "memory", "UpdateMemory"),
        Tool("create_memory", "memory", "CreateMemory"),
        Tool("read_memory", "memory", "ReadMemory"),
        Tool("edit_memory", "memory", "EditMemory"),
        Tool("search_memories", "memory", "SearchMemories"),
        Tool("delete_memory", "memory", "DeleteMemory"),
        Tool("add_task", "tasks", "AddTask"),
        Tool("update_task", "tasks", "UpdateTask"),
        Tool("set_blocked_by", "tasks", "SetBlockedBy"),
        Tool("complete_task", "tasks", "CompleteTask"),
        Tool("remove_task", "tasks", "RemoveTask"),
        Tool("create_epic", "project", "CreateEpic"),
        Tool("create_issue", "project", "CreateIssue"),
        Tool("update_issue", "project", "UpdateIssue"),
        Tool("set_issue_blocked_by", "project", "SetIssueBlockedBy"),
        Tool("remove_epic", "project", "RemoveEpic"),
        Tool("remove_issue", "project", "RemoveIssue"),
        Tool("wait_for_issue", "project", "WaitForIssue"),
        Tool("evict_file_view", "context", "EvictFileView"),
        Tool("archive_thread", "context", "ArchiveThread"),
        Tool("search_archive", "context", "SearchArchive"),
        Tool("compact", "context", "Compact"),
        Tool("spawn_subagent", "agents", "SpawnSubagent"),
        Tool("wait_for_subagents", "agents", "WaitForSubagents"),
        Tool("send_message", "agents", "SendMessage"),
        Tool("transition_state", "agents", "TransitionState"),
        Tool("exec", "agents", "Exec"),
        Tool("fork", "agents", "Fork"),
    ];

    // Every helper bound alongside a tool: not a tool itself, so it can never perturb the bijection
    // between the guest's bound names and gg's tool vocabulary, but bound into a program's scope and
    // catalogued whenever the tool it is built on is enabled.
    internal static readonly Entry[] Helpers =
    [
        new("helpers", "read_text_file", "fs", "ReadTextFile", "read_file", null),
    ];

    // Every model-facing function that ENDS a session, one group per role. None of them is a gg
    // tool; each carries a `Key` instead, which is the identity another language's SDK spells its
    // own way.
    internal static readonly Entry[] Session =
    [
        new("session", "finish", "harness", "Finish", null, "standard"),
        new("session", "approve", "review", "Approve", null, "review"),
        new("session", "request_changes", "review", "RequestChanges", null, "review"),
    ];

    // The `view` object: how material enters the agent's own context window. `open_file` is a read
    // and is bound exactly when `read_file` is; the other four are bound whatever a run enables,
    // because a run with no tools at all must still be able to show its model something.
    internal static readonly Entry[] Views =
    [
        new("views", "open_file", "view", "OpenFile", "read_file", null),
        new("views", "open_text", "view", "OpenText", null, null),
        new("views", "open_docs_view", "view", "OpenDocsView", null, null),
        new("views", "close", "view", "Close", null, null),
        new("views", "current", "view", "Current", null, null),
    ];

    // The program library, whose whole object is bound or absent together — from a capability rather
    // than from a tool or a role, which is why none of these carries a gate at all.
    internal static readonly Entry[] Programs =
    [
        new("programs", "history", "programs", "History", null, null),
        new("programs", "get", "programs", "Get", null, null),
        new("programs", "rerun", "programs", "Rerun", null, null),
    ];

    // The one function that belongs to no object because it belongs to all of them.
    internal static readonly Entry[] Meta =
    [
        new("meta", "list", null, "List", null, null),
    ];

    // Where the words a model reads about `List` are written, and where its shape is read from.
    //
    // C# has no way to give twelve methods one doc comment except `<inheritdoc cref="…"/>`, so the
    // twelve `List()` declarations carry one of those pointing here. `Signatures.cs` resolves it and
    // asserts all twelve land on this declaration — so the paragraph is written once and the twelve
    // objects cannot drift from it — while the SIGNATURE is taken from the object's own `List()`,
    // because that is the call a program writes.
    internal const string MetaDocumentation = "Gg.Internal.ObjectDirectory.List";

    /// Every entry, in the order the sections are emitted.
    internal static IEnumerable<Entry> All()
    {
        foreach (var entry in Session)
        {
            yield return entry;
        }
        foreach (var entry in Views)
        {
            yield return entry;
        }
        foreach (var entry in Programs)
        {
            yield return entry;
        }
        foreach (var entry in Tools)
        {
            yield return entry;
        }
        foreach (var entry in Helpers)
        {
            yield return entry;
        }
    }
}
