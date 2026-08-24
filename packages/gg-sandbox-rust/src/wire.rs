//! **The bridge**, and the only part of this crate a model never reads.
//!
//! The generated [`bindings`](crate::bindings) are the wire: `kebab-case` interfaces reached by
//! their full package path, records whose documentation is the WIT's rather than the model's, and
//! types shaped by what crosses a component boundary. The [SDK](crate) is what a Rust author calls.
//! This module is where one becomes the other — lifting a wire record into an owned model-facing
//! type, lowering an SDK option struct into the record the import expects, and turning the wire's
//! `result<_, api-error>` into an [`ApiError`](crate::ApiError).
//!
//! It is deliberately not a generic mapping layer. Each function here is written out, because the
//! two sides differ in exactly the places the SDK was designed to differ — an inclusive
//! [`RangeInclusive`](std::ops::RangeInclusive) where the wire has a `turn-range` record, a
//! [`TextEdit`] where an older interface had a sentinel string, an
//! [`Option<&str>`](Option) where the wire takes an `option<string>` — and a mapping that could be
//! derived would be one that had nothing to say.

use std::ops::RangeInclusive;

use crate::bindings::test_cabinet::gg as gen;
use crate::board::{
    BoardUsage, EpicAssignment, EpicCreated, IssueCreated, IssuePatch, IssueStatus,
};
use crate::context::{ArchiveHit, ArchiveSearch, MessageRole, ReclaimReport};
use crate::core::ApiError;
use crate::delegation::{AgentStatus, Brief, SubagentHandle, SubagentResult};
use crate::docs::{DocHit, DocKind, DocSearch};
use crate::files::{DirEntry, EntryKind, FileRead, ImageFile, ReadOptions, SearchMatch, TextFile};
use crate::memories::{MemoryHit, MemoryUsage};
use crate::programs::ProgramSummary;
use crate::shell::ShellOutput;
use crate::tasks::{TaskPatch, TaskStatus, TaskUsage, TextEdit};
use crate::views::ViewOptions;

/// Every call in this SDK ends here: the wire's error arm, lifted into the SDK's own.
pub(crate) fn lift<T>(outcome: Result<T, gen::types::ApiError>) -> Result<T, ApiError> {
    outcome.map_err(ApiError::from_wire)
}

/// A slice of borrowed strings, as the wire's `list<string>` wants it.
///
/// The one allocation this bridge cannot avoid: a `list<string>` is lowered from a `&[String]`, and
/// a program writes `&["AUTH-1"]`. Copying a handful of short ids is not worth an SDK that takes
/// `&[String]` and makes every call site say `.to_string()`.
pub(crate) fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

// -------------------------------------------------------------------------------------------
// Lowering — what a program wrote, in the shape the import takes
// -------------------------------------------------------------------------------------------

impl ReadOptions {
    /// The two window arguments, in the order every read on the wire takes them.
    pub(crate) fn window(self) -> (Option<u32>, Option<u32>) {
        (self.offset, self.limit)
    }
}

impl ViewOptions {
    /// The three window arguments, in the order `open-file-view` takes them.
    pub(crate) fn window(self) -> (Option<u32>, Option<u32>, Option<u32>) {
        (self.offset, self.limit, self.max_line_chars)
    }
}

impl TextEdit<'_> {
    /// The wire's three-way edit.
    pub(crate) fn to_wire(self) -> gen::types::TextEdit {
        match self {
            Self::Keep => gen::types::TextEdit::Keep,
            Self::Clear => gen::types::TextEdit::Clear,
            Self::Set(text) => gen::types::TextEdit::Set(text.to_string()),
        }
    }
}

impl EpicAssignment<'_> {
    /// The wire's three-way epic grouping.
    pub(crate) fn to_wire(self) -> gen::board::EpicAssignment {
        match self {
            Self::Keep => gen::board::EpicAssignment::Keep,
            Self::Ungroup => gen::board::EpicAssignment::Ungroup,
            Self::Set(id) => gen::board::EpicAssignment::Set(id.to_string()),
        }
    }
}

impl TaskStatus {
    /// The wire's task status.
    pub(crate) fn to_wire(self) -> gen::tasks::TaskStatus {
        match self {
            Self::Pending => gen::tasks::TaskStatus::Pending,
            Self::InProgress => gen::tasks::TaskStatus::InProgress,
            Self::Done => gen::tasks::TaskStatus::Done,
        }
    }
}

