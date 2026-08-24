//! The [wire](super)'s context half: the four context operations, the three documentation
//! ones, the five view ones and the three the program library carries.
//!
//! Every one of them can fail, if only at the gate every bracket asks: `views.current` has nothing
//! to fail at once it is granted, and still answers `unavailable` to an agent whose run did not buy
//! it. So the guest reads every answer the same way and no call is special-cased in a language that
//! has no way to know which ones are.

use super::super::test_cabinet::gg::context::{
    ArchiveHit, ArchiveSearch, Host as ContextHost, MessageRole, ReclaimReport, TurnRange,
};
use super::super::test_cabinet::gg::docs::{DocHit, DocSearch, Host as DocsHost};
use super::super::test_cabinet::gg::programs::{Host as ProgramsHost, ProgramSummary};
use super::super::test_cabinet::gg::views::{Host as ViewsHost, OpenView, ViewKind, ViewRegion};
use super::super::{MembraneState, OperationApi};
use super::wire_coding::{Value, argument, integer, optional, record, text, texts, wide};
use super::workspace::file_read;
use super::{Answer, Failure};

// ---------------------------------------------------------------------------------------------
// The context window
// ---------------------------------------------------------------------------------------------

/// `context.evict_file_view` — drop a file view, or all of them.
pub(super) fn evict_file_view<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let path = argument(arguments, op, 0)?.optional_text("the path")?;
    Ok(reclaim_report(ContextHost::evict_file_view(state, path)?))
}

/// `context.archive_thread` — archive whole turns.
pub(super) fn archive_thread<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let ranges = argument(arguments, op, 0)?
        .list("the turn ranges")?
        .iter()
        .map(turn_range)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(reclaim_report(ContextHost::archive_thread(state, ranges)?))
}

/// `context.search_archive` — search what was archived.
pub(super) fn search_archive<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let query = argument(arguments, op, 0)?.text("the query")?;
    Ok(archive_search(ContextHost::search_archive(state, query)?))
}

/// `context.compact` — compact the thread behind a summary.
pub(super) fn compact<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let summary = argument(arguments, op, 0)?.text("the summary")?;
    let files = argument(arguments, op, 1)?.texts("a path")?;
    ContextHost::compact(state, summary, files)?;
    Ok(Value::None)
}

/// One `turn-range`.
fn turn_range(value: &Value) -> Result<TurnRange, Failure> {
    Ok(TurnRange {
        start: value
            .field("the range", "start")?
            .integer("the first turn")?,
        end: value.field("the range", "end")?.integer("the last turn")?,
    })
}

/// The `reclaim-report` record.
fn reclaim_report(report: ReclaimReport) -> Value {
    record([
        ("items", integer(report.items)),
        ("reclaimed-tokens", integer(report.reclaimed_tokens)),
        ("paths", texts(report.paths)),
        ("detail", text(report.detail)),
    ])
}

/// The `archive-search` record.
fn archive_search(search: ArchiveSearch) -> Value {
    record([
        ("archive-empty", Value::Bool(search.archive_empty)),
        (
            "hits",
            Value::List(search.hits.into_iter().map(archive_hit).collect()),
        ),
    ])
}

/// One `archive-hit`.
fn archive_hit(hit: ArchiveHit) -> Value {
    record([
        ("seq", integer(hit.seq)),
        (
            "role",
            text(match hit.role {
                MessageRole::System => "system",
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                MessageRole::Tool => "tool",
            }),
        ),
        ("text", text(hit.text)),
    ])
}

// ---------------------------------------------------------------------------------------------
// The documentation
// ---------------------------------------------------------------------------------------------

/// `docs.search` — search the surface this agent binds.
pub(super) fn search<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let query = argument(arguments, op, 0)?.optional_text("the query")?;
    let modules = argument(arguments, op, 1)?.texts("the module filter")?;
    let declared = argument(arguments, op, 2)?.optional_text("the type filter")?;
    let kind = argument(arguments, op, 3)?.optional_text("the kind filter")?;
    let offset = argument(arguments, op, 4)?.optional_integer("the offset")?;
    let limit = argument(arguments, op, 5)?.optional_integer("the limit")?;
    Ok(doc_search(DocsHost::search(
        state, query, modules, declared, kind, offset, limit,
    )?))
}

