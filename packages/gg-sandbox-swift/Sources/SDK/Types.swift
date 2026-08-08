// The model-facing shapes this SDK hands back and takes.
//
// Three conventions run through the file, and each is a decision rather than a habit.
//
//   * A value with parts is a `struct` with `let` properties; a value that is one of a fixed set of
//     things is an `enum`. A fixed choice is NEVER a string — a model that guesses the spelling of a
//     string constant guesses wrong about as often as it guesses right, and a wrong string is a
//     branch that silently never runs, where `.done` is a name the compiler either knows or does not.
//   * A case that CARRIES something carries it as an associated value, so `switch` is how you get at
//     it and there is no half-filled record to check a flag on first.
//   * A count is an `Int`. The wire's `u32`/`u64` are the ABI's business; a Swift author writes
//     `Int` for a number of lines and would have to convert at every comparison otherwise.

/// What a command `system.shell` ran reported when it finished.
public struct ShellOutput: Sendable {
    /// The process's exit status; `nil` when a signal killed it. Zero means success.
    public let exitCode: Int?
    /// Merged stdout-then-stderr, tail-truncated at 16 KiB — or, when the run offloads shell output,
    /// at the configured line/character ceiling, with a note naming the files holding the whole of
    /// it. Under the default `adaptive` mode a command that succeeded returns just that note.
    public let output: String
    /// Whether the cap cut `output`, dropping the head and keeping the tail.
    public let truncated: Bool

    init(wire: test_cabinet_gg_shell_shell_output_t) {
        exitCode = wire.exit_code.is_some ? Int(wire.exit_code.val) : nil
        output = lift(wire.output)
        truncated = wire.truncated
    }
}

/// What `fs.readFile` returned: a text file's window, or a picture's description.
///
/// A picture is a different kind of thing from text, so it is a different case rather than a string
/// that happens to be binary — a program that treats an image as text is caught by the `switch`
/// instead of silently writing an empty string somewhere. Image *bytes* never enter the program: gg
/// attaches the picture to the turn so you can look at it directly, which is worth far more than
/// base64 in a variable.
public enum FileRead: Sendable {
    /// This file is text.
    case text(TextFile)
    /// This file is a picture; gg shows it to you rather than handing you its bytes.
    case image(ImageFile)

    init(wire: test_cabinet_gg_files_file_read_t) {
        if Int32(wire.tag) == TEST_CABINET_GG_FILES_FILE_READ_IMAGE {
            self = .image(ImageFile(wire: wire.val.image))
        } else {
            self = .text(TextFile(wire: wire.val.text))
        }
    }
}

/// A text file's window, as the `text` case of a read carries it.
public struct TextFile: Sendable {
    /// The file's text, or just the requested window under a capped read policy.
    public let contents: String
    /// The 1-based first line returned.
    public let firstLine: Int
    /// The 1-based last line returned.
    public let lastLine: Int
    /// The file's total line count, so you know whether to page again.
    public let totalLines: Int
    /// Whether a 256 KiB byte ceiling cut the returned text.
    public let byteTruncated: Bool

    init(wire: test_cabinet_gg_files_text_read_t) {
        contents = lift(wire.contents)
        firstLine = Int(wire.first_line)
        lastLine = Int(wire.last_line)
        totalLines = Int(wire.total_lines)
        byteTruncated = wire.byte_truncated
    }
}

/// A picture's description, as the `image` case of a read carries it.
public struct ImageFile: Sendable {
    /// The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
    public let mediaType: String
    /// The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
    public let label: String
    /// The file's size in bytes.
    public let bytes: Int
    /// Whether the picture is being attached to this turn for you to look at.
    public let shown: Bool
    /// Why it is not being shown; `nil` when `shown` is true.
    public let notShownReason: String?

    init(wire: test_cabinet_gg_files_image_read_t) {
        mediaType = lift(wire.media_type)
        label = lift(wire.label)
        bytes = Int(wire.bytes)
        shown = wire.shown
        notShownReason = lift(wire.not_shown_reason)
    }
}

