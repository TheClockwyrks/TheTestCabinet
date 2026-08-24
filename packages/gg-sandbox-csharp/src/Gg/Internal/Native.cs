// The bridge. NOT the surface: nothing in this file is model-facing, nothing in it is catalogued,
// and every doc comment here is `//` rather than `///` for exactly that reason — the reflector reads
// `///` and only `///`.
//
// WHAT THESE ARE. One `extern` per gg function, each resolved by Mono's `mono_add_internal_call`
// against the identical `Gg.Internal.Native::<Name>` string in
// `packages/gg-sandbox-csharp/Sources/shell.c`, which is where the `wit-bindgen` lowering lives.
// Mono resolves an internal call by that string alone, so these declarations travel in the
// program's own assembly and no assembly has to be shipped or bundled for them to bind.
//
// THE CALLING CONVENTION, WHICH IS THE WHOLE OF WHY THIS FILE IS DULL. The canonical ABI has
// records, variants, options and lists; a Mono internal call has scalars, strings and arrays. Rather
// than construct managed objects from C — which would put the SDK's own field layout in a C file and
// break it silently the day a property is renamed — the C half writes PRIMITIVES into `out`
// parameters and the managed half above assembles the public record. Four conventions carry all of
// it, and every one of them is invisible to a model:
//
//   * an absent `option<u32>`/`option<u64>` arrives as `-1` in a signed integer, which no `u32` can
//     be — an `int` for the line offsets and turn numbers a `u32` bounds, a `long` where the value
//     itself may not fit one;
//   * an absent `option<s32>` — where `-1` is a real value — gets its own `bool has…`;
//   * an absent `option<f64>` is `double.NaN`, and an absent `option<string>` is `null`;
//   * a `list<record>` arrives as one array per field, of equal length.
//
// FAILURE. Every fallible call returns `false` and parks its `api-error` in the guest's own
// single-slot error register, which `TakeError` reads back. It is a register rather than three more
// `out` parameters on all forty of them because a failure is the same three fields everywhere, and
// it is safe because a program is single-threaded and every call is synchronous — there is no second
// call that could overwrite it between the `false` and the `TakeError`.

using System.Runtime.CompilerServices;

namespace Gg.Internal;

// Every gg function, as the guest's C shell exports it.
internal static class Native
{
    // The failure the last call parked. Only ever read immediately after a `false`.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern void TakeError(out int code, out string operation, out string message);

    // One line to the run's operator log — the channel `Console.Out` is redirected onto.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern void Log(string line);

    // --- system -------------------------------------------------------------------------------

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool Shell(
        string command,
        double timeoutSeconds,
        out bool hasExitCode,
        out int exitCode,
        out string output,
        out bool truncated);

    // --- fs -----------------------------------------------------------------------------------

