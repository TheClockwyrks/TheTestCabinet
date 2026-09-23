//! The workspace half of the membrane: `shell`, the five file operations, and the one helper built
//! on them.
//!
//! These seven are what almost every program touches, and two of them carry rules worth stating
//! where they are implemented. `shell` reports a non-zero exit as a **value**, because branching on
//! `result.exitCode` is the single most common thing a program does — and, for the same reason, a
//! process that ran is recorded as a completed call however it exited.
//!
//! And every `shell` timeout is **clamped at both ends**: down to what is left of the run's
//! wall-clock budget, because a host function cannot trap and one `shell("sleep 3600")` would
//! otherwise carry the whole run past its deadline with no mechanism left to stop it; and down to
//! gg's own absolute ceiling, because the tool builds a `Duration` from whatever number arrives and
//! a `Duration` cannot hold every `f64`.

use std::time::Duration;

use super::test_cabinet::gg::files::{
    DirEntry, EntryKind, FileRead, Host as FilesHost, ImageRead, SearchMatch, TextRead,
};
use super::test_cabinet::gg::shell::{Host as ShellHost, ShellOutput};
use super::test_cabinet::gg::types::{ApiError, ErrorCode};
use super::{MembraneState, OperationApi};
use crate::sandbox::operations::OperationId;
use crate::sandbox::operations::{
    FILES_EDIT_FILE, FILES_LIST_DIR, FILES_READ_FILE, FILES_SEARCH, FILES_TREE, FILES_WRITE_FILE,
    SHELL_SHELL,
};
use crate::tools::{
    ApiData, DirEntryData, DirEntryKind, SHELL_DEFAULT_TIMEOUT_SECS as DEFAULT_TIMEOUT_SECS,
    SearchMatchData,
};

/// The longest `shell` timeout the membrane will forward: a day, which no command in a run
/// container has any business exceeding.
///
/// The upper clamp exists for a harder reason than taste. A [`Duration`] cannot hold every `f64` —
/// `Duration::from_secs_f64` **panics** above ~1.8×10¹⁹ seconds — and `shell`'s own argument
/// parsing calls it as soon as the value is finite and positive. So a run with no deadline (nothing
/// to clamp against) plus a guest that asked for `1e300` would panic inside the tool, on the async
/// loop, in the turn's own future: a one-line program taking the run down. Clamping here means the
/// tool only ever sees a number it can represent.
const MAX_TIMEOUT_SECS: f64 = 86_400.0;

/// The lowest `offset` gg's `read_file` accepts: its windows are **1-based**, and its schema says
/// `minimum: 1`.
///
/// The membrane's own type cannot say that — WIT's `option<u32>` admits zero — and neither the
/// signature a model is shown nor the SDK's range check mentions it, so `readFile(p, { offset: 0 })`
/// is a perfectly reasonable thing for a model to write meaning "from the start". Rather than spend
/// a turn on an argument error about a constraint the signature never stated, the membrane reads it
/// as what it plainly means: the first line.
const FIRST_LINE_OFFSET: u32 = 1;

impl<A: OperationApi> ShellHost for MembraneState<A> {
    fn shell(
        &mut self,
        command: String,
        timeout_secs: Option<f64>,
    ) -> Result<ShellOutput, ApiError> {
        self.recorded(SHELL_SHELL, |state, rec| {
            let timeout =
                Duration::from_secs_f64(clamp_timeout(timeout_secs, state.remaining_budget())?);
            let mut outcome =
                state.call_raw(rec, SHELL_SHELL, |api| api.shell(command, timeout))?;
            let data = outcome.data.take();
            match data {
                // The process ran. Whatever it exited with, that is a completed call, and the
                // program is handed the facts to branch on rather than an exception to catch.
                Some(ApiData::Shell(shell)) => Ok(ShellOutput {
                    exit_code: shell.exit_code,
                    output: shell.body,
                    truncated: shell.truncated,
                }),
                // No `shell` sidecar means no process ran: it could not be launched, or the timeout
                // killed it. That is a genuine failure of the call, and it throws.
                other => Err(if outcome.ok {
                    state.missing_data(SHELL_SHELL, other.as_ref())
                } else {
                    state.api_error(SHELL_SHELL, &outcome)
                }),
            }
        })
    }
}