/// One entry `fs.listDir` found.
public struct DirEntry: Sendable {
    /// The entry's bare name, with no directory part. Join it with the directory you listed.
    public let name: String
    /// What the entry is.
    public let kind: EntryKind

    init(wire: test_cabinet_gg_files_dir_entry_t) {
        name = lift(wire.name)
        kind = EntryKind(wire: wire.kind)
    }
}

/// What a directory entry is.
public enum EntryKind: Sendable {
    /// An ordinary file.
    case file
    /// A directory, which you can list in turn.
    case directory
    /// Everything that is neither, a symlink among them.
    case other

    init(wire: test_cabinet_gg_files_entry_kind_t) {
        switch Int32(wire) {
        case TEST_CABINET_GG_FILES_ENTRY_KIND_FILE: self = .file
        case TEST_CABINET_GG_FILES_ENTRY_KIND_DIRECTORY: self = .directory
        default: self = .other
        }
    }
}

/// How much of the run's durable-memory budget is used, after the call that returned it.
///
/// Every maximum is optional: each limit can be turned off, and a run's memory strategy applies only
/// some of them, so `nil` means nothing bounds that axis — check before subtracting.
public struct MemoryUsage: Sendable {
    /// Memories currently held.
    public let count: Int
    /// The most memories this run allows, if it limits the count.
    public let maxCount: Int?
    /// Characters of body currently held, across all memories.
    public let totalChars: Int
    /// The most characters of body this run allows in total, if it limits the aggregate.
    public let maxTotalChars: Int?
    /// Characters the memory index occupies, under a run that keeps one.
    public let indexChars: Int?
    /// The most characters the index may occupy, if it is limited.
    public let maxIndexChars: Int?

    init(wire: test_cabinet_gg_memories_memory_usage_t) {
        count = Int(wire.count)
        maxCount = wire.max_count.is_some ? Int(wire.max_count.val) : nil
        totalChars = Int(wire.total_chars)
        maxTotalChars = wire.max_total_chars.is_some ? Int(wire.max_total_chars.val) : nil
        indexChars = wire.index_chars.is_some ? Int(wire.index_chars.val) : nil
        maxIndexChars = wire.max_index_chars.is_some ? Int(wire.max_index_chars.val) : nil
    }
}

/// One memory `memory.searchMemories` matched, and the numbers it was ranked by.
public struct MemoryHit: Sendable {
    /// The memory's slug — what `memory.readMemory` takes.
    public let name: String
    /// Its description, or `""` when it was created without one.
    public let description: String
    /// How many of your distinct keywords it matched — the primary ranking.
    public let matched: Int
    /// How many times those keywords occur in it — the tiebreak.
    public let occurrences: Int
    /// A short window of the memory around its first match.
    public let excerpt: String

    init(wire: test_cabinet_gg_memories_memory_hit_t) {
        name = lift(wire.name)
        description = lift(wire.description)
        matched = Int(wire.matched)
        occurrences = Int(wire.occurrences)
        excerpt = lift(wire.excerpt)
    }
}

/// Where a task stands.
public enum TaskStatus: Sendable {
    /// Not started. Every task begins here.
    case pending
    /// Being worked on now.
    case inProgress
    /// Finished. Tasks blocked on it become actionable once all their blockers are done.
    case done

    /// The wire's value for this case.
    var wire: test_cabinet_gg_tasks_task_status_t {
        switch self {
        case .pending: test_cabinet_gg_tasks_task_status_t(TEST_CABINET_GG_TASKS_TASK_STATUS_PENDING)
        case .inProgress:
            test_cabinet_gg_tasks_task_status_t(TEST_CABINET_GG_TASKS_TASK_STATUS_IN_PROGRESS)
        case .done: test_cabinet_gg_tasks_task_status_t(TEST_CABINET_GG_TASKS_TASK_STATUS_DONE)
        }
    }
}