    // `kind` is 0 for text and 1 for a picture; the other half's fields are left untouched.
    //
    // `numbers` is `[firstLine, lastLine, totalLines, byteTruncated, bytes, shown]`, which is the
    // fifth convention and the one an interpreter forced: a Mono internal call cannot take more than
    // about a dozen arguments before the interpreter refuses to build a frame for it, and this call
    // has fourteen fields to hand back. So a record's NUMBERS come back as one array in declaration
    // order wherever the count would otherwise be too high, and the strings stay named — which keeps
    // the half a misplacement would silently corrupt readable at both ends.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool ReadFile(
        string path,
        int offset,
        int limit,
        out int kind,
        out string contents,
        out string mediaType,
        out string label,
        out string notShownReason,
        out long[] numbers);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool ReadTextFile(string path, int offset, int limit, out string contents);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool WriteFile(string path, string contents, out ulong written);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool EditFile(string path, string oldString, string newString);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool ListDir(string? path, out string[] names, out int[] kinds);

    // A `list<search-match>` as one array per field, of equal length.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool Search(
        string query,
        string? path,
        int limit,
        out string[] paths,
        out uint[] lines,
        out string[] texts);

    // --- skills -------------------------------------------------------------------------------

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool ReadSkill(string name, out string body);

    // --- memory -------------------------------------------------------------------------------

    // `strategy` selects which of the three recording calls this is: 0 `write-memory`,
    // 1 `update-memory`, 2 `create-memory`. They take one record and differ in nothing else, so
    // giving each its own C function would be three copies of one lowering.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool RecordMemory(
        int strategy,
        string name,
        string description,
        string body,
        string? code,
        string? onUse,
        out uint count,
        out long maxCount,
        out uint totalChars,
        out long maxTotalChars,
        out long indexChars,
        out long maxIndexChars);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool ReadMemory(string name, out string body);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool EditMemory(
        string name,
        string search,
        string replace,
        out uint count,
        out long maxCount,
        out uint totalChars,
        out long maxTotalChars,
        out long indexChars,
        out long maxIndexChars);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool SearchMemories(
        string[] keywords,
        out string[] names,
        out string[] descriptions,
        out uint[] matched,
        out uint[] occurrences,
        out string[] excerpts);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool DeleteMemory(
        string name,
        out uint count,
        out long maxCount,
        out uint totalChars,
        out long maxTotalChars,
        out long indexChars,
        out long maxIndexChars);

    // --- tasks --------------------------------------------------------------------------------

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool AddTask(
        string id,
        string title,
        string? description,
        string[] blockedBy,
        out uint count,
        out uint maxTasks);

    // `descriptionEdit` is the three-way: 0 keep, 1 clear, 2 set `descriptionText`.
    // `status` is -1 for "leave it".
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool UpdateTask(
        string id,
        string? title,
        int descriptionEdit,
        string? descriptionText,
        int status);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool SetBlockedBy(string id, string[] blockedBy);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool CompleteTask(string id);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool RemoveTask(string id, out uint count, out uint maxTasks);

    // --- project ------------------------------------------------------------------------------

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool CreateEpic(
        string prefix,
        string title,
        string description,
        out string id,
        out uint epics,
        out uint maxEpics,
        out uint issues,
        out uint maxIssues);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool CreateIssue(
        string title,
        string? description,
        string inScope,
        string outOfScope,
        string completionCriteria,
        string[] blockedBy,
        string? epicId,
        string agent,
        string[] reviewers,
        out string id,
        out uint[] board);

    // `epicEdit` is the three-way: 0 keep, 1 ungroup, 2 group under `epicId`.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool UpdateIssue(
        string id,
        string? title,
        int descriptionEdit,
        string? descriptionText,
        string? inScope,
        string? outOfScope,
        string? completionCriteria,
        int status,
        int epicEdit,
        string? epicId);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool SetIssueBlockedBy(string id, string[] blockedBy);

    // `epic` selects which removal this is: 1 removes an epic, 0 an issue. One C function for two
    // calls that lower one string and read back one `board-usage`.
    //
    // It is an `int` rather than a `bool` because the interpreter does not resolve an internal call
    // whose FIRST parameter is a by-value `bool` — the method simply is not found, and what a program
    // gets is a `MissingMethodException` naming nothing at all.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool RemoveFromBoard(int epic, string id, out uint[] board);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool WaitForIssue(string id, out string acknowledgement);

    // --- context ------------------------------------------------------------------------------

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool EvictFileView(
        string? path,
        out uint items,
        out uint reclaimedTokens,
        out string[] paths,
        out string detail);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool ArchiveThread(
        uint[] starts,
        uint[] ends,
        out uint items,
        out uint reclaimedTokens,
        out string[] paths,
        out string detail);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool SearchArchive(
        string query,
        out bool archiveEmpty,
        out uint[] sequences,
        out int[] roles,
        out string[] texts);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool Compact(string summary, string[] files);

    // --- agents -------------------------------------------------------------------------------

    // `briefKind` is 0 for a written prompt and 1 for a board issue id.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool SpawnSubagent(
        string agent,
        int briefKind,
        string brief,
        out string id,
        out string slot,
        out string modelId);

    // `ids` is `null` for "every outstanding child", which is the wire's `none`.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool WaitForSubagents(
        string[]? ids,
        out string[] resultIds,
        out int[] statuses,
        out string[] summaries);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool SendMessage(string agentId, string message);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool TransitionState(string state, string? note);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool Exec(string agent, string? prompt);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool Fork(string prompt, out string id, out string slot, out string modelId);

    // --- harness and review -------------------------------------------------------------------

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool Finish(string summary);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool Approve();

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool RequestChanges(string[] items);

    // --- view ---------------------------------------------------------------------------------

    // `numbers` is what `ReadFile`'s is: this call performs the same read and hands back the same
    // record. `maxLineChars` is the view's own `option<u32>`, absent as `-1` like the window's two.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool OpenFileView(
        string path,
        int offset,
        int limit,
        int maxLineChars,
        out int kind,
        out string contents,
        out string mediaType,
        out string label,
        out string notShownReason,
        out long[] numbers);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool OpenTextView(string label, string body);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool OpenDocsView(string name);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool CloseView(string selector, out uint closed);

    // A paged file view's region arrives as `-1`/`-1` when the view covers a whole file.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool CurrentViews(
        out int[] kinds,
        out string[] selectors,
        out ulong[] tokens,
        out long[] offsets,
        out long[] limits);

    // --- docs ---------------------------------------------------------------------------------

    // The page's two numbers arrive as ONE array, `[total, offset]`, for the reason `Wire.Board`'s
    // do: the interpreter refuses to build a frame for an internal call much wider than this, one
    // array per hit field already spends five arguments, and the query and its four filters spend
    // six more. `kind` is the wire's own word rather than the SDK's enum — `Wire.Word` and
    // `Wire.Kind` are the two ends of that translation, and they are in managed code so that
    // renaming a member of `Docs.DocKind` is a compile error rather than a mapping in a C file
    // nothing checks.
    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool SearchDocs(
        string? query,
        string[] modules,
        string? type,
        string? kind,
        int offset,
        int limit,
        out uint[] page,
        out string[] keys,
        out string[] kinds,
        out string[] hitModules,
        out string[] names,
        out string[] summaries);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool CloseDocView(string key, out uint closed);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool CloseDocViews(out uint closed);

    // --- programs -----------------------------------------------------------------------------

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool History(
        out uint[] turns,
        out uint[] lines,
        out uint[] chars,
        out bool[] ok,
        out string[] errors);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool GetProgram(int turn, out string source);

    [MethodImpl(MethodImplOptions.InternalCall)]
    internal static extern bool Rerun(string source);
}