/// `docs.close` — close one documentation view.
pub(super) fn close_doc_view<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let key = argument(arguments, op, 0)?.text("the entry's key")?;
    Ok(integer(DocsHost::close_doc_view(state, key)?))
}

/// `docs.close_all` — close every documentation view.
pub(super) fn close_doc_views<A: OperationApi>(state: &mut MembraneState<A>) -> Answer {
    Ok(integer(DocsHost::close_doc_views(state)?))
}

/// The `doc-search` record.
fn doc_search(search: DocSearch) -> Value {
    record([
        ("total", integer(search.total)),
        ("offset", integer(search.offset)),
        (
            "hits",
            Value::List(search.hits.into_iter().map(doc_hit).collect()),
        ),
    ])
}

/// One `doc-hit`.
fn doc_hit(hit: DocHit) -> Value {
    record([
        ("key", text(hit.key)),
        ("kind", text(hit.kind)),
        ("module", text(hit.module)),
        ("name", text(hit.name)),
        ("summary", text(hit.summary)),
    ])
}

// ---------------------------------------------------------------------------------------------
// The views
// ---------------------------------------------------------------------------------------------

/// `views.open_file` — put a file, or a window of one, in the context window.
pub(super) fn open_file_view<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let path = argument(arguments, op, 0)?.text("the path")?;
    let offset = argument(arguments, op, 1)?.optional_integer("the offset")?;
    let limit = argument(arguments, op, 2)?.optional_integer("the limit")?;
    Ok(file_read(ViewsHost::open_file_view(
        state, path, offset, limit,
    )?))
}

/// `views.open_text` — put composed text in the context window.
pub(super) fn open_text_view<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let label = argument(arguments, op, 0)?.text("the label")?;
    let body = argument(arguments, op, 1)?.text("the body")?;
    ViewsHost::open_text_view(state, label, body)?;
    Ok(Value::None)
}

/// `views.open_docs_view` — put one documentation entry in the context window.
pub(super) fn open_docs_view<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let name = argument(arguments, op, 0)?.text("the entry's name")?;
    ViewsHost::open_docs_view(state, name)?;
    Ok(Value::None)
}

/// `views.close` — close whatever a selector names.
pub(super) fn close_view<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let selector = argument(arguments, op, 0)?.text("the selector")?;
    Ok(integer(ViewsHost::close_view(state, selector)?))
}

/// `views.current` — what is open. Once granted it cannot fail.
pub(super) fn current_views<A: OperationApi>(state: &mut MembraneState<A>) -> Answer {
    Ok(Value::List(
        ViewsHost::current_views(state)?
            .into_iter()
            .map(open_view)
            .collect(),
    ))
}

/// One `open-view`.
fn open_view(view: OpenView) -> Value {
    record([
        (
            "kind",
            text(match view.kind {
                ViewKind::File => "file",
                ViewKind::Text => "text",
                ViewKind::Docs => "docs",
            }),
        ),
        ("selector", text(view.selector)),
        ("tokens", wide(view.tokens)),
        ("region", optional(view.region, view_region)),
    ])
}

/// The `view-region` record.
fn view_region(region: ViewRegion) -> Value {
    record([
        ("offset", integer(region.offset)),
        ("limit", integer(region.limit)),
    ])
}

// ---------------------------------------------------------------------------------------------
// The program library
// ---------------------------------------------------------------------------------------------

/// `programs.history` — every program this agent has run.
pub(super) fn history<A: OperationApi>(state: &mut MembraneState<A>) -> Answer {
    Ok(Value::List(
        ProgramsHost::history(state)?
            .into_iter()
            .map(program_summary)
            .collect(),
    ))
}

/// `programs.get` — the source of one of them.
pub(super) fn get<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let turn = argument(arguments, op, 0)?.optional_integer("the turn")?;
    Ok(text(ProgramsHost::get(state, turn)?))
}

/// `programs.rerun` — run a stored program again.
pub(super) fn rerun<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let source = argument(arguments, op, 0)?.text("the program")?;
    ProgramsHost::rerun(state, source)?;
    Ok(Value::None)
}

/// One `program-summary`.
fn program_summary(summary: ProgramSummary) -> Value {
    record([
        ("turn", integer(summary.turn)),
        ("lines", integer(summary.lines)),
        ("chars", integer(summary.chars)),
        ("ok", Value::Bool(summary.ok)),
        ("error", optional(summary.error, text)),
    ])
}