impl IssueStatus {
    /// The wire's issue status.
    pub(crate) fn to_wire(self) -> gen::board::IssueStatus {
        match self {
            Self::Open => gen::board::IssueStatus::Open,
            Self::InProgress => gen::board::IssueStatus::InProgress,
            Self::Done => gen::board::IssueStatus::Done,
        }
    }
}

impl TaskPatch<'_> {
    /// The wire's task patch.
    pub(crate) fn to_wire(self) -> gen::tasks::TaskPatch {
        gen::tasks::TaskPatch {
            title: self.title.map(str::to_string),
            description: self.description.to_wire(),
            status: self.status.map(TaskStatus::to_wire),
        }
    }
}

impl IssuePatch<'_> {
    /// The wire's issue patch.
    pub(crate) fn to_wire(self) -> gen::board::IssuePatch {
        gen::board::IssuePatch {
            title: self.title.map(str::to_string),
            description: self.description.to_wire(),
            in_scope: self.in_scope.map(str::to_string),
            out_of_scope: self.out_of_scope.map(str::to_string),
            completion_criteria: self.completion_criteria.map(str::to_string),
            status: self.status.map(IssueStatus::to_wire),
            epic: self.epic.to_wire(),
        }
    }
}

impl Brief<'_> {
    /// The wire's brief.
    pub(crate) fn to_wire(self) -> gen::delegation::SubagentBrief {
        match self {
            Self::Prompt(prompt) => gen::delegation::SubagentBrief::Prompt(prompt.to_string()),
            Self::Issue(id) => gen::delegation::SubagentBrief::Issue(id.to_string()),
        }
    }
}

/// An inclusive span of turn numbers, as the wire's `turn-range` record.
///
/// The SDK takes [`RangeInclusive<u32>`] because a span of integers in Rust *is* a range, and
/// `4..=19` is what an author writes. The wire has a record with a `start` and an `end`, which is
/// the same span said the way a language-neutral IDL has to say it.
pub(crate) fn turn_range(range: &RangeInclusive<u32>) -> gen::context::TurnRange {
    gen::context::TurnRange {
        start: *range.start(),
        end: *range.end(),
    }
}

// -------------------------------------------------------------------------------------------
// Lifting — what the host answered, in the shape a program reads
// -------------------------------------------------------------------------------------------

/// What a completed process reported.
pub(crate) fn shell_output(output: gen::shell::ShellOutput) -> ShellOutput {
    ShellOutput {
        exit_code: output.exit_code,
        output: output.output,
        truncated: output.truncated,
    }
}

/// A read, narrowed into the arm it belongs to.
pub(crate) fn file_read(read: gen::files::FileRead) -> FileRead {
    match read {
        gen::files::FileRead::Text(text) => FileRead::Text(TextFile {
            contents: text.contents,
            first_line: text.first_line,
            last_line: text.last_line,
            total_lines: text.total_lines,
            byte_truncated: text.byte_truncated,
        }),
        gen::files::FileRead::Image(image) => FileRead::Image(ImageFile {
            media_type: image.media_type,
            label: image.label,
            bytes: image.bytes,
            shown: image.shown,
            not_shown_reason: image.not_shown_reason,
        }),
    }
}

/// One directory entry.
pub(crate) fn dir_entry(entry: gen::files::DirEntry) -> DirEntry {
    DirEntry {
        name: entry.name,
        kind: match entry.kind {
            gen::files::EntryKind::File => EntryKind::File,
            gen::files::EntryKind::Directory => EntryKind::Directory,
            gen::files::EntryKind::Other => EntryKind::Other,
        },
    }
}

/// One line a search matched.
pub(crate) fn search_match(found: gen::files::SearchMatch) -> SearchMatch {
    SearchMatch {
        path: found.path,
        line: found.line,
        text: found.text,
    }
}

/// How much of the memory budget is used.
pub(crate) fn memory_usage(usage: gen::memories::MemoryUsage) -> MemoryUsage {
    MemoryUsage {
        count: usage.count,
        max_count: usage.max_count,
        total_chars: usage.total_chars,
        max_total_chars: usage.max_total_chars,
        index_chars: usage.index_chars,
        max_index_chars: usage.max_index_chars,
    }
}

/// One memory a search matched.
pub(crate) fn memory_hit(hit: gen::memories::MemoryHit) -> MemoryHit {
    MemoryHit {
        name: hit.name,
        description: hit.description,
        matched: hit.matched,
        occurrences: hit.occurrences,
        excerpt: hit.excerpt,
    }
}

