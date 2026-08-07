//! The **model-facing** shapes this SDK's functions hand back.
//!
//! They are ordinary Rust: a `struct` with public fields where the value has parts, an `enum` where
//! it is one of a fixed set of things, and [`Option`] where the wire may leave something out. A
//! program reads `read.total_lines` and matches `entry.kind` against [`EntryKind::File`], which is
//! what makes the surface something a Rust author can hold in their head rather than a WIT file
//! rendered in Rust syntax.
//!
//! Three conventions run through the file, and each is a decision rather than a habit.
//!
//! * **A fixed choice is an `enum`, never a string.** A model that guesses the spelling of a string
//!   constant guesses wrong about as often as it guesses right, and a wrong string is a branch that
//!   silently never runs. [`TaskStatus::Done`] is a name the compiler either knows or does not.
//! * **An arm is not prefixed by what it belongs to.** Rust namespaces a variant under its type, so
//!   `TaskStatus::Done` and `IssueStatus::Done` coexist and neither has to be called `TaskDone` —
//!   which is the same fact the [PureScript arm] has to spell the other way round.
//! * **Everything is owned.** A result crosses the membrane as bytes that are copied into the
//!   guest's memory, so a `String` here is a `String` and not a borrow of something the host still
//!   holds. Nothing you are handed back can dangle.
//!
//! [PureScript arm]: https://docs.testcabinet.ai/gg/program-languages/

/// What a command [`system::shell`](crate::system::shell) ran reported when it finished.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellOutput {
    /// The process's exit status; `None` when a signal killed it. Zero means success.
    pub exit_code: Option<i32>,
    /// Merged stdout-then-stderr, tail-truncated at 16 KiB — or, when the run offloads shell
    /// output, at the configured line/character ceiling, with a note naming the files holding the
    /// whole of it. Under the default `adaptive` mode a command that succeeded returns just that
    /// note.
    pub output: String,
    /// Whether the cap cut `output`, dropping the head and keeping the tail.
    pub truncated: bool,
}

/// What [`fs::read_file`](crate::fs::read_file) returned: a text file's window, or a picture's
/// description.
///
/// A picture is a different kind of thing from text, so it is a different variant rather than a
/// string that happens to be binary — a program that treats an image as text is caught by the
/// `match` instead of silently writing an empty string somewhere. Image *bytes* never enter the
/// program: gg attaches the picture to the turn so you can look at it directly, which is worth far
/// more than base64 in a variable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileRead {
    /// This file is text.
    Text(TextFile),
    /// This file is a picture; gg shows it to you rather than handing you its bytes.
    Image(ImageFile),
}

/// A text file's window, as the [`FileRead::Text`] arm of a read carries it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextFile {
    /// The file's text, or just the requested window under a capped read policy.
    pub contents: String,
    /// The 1-based first line returned.
    pub first_line: u32,
    /// The 1-based last line returned.
    pub last_line: u32,
    /// The file's total line count, so you know whether to page again.
    pub total_lines: u32,
    /// Whether a 256 KiB byte ceiling cut the returned text.
    pub byte_truncated: bool,
}

/// A picture's description, as the [`FileRead::Image`] arm of a read carries it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageFile {
    /// The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
    pub media_type: String,
    /// The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
    pub label: String,
    /// The file's size in bytes.
    pub bytes: u64,
    /// Whether the picture is being attached to this turn for you to look at.
    pub shown: bool,
    /// Why it is not being shown; `None` when `shown` is true.
    pub not_shown_reason: Option<String>,
}

/// One entry [`fs::list_dir`](crate::fs::list_dir) found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntry {
    /// The entry's bare name, with no directory part. Join it with the directory you listed.
    pub name: String,
    /// What the entry is.
    pub kind: EntryKind,
}

/// What a directory entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EntryKind {
    /// An ordinary file.
    File,
    /// A directory, which you can list in turn.
    Directory,
    /// Everything that is neither, a symlink among them.
    Other,
}

/// How much of the run's durable-memory budget is used, after the call that returned it.
///
/// Every maximum is an [`Option`]: each limit can be turned off, and a run's memory strategy applies
/// only some of them, so `None` means nothing bounds that axis — check before subtracting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryUsage {
    /// Memories currently held.
    pub count: u32,
    /// The most memories this run allows, if it limits the count.
    pub max_count: Option<u32>,
    /// Characters of body currently held, across all memories.
    pub total_chars: u32,
    /// The most characters of body this run allows in total, if it limits the aggregate.
    pub max_total_chars: Option<u32>,
    /// Characters the memory index occupies, under a run that keeps one.
    pub index_chars: Option<u32>,
    /// The most characters the index may occupy, if it is limited.
    pub max_index_chars: Option<u32>,
}