/// How much of the run's task budget is used, after the call that returned it.
public struct TaskUsage: Sendable {
    /// Tasks currently on the list.
    public let count: Int
    /// The most tasks this run allows.
    public let maxTasks: Int

    init(wire: test_cabinet_gg_tasks_task_usage_t) {
        count = Int(wire.count)
        maxTasks = Int(wire.max_tasks)
    }
}

/// Where an issue stands.
public enum IssueStatus: Sendable {
    /// Not started, and dispatchable once its blockers are done.
    case open
    /// Dispatched, with its assigned agent working on it.
    case inProgress
    /// Finished and, where this run requires reviewers, approved.
    case done

    /// The wire's value for this case.
    var wire: test_cabinet_gg_board_issue_status_t {
        switch self {
        case .open: test_cabinet_gg_board_issue_status_t(TEST_CABINET_GG_BOARD_ISSUE_STATUS_OPEN)
        case .inProgress:
            test_cabinet_gg_board_issue_status_t(TEST_CABINET_GG_BOARD_ISSUE_STATUS_IN_PROGRESS)
        case .done: test_cabinet_gg_board_issue_status_t(TEST_CABINET_GG_BOARD_ISSUE_STATUS_DONE)
        }
    }
}

/// How much of the run's board budget is used, after the call that returned it.
public struct BoardUsage: Sendable {
    /// Epics currently on the board.
    public let epics: Int
    /// The most epics this run allows.
    public let maxEpics: Int
    /// Issues currently on the board.
    public let issues: Int
    /// The most issues this run allows.
    public let maxIssues: Int

    init(wire: test_cabinet_gg_board_board_usage_t) {
        epics = Int(wire.epics)
        maxEpics = Int(wire.max_epics)
        issues = Int(wire.issues)
        maxIssues = Int(wire.max_issues)
    }
}

/// An epic that was just created: the id its prefix resolved to, and the board budget.
public struct EpicCreated: Sendable {
    /// The epic's id — the prefix you gave, upper-cased (`auth` → `AUTH`). Group issues under it with
    /// this, and its issues are numbered from it (`AUTH-1`).
    public let id: String
    /// How much of the board budget is used.
    public let board: BoardUsage

    init(wire: test_cabinet_gg_board_epic_created_t) {
        id = lift(wire.id)
        board = BoardUsage(wire: wire.board)
    }
}

/// An issue that was just created: the id the board assigned it, and the board budget.
public struct IssueCreated: Sendable {
    /// The id the board assigned (`AUTH-1`) — you do not choose it. Use it to block later issues on
    /// this one, or to wait for it.
    public let id: String
    /// How much of the board budget is used.
    public let board: BoardUsage

    init(wire: test_cabinet_gg_board_issue_created_t) {
        id = lift(wire.id)
        board = BoardUsage(wire: wire.board)
    }
}

/// What a context reclaim actually freed from the live context window.
public struct ReclaimReport: Sendable {
    /// Context items dropped from the live window.
    public let items: Int
    /// Approximately how many tokens that freed.
    public let reclaimedTokens: Int
    /// The workspace paths whose views were evicted. Empty for an archive.
    public let paths: [String]
    /// The prose summary of what was reclaimed.
    public let detail: String

    init(wire: test_cabinet_gg_context_reclaim_report_t) {
        items = Int(wire.items)
        reclaimedTokens = Int(wire.reclaimed_tokens)
        paths = lift(wire.paths)
        detail = lift(wire.detail)
    }
}

/// One archived message that matched a search.
public struct ArchiveHit: Sendable {
    /// The archived message's sequence number.
    public let seq: Int
    /// Who said it.
    public let role: MessageRole
    /// The message text.
    public let text: String

    init(wire: test_cabinet_gg_context_archive_hit_t) {
        seq = Int(wire.seq)
        role = MessageRole(wire: wire.role)
        text = lift(wire.text)
    }
}

