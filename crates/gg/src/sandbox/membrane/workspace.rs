//! The workspace half of the membrane: `shell` and the four file tools.
//!
//! These five are what almost every program touches, and two of them carry rules worth stating
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
    DirEntry, EntryKind, FileRead, Host as FilesHost, ImageRead, TextRead,
};
use super::test_cabinet::gg::shell::{Host as ShellHost, ShellOutput};
use super::test_cabinet::gg::types::ToolError;
use super::{MembraneState, ToolApi};
use crate::tools::{DirEntryData, DirEntryKind, READ_FILE_TOOL, ToolData};

/// The `shell` tool name.
const SHELL_TOOL: &str = "shell";
/// The `write_file` tool name.
const WRITE_FILE_TOOL: &str = "write_file";
/// The `edit_file` tool name.
const EDIT_FILE_TOOL: &str = "edit_file";
/// The `list_dir` tool name.
const LIST_DIR_TOOL: &str = "list_dir";

/// gg's own default `shell` timeout, restated here because the membrane must clamp a value *before*
/// the tool sees it — and a call that arrived at the tool with no timeout at all would be clamped
/// by nothing.
const DEFAULT_TIMEOUT_SECS: f64 = 120.0;

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

impl<A: ToolApi> ShellHost for MembraneState<A> {
    fn shell(
        &mut self,
        command: String,
        timeout_secs: Option<f64>,
    ) -> Result<ShellOutput, ToolError> {
        let timeout = Duration::from_secs_f64(clamp_timeout(timeout_secs, self.remaining_budget()));
        let mut outcome = self.call_raw(SHELL_TOOL, |api| api.shell(command, timeout))?;
        let data = outcome.data.take();
        match data {
            // The process ran. Whatever it exited with, that is a completed call, and the program
            // is handed the facts to branch on rather than an exception to catch.
            Some(ToolData::Shell(shell)) => Ok(ShellOutput {
                exit_code: shell.exit_code,
                output: shell.body,
                truncated: shell.truncated,
            }),
            // No `shell` sidecar means no process ran: it could not be launched, or the timeout
            // killed it. That is a genuine failure of the call, and it throws.
            other => Err(if outcome.ok {
                self.missing_data(SHELL_TOOL, other.as_ref())
            } else {
                self.tool_error(SHELL_TOOL, &outcome)
            }),
        }
    }
}

impl<A: ToolApi> FilesHost for MembraneState<A> {
    fn read_file(
        &mut self,
        path: String,
        offset: Option<u32>,
        limit: Option<u32>,
    ) -> Result<FileRead, ToolError> {
        let (offset, limit) = read_window(offset, limit);
        let outcome = self.call(READ_FILE_TOOL, |api| api.read_file(path, offset, limit))?;
        file_read(self, outcome.data)
    }

    fn write_file(&mut self, path: String, contents: String) -> Result<u64, ToolError> {
        let outcome = self.call(WRITE_FILE_TOOL, |api| api.write_file(path, contents))?;
        match outcome.data {
            Some(ToolData::BytesWritten(bytes)) => Ok(bytes),
            other => Err(self.missing_data(WRITE_FILE_TOOL, other.as_ref())),
        }
    }

    fn edit_file(
        &mut self,
        path: String,
        old_string: String,
        new_string: String,
    ) -> Result<(), ToolError> {
        // A successful edit has nothing structured to say, which is why it declares
        // `result<_, tool-error>`: reaching here at all means the replacement landed.
        self.call(EDIT_FILE_TOOL, |api| {
            api.edit_file(path, old_string, new_string)
        })?;
        Ok(())
    }

    fn list_dir(&mut self, path: Option<String>) -> Result<Vec<DirEntry>, ToolError> {
        let outcome = self.call(LIST_DIR_TOOL, |api| api.list_dir(path))?;
        match outcome.data {
            Some(ToolData::DirEntries(entries)) => Ok(entries.into_iter().map(entry).collect()),
            other => Err(self.missing_data(LIST_DIR_TOOL, other.as_ref())),
        }
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
/// tool answered `ok` with no [structured sidecar](ToolData).
///
/// Shared by `read-file` and [`open-file-view`](super::views), which differ in what gg does with the
/// result and not at all in what the program is handed back.
pub(super) fn file_read<A: ToolApi>(
    state: &mut MembraneState<A>,
    data: Option<ToolData>,
) -> Result<FileRead, ToolError> {
    match data {
        // The text is MOVED out of the outcome rather than cloned: a 256 KiB read is the
        // largest thing that crosses this membrane, and it crosses once.
        Some(ToolData::FileText(text)) => Ok(FileRead::Text(TextRead {
            contents: text.contents,
            first_line: text.first_line,
            last_line: text.last_line,
            total_lines: text.total_lines,
            byte_truncated: text.byte_truncated,
            limit_reduced: text.limit_reduced,
        })),
        // A picture's bytes never enter the program: they were moved onto the turn's attachments
        // (a bare read) or into the file view's own context item (`open-file-view`), so the model
        // *looks* at the picture, and what comes back here is the description — including whether
        // it is in fact being shown.
        Some(ToolData::FileImage(image)) => Ok(FileRead::Image(ImageRead {
            media_type: image.media_type,
            label: image.label,
            bytes: image.bytes,
            shown: image.shown,
            not_shown_reason: image.not_shown_reason,
        })),
        other => Err(state.missing_data(READ_FILE_TOOL, other.as_ref())),
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
/// A non-finite or non-positive request falls back to the default. The guest SDK already rejects
/// those, so this is the backstop for a guest that did not — which is the same reason the ceiling
/// is enforced here rather than trusted to the guest.
fn clamp_timeout(requested: Option<f64>, remaining: Option<Duration>) -> f64 {
    let requested = requested
        .filter(|secs| secs.is_finite() && *secs > 0.0)
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .min(MAX_TIMEOUT_SECS);
    match remaining {
        Some(remaining) => requested.min(remaining.as_secs_f64()),
        None => requested,
    }
}

#[cfg(test)]
#[path = "workspace.test.rs"]
mod tests;