/// One memory [`memory::search_memories`](crate::memory::search_memories) matched, and the numbers
/// it was ranked by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryHit {
    /// The memory's slug — what [`memory::read_memory`](crate::memory::read_memory) takes.
    pub name: String,
    /// Its description, or `""` when it was created without one.
    pub description: String,
    /// How many of your distinct keywords it matched — the primary ranking.
    pub matched: u32,
    /// How many times those keywords occur in it — the tiebreak.
    pub occurrences: u32,
    /// A short window of the memory around its first match.
    pub excerpt: String,
}

/// Where a task stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TaskStatus {
    /// Not started. Every task begins here.
    Pending,
    /// Being worked on now.
    InProgress,
    /// Finished. Tasks blocked on it become actionable once all their blockers are done.
    Done,
}

/// How much of the run's task budget is used, after the call that returned it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskUsage {
    /// Tasks currently on the list.
    pub count: u32,
    /// The most tasks this run allows.
    pub max_tasks: u32,
}

/// Where an issue stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IssueStatus {
    /// Not started, and dispatchable once its blockers are done.
    Open,
    /// Dispatched, with its assigned agent working on it.
    InProgress,
    /// Finished and, where this run requires reviewers, approved.
    Done,
}

/// How much of the run's board budget is used, after the call that returned it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoardUsage {
    /// Epics currently on the board.
    pub epics: u32,
    /// The most epics this run allows.
    pub max_epics: u32,
    /// Issues currently on the board.
    pub issues: u32,
    /// The most issues this run allows.
    pub max_issues: u32,
}

/// An epic that was just created: the id its prefix resolved to, and the board budget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpicCreated {
    /// The epic's id — the prefix you gave, upper-cased (`auth` → `AUTH`). Group issues under it
    /// with this, and its issues are numbered from it (`AUTH-1`).
    pub id: String,
    /// How much of the board budget is used.
    pub board: BoardUsage,
}

/// An issue that was just created: the id the board assigned it, and the board budget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueCreated {
    /// The id the board assigned (`AUTH-1`) — you do not choose it. Use it to block later issues on
    /// this one, or to wait for it.
    pub id: String,
    /// How much of the board budget is used.
    pub board: BoardUsage,
}

/// What a context reclaim actually freed from the live context window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReclaimReport {
    /// Context items dropped from the live window.
    pub items: u32,
    /// Approximately how many tokens that freed.
    pub reclaimed_tokens: u32,
    /// The workspace paths whose views were evicted. Empty for an archive.
    pub paths: Vec<String>,
    /// The prose summary of what was reclaimed.
    pub detail: String,
}

/// One archived message that matched a search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveHit {
    /// The archived message's sequence number.
    pub seq: u32,
    /// Who said it.
    pub role: MessageRole,
    /// The message text.
    pub text: String,
}

/// Who said an archived message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MessageRole {
    /// The system prompt.
    System,
    /// A turn's input to you — a result, a view, or an operator's instruction.
    User,
    /// Something you said.
    Assistant,
    /// A tool result, on a session that made tool calls rather than writing programs.
    Tool,
}

/// What [`context::search_archive`](crate::context::search_archive) found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveSearch {
    /// Nothing has been archived yet, so there was nothing to search. Deliberately distinct from a
    /// search that ran and matched nothing, so you do not archive again believing the first archive
    /// failed.
    pub archive_empty: bool,
    /// The matches, most recent first, at most 8.
    pub hits: Vec<ArchiveHit>,
}

/// Which of the three kinds a view is.
///
/// The taxonomy is closed at three on purpose: everything on disk is a file, everything a program
/// can compute is a string, and documentation is neither — gg holds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ViewKind {
    /// A file you opened; its selector is the path.
    File,
    /// A value you showed yourself; its selector is the label you gave it. A directory listing, a
    /// command's output, a child agent's answer and a table you assembled are all this.
    Text,
    /// A function's documentation; its selector is the function's name.
    Docs,
}