/// How much of the task budget is used.
pub(crate) fn task_usage(usage: gen::tasks::TaskUsage) -> TaskUsage {
    TaskUsage {
        count: usage.count,
        max_tasks: usage.max_tasks,
    }
}

/// How much of the board budget is used.
pub(crate) fn board_usage(usage: gen::board::BoardUsage) -> BoardUsage {
    BoardUsage {
        epics: usage.epics,
        max_epics: usage.max_epics,
        issues: usage.issues,
        max_issues: usage.max_issues,
    }
}

/// An epic the board just created.
pub(crate) fn epic_created(created: gen::board::EpicCreated) -> EpicCreated {
    EpicCreated {
        id: created.id,
        board: board_usage(created.board),
    }
}

/// An issue the board just created.
pub(crate) fn issue_created(created: gen::board::IssueCreated) -> IssueCreated {
    IssueCreated {
        id: created.id,
        board: board_usage(created.board),
    }
}

/// What a reclaim freed.
pub(crate) fn reclaim_report(report: gen::context::ReclaimReport) -> ReclaimReport {
    ReclaimReport {
        items: report.items,
        reclaimed_tokens: report.reclaimed_tokens,
        paths: report.paths,
        detail: report.detail,
    }
}

/// What a search of the archive found.
pub(crate) fn archive_search(found: gen::context::ArchiveSearch) -> ArchiveSearch {
    ArchiveSearch {
        archive_empty: found.archive_empty,
        hits: found
            .hits
            .into_iter()
            .map(|hit| ArchiveHit {
                seq: hit.seq,
                role: match hit.role {
                    gen::context::MessageRole::System => MessageRole::System,
                    gen::context::MessageRole::User => MessageRole::User,
                    gen::context::MessageRole::Assistant => MessageRole::Assistant,
                    gen::context::MessageRole::Tool => MessageRole::Tool,
                },
                text: hit.text,
            })
            .collect(),
    }
}

/// One page of what a documentation search found.
///
/// The wire spells a hit's kind as a **word**, because WIT has no closed set to spell it as that
/// both sides of a component boundary would agree on. The SDK spells it as a [`DocKind`], which is
/// what makes a `match` on it exhaustive and a filter unmisspellable — and the index files an entry
/// under `module`, `function` or `type` and nothing else, so any other word lifts to
/// [`DocKind::Function`] rather than costing every hit a fallible parse for a case the host cannot
/// produce.
pub(crate) fn doc_search(found: gen::docs::DocSearch) -> DocSearch {
    DocSearch {
        total: found.total,
        offset: found.offset,
        hits: found
            .hits
            .into_iter()
            .map(|hit| DocHit {
                key: hit.key,
                kind: match hit.kind.as_str() {
                    "module" => DocKind::Module,
                    "type" => DocKind::Type,
                    _ => DocKind::Function,
                },
                module: hit.module,
                name: hit.name,
                summary: hit.summary,
            })
            .collect(),
    }
}

/// One spawned child.
pub(crate) fn subagent_handle(handle: gen::delegation::SubagentHandle) -> SubagentHandle {
    SubagentHandle {
        id: handle.id,
        slot: handle.slot,
        model_id: handle.model_id,
    }
}

/// One collected child result.
pub(crate) fn subagent_result(result: gen::delegation::SubagentResult) -> SubagentResult {
    SubagentResult {
        id: result.id,
        status: result.status.map(|status| match status {
            gen::delegation::AgentStatus::Completed => AgentStatus::Completed,
            gen::delegation::AgentStatus::Exhausted => AgentStatus::Exhausted,
            gen::delegation::AgentStatus::TimedOut => AgentStatus::TimedOut,
            gen::delegation::AgentStatus::ModelError => AgentStatus::ModelError,
            gen::delegation::AgentStatus::AuthError => AgentStatus::AuthError,
            gen::delegation::AgentStatus::LimitExceeded => AgentStatus::LimitExceeded,
        }),
        summary: result.summary,
    }
}

/// One program the library holds.
pub(crate) fn program_summary(summary: gen::programs::ProgramSummary) -> ProgramSummary {
    ProgramSummary {
        turn: summary.turn,
        lines: summary.lines,
        chars: summary.chars,
        ok: summary.ok,
        error: summary.error,
    }
}