/// Who said an archived message.
public enum MessageRole: Sendable {
    /// The system prompt.
    case system
    /// A turn's input to you — a result, a view, or an operator's instruction.
    case user
    /// Something you said.
    case assistant
    /// A tool result, on a session that made tool calls rather than writing programs.
    case tool

    init(wire: test_cabinet_gg_context_message_role_t) {
        switch Int32(wire) {
        case TEST_CABINET_GG_CONTEXT_MESSAGE_ROLE_SYSTEM: self = .system
        case TEST_CABINET_GG_CONTEXT_MESSAGE_ROLE_USER: self = .user
        case TEST_CABINET_GG_CONTEXT_MESSAGE_ROLE_ASSISTANT: self = .assistant
        default: self = .tool
        }
    }
}

/// What `context.searchArchive` found.
public struct ArchiveSearch: Sendable {
    /// Nothing has been archived yet, so there was nothing to search. Deliberately distinct from a
    /// search that ran and matched nothing, so you do not archive again believing the first archive
    /// failed.
    public let archiveEmpty: Bool
    /// The matches, most recent first, at most 8.
    public let hits: [ArchiveHit]

    init(wire: test_cabinet_gg_context_archive_search_t) {
        archiveEmpty = wire.archive_empty
        hits = lift(wire.hits.ptr, wire.hits.len) { ArchiveHit(wire: $0) }
    }
}

/// Which of the three kinds a view is.
///
/// The taxonomy is closed at three on purpose: everything on disk is a file, everything a program
/// can compute is a string, and documentation is neither — gg holds it.
public enum ViewKind: Sendable {
    /// A file you opened; its selector is the path.
    case file
    /// A value you showed yourself; its selector is the label you gave it. A directory listing, a
    /// command's output, a child agent's answer and a table you assembled are all this.
    case text
    /// A function's documentation; its selector is the function's name.
    case docs

    init(wire: test_cabinet_gg_views_view_kind_t) {
        switch Int32(wire) {
        case TEST_CABINET_GG_VIEWS_VIEW_KIND_FILE: self = .file
        case TEST_CABINET_GG_VIEWS_VIEW_KIND_TEXT: self = .text
        default: self = .docs
        }
    }
}

/// The window of lines a **paged** file view covers.
public struct ViewRegion: Sendable {
    /// The 1-based first line the view shows.
    public let offset: Int
    /// How many lines it shows.
    public let limit: Int

    init(wire: test_cabinet_gg_views_view_region_t) {
        offset = Int(wire.offset)
        limit = Int(wire.limit)
    }
}

/// One view open in your context window, as `view.current` reports it.
public struct OpenView: Sendable {
    /// Whether it is a file, text, or documentation view.
    public let kind: ViewKind
    /// What `view.close` takes: a file's path, a text view's label, or a docs view's function name.
    public let selector: String
    /// Roughly what holding it costs you, in tokens.
    public let tokens: Int
    /// The line window a paged file view covers; `nil` for a whole-file view and for text views.
    public let region: ViewRegion?

    init(wire: test_cabinet_gg_views_open_view_t) {
        kind = ViewKind(wire: wire.kind)
        selector = lift(wire.selector)
        tokens = Int(wire.tokens)
        region = wire.region.is_some ? ViewRegion(wire: wire.region.val) : nil
    }
}

/// What a child agent is briefed with.
///
/// It is one `enum` with two cases rather than two optional arguments, so "both" and "neither" are
/// programs that do not compile instead of calls that fail at run time.
public enum Brief: Sendable {
    /// Self-contained instructions for the child, which needs no other context.
    case prompt(String)
    /// The id of a board issue to brief the child from, as `project.createIssue` returned it.
    case issue(String)
}

/// A child agent that was spawned and is now running in parallel.
public struct SubagentHandle: Sendable {
    /// The child's id — pass it to `agents.waitForSubagents` or `agents.sendMessage`.
    public let id: String
    /// The agent profile it runs as.
    public let slot: String
    /// The model actually bound to that agent.
    public let modelId: String