/// The window of lines a **paged** file view covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewRegion {
    /// The 1-based first line the view shows.
    pub offset: u32,
    /// How many lines it shows.
    pub limit: u32,
}

/// One view open in your context window, as [`view::current`](crate::view::current) reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenView {
    /// Whether it is a file, text, or documentation view.
    pub kind: ViewKind,
    /// What [`view::close`](crate::view::close) takes: a file's path, a text view's label, or a
    /// docs view's function name.
    pub selector: String,
    /// Roughly what holding it costs you, in tokens.
    pub tokens: u64,
    /// The line window a paged file view covers; `None` for a whole-file view and for text views.
    pub region: Option<ViewRegion>,
}

/// What a child agent is briefed with.
///
/// The choice is an `enum` rather than a pair of optional arguments, so "both" and "neither" are
/// programs that do not compile instead of calls that fail at run time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Brief<'a> {
    /// Self-contained instructions for the child, which needs no other context.
    Prompt(&'a str),
    /// The id of a board issue to brief the child from, as
    /// [`project::create_issue`](crate::project::create_issue) returned it.
    Issue(&'a str),
}

/// A child agent that was spawned and is now running in parallel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentHandle {
    /// The child's id — pass it to
    /// [`agents::wait_for_subagents`](crate::agents::wait_for_subagents) or
    /// [`agents::send_message`](crate::agents::send_message).
    pub id: String,
    /// The agent profile it runs as.
    pub slot: String,
    /// The model actually bound to that agent.
    pub model_id: String,
}

/// How a child agent's loop ended — gg's own six words, as the tool-calling path also reports them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentStatus {
    /// It finished normally: it called [`harness::finish`](crate::harness::finish), and its summary
    /// is what it returned.
    Completed,
    /// It hit the per-run turn ceiling.
    Exhausted,
    /// It passed its wall-clock deadline.
    TimedOut,
    /// A model turn failed.
    ModelError,
    /// The run's credential was refused.
    AuthError,
    /// An execution ceiling stopped it — consecutive errors, error rate, or cost.
    LimitExceeded,
}

/// One child agent's collected result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentResult {
    /// The child's id.
    pub id: String,
    /// How it finished; `None` when it produced no return value at all.
    pub status: Option<AgentStatus>,
    /// Its final message.
    pub summary: String,
}

/// One program you have already run, as [`programs::history`](crate::programs::history) lists it.
///
/// It describes the program's **shape**, never its source: a directory that inlined every program
/// would put the whole session back in front of you, which is the one thing the library exists to
/// avoid. Fetch the source you actually want with [`programs::get`](crate::programs::get).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramSummary {
    /// The turn it ran on — what [`programs::get`](crate::programs::get) takes.
    pub turn: u32,
    /// How many lines of source it was.
    pub lines: u32,
    /// How many characters of source it was.
    pub chars: u32,
    /// Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping it.
    pub ok: bool,
    /// The error it ended with, when it did not run to its end.
    pub error: Option<String>,
}

/// One function in an API object's directory, as `list` returns it.
///
/// The summary is one line; the whole documentation of a function — every shape it may be called in,
/// what to put in each argument, and the types it refers to — is a view, opened with
/// [`view::open_docs_view`](crate::view::open_docs_view).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FunctionSummary {
    /// The function name on its object — `read_file` in `fs::read_file`.
    pub name: String,
    /// One line saying what it does: the first sentence of its documentation.
    pub summary: String,
}

/// A **three-way** edit of an optional text field: leave it, empty it, or replace it.
///
/// It is an `enum` because the field really has three states and Rust has a word for that. An
/// `Option<&str>` could only say two of them, which is how gg's older stringly interface ended up
/// treating "clear it" and "set it to the empty string" as one request.
///
/// [`Keep`](Self::Keep) is the [`Default`], so a patch built with `..Default::default()` leaves the
/// field alone — which is what leaving a field out of a patch has to mean.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextEdit<'a> {
    /// Leave the field as it is.
    #[default]
    Keep,
    /// Empty the field.
    Clear,
    /// Replace the field with this text.
    Set(&'a str),
}

/// How an issue's epic grouping changes — the same three-way shape as [`TextEdit`], for a field
/// whose value is an epic id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EpicAssignment<'a> {
    /// Leave the grouping alone.
    #[default]
    Keep,
    /// Detach the issue from its epic, leaving it ungrouped.
    Ungroup,
    /// Group the issue under this epic, by its id.
    Set(&'a str),
}
