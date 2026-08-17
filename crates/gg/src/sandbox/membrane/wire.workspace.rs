//! The [wire](super)'s workspace half: `shell`, the five file operations and the one skill
//! read.
//!
//! Every function here is the same three steps — read the arguments out of the decoded request, call
//! the typed host function, write what came back as a [`Value`] — and nothing else. There is no
//! normalisation, no defaulting and no clamping in this file: `shell`'s timeout clamp, `read_file`'s
//! 1-based offset and the picture-versus-text narrowing all happen inside the host functions this
//! calls, which is the whole point of calling them.

use super::super::test_cabinet::gg::files::{
    DirEntry, EntryKind, FileRead, Host as FilesHost, ImageRead, TextRead,
};
use super::super::test_cabinet::gg::helpers::Host as HelpersHost;
use super::super::test_cabinet::gg::shell::{Host as ShellHost, ShellOutput};
use super::super::{MembraneState, ToolApi};
use super::wire_coding::{Value, argument, integer, optional, record, text, wide};
use super::{Answer, Failure};

/// `shell.shell` — run a command.
pub(super) fn shell<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let command = argument(arguments, op, 0)?.text("the command")?;
    let timeout = argument(arguments, op, 1)?.optional_number("the timeout")?;
    Ok(shell_output(ShellHost::shell(state, command, timeout)?))
}

/// `files.read_file` — read a file as the variant the read returned.
pub(super) fn read_file<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let path = argument(arguments, op, 0)?.text("the path")?;
    let (offset, limit) = window(op, arguments)?;
    Ok(file_read(FilesHost::read_file(state, path, offset, limit)?))
}

/// `files.read_text_file` — read a text file's contents directly.
pub(super) fn read_text_file<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let path = argument(arguments, op, 0)?.text("the path")?;
    let (offset, limit) = window(op, arguments)?;
    Ok(text(HelpersHost::read_text_file(
        state, path, offset, limit,
    )?))
}

/// `files.write_file` — write a file whole.
pub(super) fn write_file<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let path = argument(arguments, op, 0)?.text("the path")?;
    let contents = argument(arguments, op, 1)?.text("the contents")?;
    Ok(wide(FilesHost::write_file(state, path, contents)?))
}

/// `files.edit_file` — replace one string in a file.
pub(super) fn edit_file<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let path = argument(arguments, op, 0)?.text("the path")?;
    let old = argument(arguments, op, 1)?.text("the text to replace")?;
    let new = argument(arguments, op, 2)?.text("the replacement")?;
    FilesHost::edit_file(state, path, old, new)?;
    Ok(Value::None)
}

/// `files.list_dir` — list a directory.
pub(super) fn list_dir<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let path = argument(arguments, op, 0)?.optional_text("the path")?;
    Ok(Value::List(
        FilesHost::list_dir(state, path)?
            .into_iter()
            .map(dir_entry)
            .collect(),
    ))
}

/// `skills.read_skill` — read an authored skill.
pub(super) fn read_skill<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let name = argument(arguments, op, 0)?.text("the skill's name")?;
    Ok(text(
        super::super::test_cabinet::gg::skills::Host::read_skill(state, name)?,
    ))
}

/// The `offset`/`limit` window three reads share, at arguments 1 and 2.
fn window(op: &str, arguments: &[Value]) -> Result<(Option<u32>, Option<u32>), Failure> {
    Ok((
        argument(arguments, op, 1)?.optional_integer("the offset")?,
        argument(arguments, op, 2)?.optional_integer("the limit")?,
    ))
}

/// A completed process, as the `shell-output` record.
fn shell_output(output: ShellOutput) -> Value {
    record([
        ("exit-code", optional(output.exit_code, integer)),
        ("output", text(output.output)),
        ("truncated", Value::Bool(output.truncated)),
    ])
}

/// What a read returned, as the `file-read` variant.
///
/// Shared with [`context`](super::context), whose `views.open_file` returns the same variant.
pub(super) fn file_read(read: FileRead) -> Value {
    match read {
        FileRead::Text(read) => variant("text", text_read(read)),
        FileRead::Image(read) => variant("image", image_read(read)),
    }
}

/// The `text-read` record.
fn text_read(read: TextRead) -> Value {
    record([
        ("contents", text(read.contents)),
        ("first-line", integer(read.first_line)),
        ("last-line", integer(read.last_line)),
        ("total-lines", integer(read.total_lines)),
        ("byte-truncated", Value::Bool(read.byte_truncated)),
    ])
}

/// The `image-read` record.
fn image_read(read: ImageRead) -> Value {
    record([
        ("media-type", text(read.media_type)),
        ("label", text(read.label)),
        ("bytes", wide(read.bytes)),
        ("shown", Value::Bool(read.shown)),
        ("not-shown-reason", optional(read.not_shown_reason, text)),
    ])
}

/// One `dir-entry`.
fn dir_entry(entry: DirEntry) -> Value {
    record([
        ("name", text(entry.name)),
        (
            "kind",
            text(match entry.kind {
                EntryKind::File => "file",
                EntryKind::Directory => "directory",
                EntryKind::Other => "other",
            }),
        ),
    ])
}

/// A variant case carrying a payload — see [`wire_coding`](super::wire_coding) for the shape.
pub(super) fn variant(case: &str, value: Value) -> Value {
    record([
        (super::wire_coding::VARIANT_CASE, text(case)),
        (super::wire_coding::VARIANT_VALUE, value),
    ])
}