impl<A: OperationApi> FilesHost for MembraneState<A> {
    fn read_file(
        &mut self,
        path: String,
        offset: Option<u32>,
        limit: Option<u32>,
    ) -> Result<FileRead, ApiError> {
        self.recorded(FILES_READ_FILE, |state, rec| {
            let (offset, limit) = read_window(offset, limit);
            let outcome = state.call(rec, FILES_READ_FILE, |api| {
                api.read_file(path, offset, limit)
            })?;
            file_read(state, FILES_READ_FILE, outcome.data)
        })
    }

    fn write_file(&mut self, path: String, contents: String) -> Result<u64, ApiError> {
        self.recorded(FILES_WRITE_FILE, |state, rec| {
            let outcome =
                state.call(rec, FILES_WRITE_FILE, |api| api.write_file(path, contents))?;
            match outcome.data {
                Some(ApiData::BytesWritten(bytes)) => Ok(bytes),
                other => Err(state.missing_data(FILES_WRITE_FILE, other.as_ref())),
            }
        })
    }

    fn edit_file(
        &mut self,
        path: String,
        old_string: String,
        new_string: String,
    ) -> Result<(), ApiError> {
        // A successful edit has nothing structured to say, which is why it declares
        // `result<_, api-error>`: reaching here at all means the replacement landed.
        self.recorded(FILES_EDIT_FILE, |state, rec| {
            state.call(rec, FILES_EDIT_FILE, |api| {
                api.edit_file(path, old_string, new_string)
            })?;
            Ok(())
        })
    }

    fn list_dir(&mut self, path: Option<String>) -> Result<Vec<DirEntry>, ApiError> {
        self.recorded(FILES_LIST_DIR, |state, rec| {
            let outcome = state.call(rec, FILES_LIST_DIR, |api| api.list_dir(path))?;
            match outcome.data {
                Some(ApiData::DirEntries(entries)) => Ok(entries.into_iter().map(entry).collect()),
                other => Err(state.missing_data(FILES_LIST_DIR, other.as_ref())),
            }
        })
    }

    /// Render the tree beneath a directory under the ignore files — `files.tree`. The tool decides
    /// the root, the depth bound and the size bounds; this lifts the rendering it produced.
    fn tree(&mut self, path: Option<String>, depth: Option<u32>) -> Result<String, ApiError> {
        self.recorded(FILES_TREE, |state, rec| {
            let outcome = state.call(rec, FILES_TREE, |api| api.tree(path, depth))?;
            match outcome.data {
                Some(ApiData::TreeText(text)) => Ok(text),
                other => Err(state.missing_data(FILES_TREE, other.as_ref())),
            }
        })
    }

    /// Search the workspace under the ignore files — `files.search`. The tool decides everything
    /// about the query, the root and the bounds; this lowers the matches it found.
    fn search(
        &mut self,
        query: String,
        path: Option<String>,
        limit: Option<u32>,
    ) -> Result<Vec<SearchMatch>, ApiError> {
        self.recorded(FILES_SEARCH, |state, rec| {
            let outcome = state.call(rec, FILES_SEARCH, |api| api.search(query, path, limit))?;
            match outcome.data {
                Some(ApiData::SearchMatches(matches)) => {
                    Ok(matches.into_iter().map(search_match).collect())
                }
                other => Err(state.missing_data(FILES_SEARCH, other.as_ref())),
            }
        })
    }
}

/// The `offset`/`limit` a read is actually made with, normalised from what the membrane declares
/// into what gg's `read_file` accepts.
///
/// Shared with [`views`](super::views), whose `open-file-view` is the same read under a different
/// name: the two must normalise identically or a paged view would cover different lines from the
/// paged read the model wrote beside it.
pub(super) fn read_window(
    offset: Option<u32>,
    limit: Option<u32>,
) -> (Option<usize>, Option<usize>) {
    // `offset` is 1-based on the far side of this call and unconstrained on the near side, so
    // the one value the two disagree about is normalised rather than argued over.
    (
        offset.map(|offset| offset.max(FIRST_LINE_OFFSET) as usize),
        limit.map(|limit| limit as usize),
    )
}