    init(wire: test_cabinet_gg_delegation_subagent_handle_t) {
        id = lift(wire.id)
        slot = lift(wire.slot)
        modelId = lift(wire.model_id)
    }
}

/// How a child agent's loop ended — gg's own six words, as the tool-calling path also reports them.
public enum AgentStatus: Sendable {
    /// It finished normally: it called `harness.finish`, and its summary is what it returned.
    case completed
    /// It hit the per-run turn ceiling.
    case exhausted
    /// It passed its wall-clock deadline.
    case timedOut
    /// A model turn failed.
    case modelError
    /// The run's credential was refused.
    case authError
    /// An execution ceiling stopped it — consecutive errors, error rate, or cost.
    case limitExceeded

    init(wire: test_cabinet_gg_delegation_agent_status_t) {
        switch Int32(wire) {
        case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_COMPLETED: self = .completed
        case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_EXHAUSTED: self = .exhausted
        case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_TIMED_OUT: self = .timedOut
        case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_MODEL_ERROR: self = .modelError
        case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_AUTH_ERROR: self = .authError
        default: self = .limitExceeded
        }
    }
}

/// One child agent's collected result.
public struct SubagentResult: Sendable {
    /// The child's id.
    public let id: String
    /// How it finished; `nil` when it produced no return value at all.
    public let status: AgentStatus?
    /// Its final message.
    public let summary: String

    init(wire: test_cabinet_gg_delegation_subagent_result_t) {
        id = lift(wire.id)
        status = wire.status.is_some ? AgentStatus(wire: wire.status.val) : nil
        summary = lift(wire.summary)
    }
}

/// One program you have already run, as `programs.history` lists it.
///
/// It describes the program's **shape**, never its source: a directory that inlined every program
/// would put the whole session back in front of you, which is the one thing the library exists to
/// avoid. Fetch the source you actually want with `programs.get`.
public struct ProgramSummary: Sendable {
    /// The turn it ran on — what `programs.get` takes.
    public let turn: Int
    /// How many lines of source it was.
    public let lines: Int
    /// How many characters of source it was.
    public let chars: Int
    /// Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping it.
    public let ok: Bool
    /// The error it ended with, when it did not run to its end.
    public let error: String?

    init(wire: test_cabinet_gg_programs_program_summary_t) {
        turn = Int(wire.turn)
        lines = Int(wire.lines)
        chars = Int(wire.chars)
        ok = wire.ok
        error = lift(wire.error)
    }
}

/// One function in an API object's directory, as `list` returns it.
///
/// The summary is one line; the whole documentation of a function — every argument, what to put in
/// it, and the types it refers to — is a view, opened with `view.openDocsView`.
public struct FunctionSummary: Sendable {
    /// The function name on its object — `readFile` in `fs.readFile`.
    public let name: String
    /// One line saying what it does: the first sentence of its documentation.
    public let summary: String

    init(wire: test_cabinet_gg_docs_function_summary_t) {
        name = lift(wire.name)
        summary = lift(wire.summary)
    }
}

/// A **three-way** edit of an optional text field: leave it, empty it, or replace it.
///
/// The field really has three states and Swift has a word for that. An `String?` could say only two
/// of them, which is how gg's older stringly interface ended up treating "clear it" and "set it to
/// the empty string" as one request.
///
/// `.keep` is the default value of every argument that takes one, so a patch that names two fields
/// leaves the third alone — which is what leaving a field out of a patch has to mean.
public enum TextEdit: Sendable {
    /// Leave the field as it is.
    case keep
    /// Empty the field.
    case clear
    /// Replace the field with this text.
    case set(String)
}

/// How an issue's epic grouping changes — the same three-way shape as `TextEdit`, for a field whose
/// value is an epic id.
public enum EpicAssignment: Sendable {
    /// Leave the grouping alone.
    case keep
    /// Detach the issue from its epic, leaving it ungrouped.
    case ungroup
    /// Group the issue under this epic, by its id.
    case set(String)
}