/// What a read returned, as the membrane's `file-read` variant — or the defect diagnostic if the
/// tool answered `ok` with no [structured sidecar](ApiData).
///
/// Shared by `read-file` and [`open-file-view`](super::views), which differ in what gg does with
/// the result and not at all in what the program is handed back — so `id` is the caller's own
/// [operation](OperationId), and a defect diagnostic names the call the model wrote rather than
/// the other one.
pub(super) fn file_read<A: OperationApi>(
    state: &mut MembraneState<A>,
    id: OperationId,
    data: Option<ApiData>,
) -> Result<FileRead, ApiError> {
    match data {
        // The text is MOVED out of the outcome rather than cloned: a 256 KiB read is the
        // largest thing that crosses this membrane, and it crosses once.
        Some(ApiData::FileText(text)) => Ok(FileRead::Text(TextRead {
            contents: text.contents,
            first_line: text.first_line,
            last_line: text.last_line,
            total_lines: text.total_lines,
            byte_truncated: text.byte_truncated,
        })),
        // A picture's bytes never enter the program: they were moved onto the turn's attachments
        // (a bare read) or into the file view's own context item (`open-file-view`), so the model
        // *looks* at the picture, and what comes back here is the description — including whether
        // it is in fact being shown.
        Some(ApiData::FileImage(image)) => Ok(FileRead::Image(ImageRead {
            media_type: image.media_type,
            label: image.label,
            bytes: image.bytes,
            shown: image.shown,
            not_shown_reason: image.not_shown_reason,
        })),
        other => Err(state.missing_data(id, other.as_ref())),
    }
}

/// One directory entry, as the membrane declares it — carrying the kind a program filters on rather
/// than the trailing `/` the prose renders.
fn entry(entry: DirEntryData) -> DirEntry {
    DirEntry {
        name: entry.name,
        kind: match entry.kind {
            DirEntryKind::File => EntryKind::File,
            DirEntryKind::Directory => EntryKind::Directory,
            DirEntryKind::Other => EntryKind::Other,
        },
    }
}

/// One search match, as the membrane declares it.
fn search_match(found: SearchMatchData) -> SearchMatch {
    let SearchMatchData { path, line, text } = found;
    SearchMatch { path, line, text }
}

/// The `timeout_secs` a `shell` call is actually made with: what the program asked for (or gg's
/// default), bounded at both ends.
///
/// **From above** by [`MAX_TIMEOUT_SECS`], because a `Duration` cannot hold every `f64` and the
/// tool would panic building one — the clamp is what keeps a nonsense number from becoming a host
/// crash. **From below**, and then again by the run's remaining wall-clock budget, because a host
/// function cannot trap: once a call is in flight nothing can cut it short, so a run with a
/// deadline must never *start* a command that would still be running when the budget is gone. A run
/// with no deadline has nothing to clamp against, which is exactly why the absolute ceiling has to
/// exist independently of it.
///
/// An **absent** request takes [`DEFAULT_TIMEOUT_SECS`], which is the documented default. A request
/// that is present and is not a positive, finite number of seconds is an **argument error**: it
/// names no duration, and running the command under gg's default instead would be gg choosing a
/// ceiling the program did not write and then reporting the result as though it had. That is the
/// same answer the native `shell` tool's own argument parsing gives, so a model gets one story about
/// its timeout whichever surface it called through. The guest SDK rejects these first; this is the
/// backstop for a guest that did not, for the same reason the ceiling above is enforced here rather
/// than trusted to the guest.
fn clamp_timeout(requested: Option<f64>, remaining: Option<Duration>) -> Result<f64, ApiError> {
    let requested = match requested {
        None => DEFAULT_TIMEOUT_SECS,
        Some(secs) if secs.is_finite() && secs > 0.0 => secs,
        Some(secs) => {
            return Err(ApiError {
                code: ErrorCode::InvalidArgument,
                operation: SHELL_SHELL.key.to_string(),
                message: format!(
                    "`timeout_secs` must be a positive number of seconds (`{secs}` given); \
                     omit it for the default of {DEFAULT_TIMEOUT_SECS}s."
                ),
            });
        }
    };
    let requested = requested.min(MAX_TIMEOUT_SECS);
    Ok(match remaining {
        Some(remaining) => requested.min(remaining.as_secs_f64()),
        None => requested,
    })
}

#[cfg(test)]
#[path = "workspace.test.rs"]
mod tests;
