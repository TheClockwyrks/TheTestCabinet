//! The filesystem tools: read, write, edit, and list files in the workspace.
//!
//! gg runs inside the run container, so these tools operate on the **local**
//! filesystem. Every path a tool accepts is workspace-*relative* and is resolved,
//! and confined, to the invocation's workspace root by [`resolve_within`]: an
//! absolute path or a `..` sequence that would climb above the root is rejected
//! before any I/O happens. This confinement is a real safety property (a run must not
//! read or clobber files outside its seeded workspace), enforced purely lexically so
//! it is deterministic and unit-testable.
//!
//! The four tools mirror the editor primitives a coding agent needs, including
//! `edit_file`'s **exact unique replacement** semantics (matching this repo's own
//! `Edit`: the `old_string` must occur exactly once). Each is contributed by its **own**
//! capability — [`read-file`](test_cabinet_core::gg::CAPABILITY_READ_FILE),
//! [`write-file`](test_cabinet_core::gg::CAPABILITY_WRITE_FILE),
//! [`edit-file`](test_cabinet_core::gg::CAPABILITY_EDIT_FILE), and
//! [`list-dir`](test_cabinet_core::gg::CAPABILITY_LIST_DIR) — so a study can vary one
//! filesystem primitive without touching the others.
//!
//! # Read modes
//!
//! How much of a file one `read_file` call may return is the first of those per-tool
//! variables, selected by the read-file capability's *implementation* (see [`ReadPolicy`]):
//! [unlimited](ReadPolicy::Unlimited) (the whole file, one call), a
//! [hard cap](ReadPolicy::HardCap) (never more than N lines, whatever the model asks for),
//! or a [default cap](ReadPolicy::DefaultCap) (N lines unless the model explicitly asks for
//! more). The capped modes take `offset`/`limit` so the agent can page through a file; the
//! unlimited mode offers neither, because there is nothing to page.
//!
//! # Reading images
//!
//! A test case's specs ship **reference mockups**, so `read_file` on a `.png` has to do
//! something better than hand the model a screenful of mojibake — which is exactly what
//! decoding image bytes as lossy UTF-8 produces. An image read is therefore detected by
//! its content ([`sniff_image`], magic bytes rather than the extension) and answered with
//! the picture itself, attached to the tool result for the model to look at.
//!
//! Whether it *can* be attached depends on the model, not the file: a text-only model
//! answers an image-bearing request with a hard error. The decision is delegated to the
//! run's [vision registry](crate::vision::VisionSupport) via
//! [`ToolContext::vision`] — a model the catalog declared without image input (or that a
//! provider has already refused an image for) gets a description of the file instead, and
//! the run carries on. See [`crate::vision`] for the two-stage rule.

use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde_json::{Value, json};

use super::{Tool, ToolContext, ToolOutcome, required_str};
use crate::model::{ImageContent, ToolDefinition};

/// The `read_file` tool name — also what the [system prompt](crate::prompts) checks for when it
/// decides whether to state this run's [line cap](ReadPolicy).
pub const READ_FILE_TOOL: &str = "read_file";

/// Ceiling on the bytes `read_file` returns to the model, so a huge file cannot flood
/// context. Applied **after** any [line window](ReadPolicy), as the last-resort backstop
/// against a file with enormous lines; the returned text carries a truncation note.
const READ_FILE_CAP: usize = 256 * 1024;

/// Ceiling on the **decoded** size of an image `read_file` will attach, in bytes.
///
/// An inline image is base64'd into the request body (≈4/3 its size) and charged to the
/// context window at a rate no estimator can pin down, so an unbounded one is the single
/// easiest way for a run to blow its window on one call. 8 MiB clears every reference
/// mockup a test case ships by a wide margin while still refusing, say, a captured video
/// frame dump. A larger image is described rather than attached — the read still
/// succeeds.
const IMAGE_ATTACH_CAP: u64 = 8 * 1024 * 1024;

/// The read-file capability's `lineCap` param: how many lines a
/// [capped](ReadPolicy::HardCap) read returns, and the default a
/// [default-capped](ReadPolicy::DefaultCap) read returns.
pub const PARAM_LINE_CAP: &str = "lineCap";

/// The [implementation](test_cabinet_core::gg::GgCapabilityConfig::implementation) id
/// selecting the unlimited read mode — a call returns the whole file. The default, so a
/// capability set that says nothing about read modes behaves as gg always has.
pub const READ_MODE_UNLIMITED: &str = "unlimited";

/// The implementation id selecting the hard-capped read mode: a call returns at most
/// [`lineCap`](PARAM_LINE_CAP) lines and the agent cannot ask for more.
pub const READ_MODE_HARD_CAP: &str = "hard-cap";

/// The implementation id selecting the default-capped read mode: a call returns
/// [`lineCap`](PARAM_LINE_CAP) lines unless the agent explicitly asks for more, which is
/// honored.
pub const READ_MODE_DEFAULT_CAP: &str = "default-cap";

/// The line cap the capped read modes use when their capability declares no
/// [`lineCap`](PARAM_LINE_CAP) (or declares a nonsensical one).
pub const DEFAULT_READ_LINE_CAP: usize = 250;

// ---------------------------------------------------------------------------
// Read policy
// ---------------------------------------------------------------------------

/// How much of a file one `read_file` call may return — the read-file capability's
/// swappable implementation, and the whole point of splitting `read_file` into its own
/// capability.
///
/// Capping reads is one of the load-bearing differences between real coding harnesses, and
/// which way it cuts is an open question: a cap keeps a single call from flooding the
/// window (and forces the agent to be deliberate about what it looks at), but it also costs
/// a round trip per page and gives the agent a chance to lose the thread of a file it only
/// ever half-sees. These three modes are the arms of that experiment.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ReadPolicy {
    /// Return the whole file in one call, with no `offset`/`limit` arguments — gg's
    /// original behavior, and the control arm. The default, so an unconfigured
    /// read-file capability reads exactly as gg always has.
    #[default]
    Unlimited,
    /// Return at most this many lines per call. A `limit` above the cap is **reduced** to
    /// it, and the agent is told so, so the ceiling is not something it can argue its way
    /// past — it must page with `offset`.
    HardCap(usize),
    /// Return this many lines per call *by default*, honoring any larger `limit` the agent
    /// explicitly asks for. The cap becomes a nudge rather than a ceiling.
    DefaultCap(usize),
}

impl ReadPolicy {
    /// Resolve the policy from the read-file capability's `implementation` and `params`.
    ///
    /// An absent or unrecognized implementation resolves to [`Unlimited`](Self::Unlimited),
    /// the historical behavior: a run configured with a typo'd mode reads files exactly as
    /// an unconfigured one does rather than silently enforcing a cap nobody asked for. A
    /// missing, non-numeric, or zero [`lineCap`](PARAM_LINE_CAP) falls back to
    /// [`DEFAULT_READ_LINE_CAP`], since a zero-line cap would make every read return
    /// nothing.
    pub fn resolve(implementation: Option<&str>, params: &Value) -> Self {
        let cap = params
            .get(PARAM_LINE_CAP)
            .and_then(Value::as_u64)
            .filter(|&n| n > 0)
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_READ_LINE_CAP);
        match implementation.map(str::trim) {
            Some(READ_MODE_HARD_CAP) => Self::HardCap(cap),
            Some(READ_MODE_DEFAULT_CAP) => Self::DefaultCap(cap),
            Some(READ_MODE_UNLIMITED) | None => Self::Unlimited,
            // An unrecognized mode is a misconfiguration, not an instruction: fall back to
            // the historical behavior rather than enforcing a cap nobody asked for.
            Some(_) => Self::Unlimited,
        }
    }

    /// The line cap in force, or `None` under [`Unlimited`](Self::Unlimited). Read by the tool
    /// itself (to window a read) and by the [system prompt](crate::prompts), which states the cap
    /// up front so the model is not left to discover it one truncated read at a time.
    pub fn line_cap(&self) -> Option<usize> {
        match *self {
            Self::Unlimited => None,
            Self::HardCap(cap) | Self::DefaultCap(cap) => Some(cap),
        }
    }

    /// How many lines a call asking for `requested` lines actually gets, and whether that
    /// request was cut down to the cap. `None` for `requested` means the agent named no
    /// `limit`, so the mode's default applies.
    fn window(&self, requested: Option<usize>) -> (Option<usize>, bool) {
        match (*self, requested) {
            (Self::Unlimited, _) => (None, false),
            (Self::HardCap(cap), Some(want)) => (Some(want.min(cap)), want > cap),
            (Self::HardCap(cap), None) | (Self::DefaultCap(cap), None) => (Some(cap), false),
            // The default cap is exactly the one the agent can talk its way past.
            (Self::DefaultCap(_), Some(want)) => (Some(want), false),
        }
    }
}

// ---------------------------------------------------------------------------
// Path confinement
// ---------------------------------------------------------------------------

/// Resolve a workspace-relative `rel` path against the workspace `root`, refusing any
/// path that would escape the root.
///
/// The check is **lexical**: `rel` must be relative (an absolute path or one with a
/// drive/root prefix is rejected), and its normalized form must never pop above the
/// root (a leading or interior `..` that climbs past the root is rejected). `.` and
/// interior `..` that stay within the tree are normalized away. The returned path is
/// `root` joined with the normalized remainder.
///
/// Confinement is lexical by design: it makes no filesystem call, so it is
/// deterministic and testable and cannot be defeated by a race. (It does not resolve
/// symlinks; the seeded workspace is trusted not to contain adversarial links out of
/// the tree in Phase 0.)
pub fn resolve_within(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.trim().is_empty() {
        return Err("path must not be empty".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(rel).components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!(
                    "path `{rel}` must be workspace-relative, not absolute"
                ));
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("path `{rel}` escapes the workspace root via `..`"));
                }
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    Ok(root.join(normalized))
}

/// Resolve `field` from `args` as a required workspace-relative path, mapping both a
/// missing/ill-typed argument and an escape attempt to a tool error string.
fn resolve_arg(args: &Value, field: &str, tool: &str, root: &Path) -> Result<PathBuf, String> {
    let rel = required_str(args, field, tool)?;
    resolve_within(root, &rel).map_err(|why| format!("`{tool}`: {why}"))
}

/// Read `field` from `args` as an **optional** positive integer (the `offset`/`limit`
/// paging arguments). Absent or `null` is `None` — the caller's default applies — while a
/// present value that is not a positive integer is an error rather than a silent default,
/// so a model passing `0` or `"10"` is told instead of quietly getting something else.
fn positive_arg(args: &Value, field: &str, tool: &str) -> Result<Option<usize>, String> {
    match args.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|&n| n > 0)
            .map(|n| Some(n as usize))
            .ok_or_else(|| format!("`{tool}`: argument `{field}` must be a positive integer")),
    }
}

/// The largest index `<= max` that is a char boundary of `text`, so a byte-ceiling
/// truncation cannot split a multi-byte character (which would panic).
fn floor_char_boundary(text: &str, max: usize) -> usize {
    if max >= text.len() {
        return text.len();
    }
    let mut index = max;
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

// ---------------------------------------------------------------------------
// Image detection
// ---------------------------------------------------------------------------

/// An image format `read_file` recognizes, and the media type it is sent under.
///
/// Deliberately small: these are the formats a provider behind OpenRouter actually
/// accepts inline. A picture in some other format is not an image as far as this tool is
/// concerned — it reads as the binary file it is, which is the honest answer rather than
/// a request the provider will reject.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageFormat {
    /// The IANA media type sent with the image.
    pub media_type: &'static str,
    /// A short human name for the tool result's prose (`PNG`, `JPEG`, …).
    pub label: &'static str,
}

/// Identify `bytes` as an image by its **magic number**, not its extension.
///
/// Content-sniffing is the right test here: the tool has already read the file, an
/// extension is a claim rather than a fact, and a reference mockup saved as `.txt` is
/// still a picture (while a `.png` that is really text should be read as text). Returns
/// `None` for anything not recognized, which reads as an ordinary file.
pub fn sniff_image(bytes: &[u8]) -> Option<ImageFormat> {
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";
    const GIF87: &[u8] = b"GIF87a";
    const GIF89: &[u8] = b"GIF89a";

    if bytes.starts_with(PNG) {
        return Some(ImageFormat {
            media_type: "image/png",
            label: "PNG",
        });
    }
    // JPEG: SOI marker. The rest of the header varies by encoder, so the two-byte
    // start plus a third marker byte is the reliable test.
    if bytes.len() >= 3 && bytes.starts_with(&[0xFF, 0xD8]) && bytes[2] == 0xFF {
        return Some(ImageFormat {
            media_type: "image/jpeg",
            label: "JPEG",
        });
    }
    if bytes.starts_with(GIF87) || bytes.starts_with(GIF89) {
        return Some(ImageFormat {
            media_type: "image/gif",
            label: "GIF",
        });
    }
    // WebP is a RIFF container whose form type is `WEBP` at offset 8.
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some(ImageFormat {
            media_type: "image/webp",
            label: "WebP",
        });
    }
    None
}

/// A human-readable byte size for the tool result's prose (`412 KB`, `1.2 MB`).
fn human_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{} KB", bytes.div_ceil(KB))
    } else {
        format!("{bytes} bytes")
    }
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

/// Reads a file's contents, workspace-relative, within the run's [`ReadPolicy`].
pub struct ReadFileTool {
    /// How much of a file one call may return.
    policy: ReadPolicy,
}

impl ReadFileTool {
    /// A `read_file` tool enforcing `policy`.
    pub fn new(policy: ReadPolicy) -> Self {
        Self { policy }
    }

    /// Answer a read of a recognized image.
    ///
    /// Three outcomes, all of them *successful* reads — a picture is never an error:
    ///
    /// - the model can see images and this one is within [`IMAGE_ATTACH_CAP`]: the image
    ///   is attached to the tool result, with a line of prose naming it so the model
    ///   knows what it is looking at and can refer to it later;
    /// - the model cannot see images: the file is described (format and size) and the
    ///   model is told plainly that it cannot view it, so it stops trying to and works
    ///   from the written spec instead of silently assuming it saw the mockup;
    /// - the image is too large to attach: likewise described, with the reason.
    ///
    /// The bytes are **never** decoded as text. Lossy-UTF-8 image data is thousands of
    /// tokens of noise that tells the model nothing and crowds out everything that would.
    fn read_image(
        rel_path: &str,
        format: ImageFormat,
        bytes: &[u8],
        ctx: &ToolContext,
    ) -> ToolOutcome {
        let size = bytes.len() as u64;
        let label = format.label;
        let human = human_bytes(size);

        if !ctx.vision.allows_images() {
            // Word it by *why*: a catalog-declared text-only model is a permanent fact
            // about this run, while a runtime denial followed a provider refusal. Either
            // way the instruction to the model is the same — do not keep trying.
            let why = if ctx.vision.declared_text_only() {
                "the model running this session does not accept image input"
            } else {
                "the provider refused image input for the model running this session"
            };
            return ToolOutcome::ok(
                format!(
                    "`{rel_path}` is a {label} image ({human}). It cannot be shown to you: \
                     {why}. Reading it again will not help — work from the written \
                     specification, and treat any file named as a reference image the same way."
                ),
                format!("{label} image, {human} (not shown: no image input)"),
            );
        }

        if size > IMAGE_ATTACH_CAP {
            return ToolOutcome::ok(
                format!(
                    "`{rel_path}` is a {label} image ({human}). It is too large to display \
                     (the limit is {}); work from the written specification instead.",
                    human_bytes(IMAGE_ATTACH_CAP)
                ),
                format!("{label} image, {human} (too large to show)"),
            );
        }

        ToolOutcome::ok(
            format!("`{rel_path}` — {label} image, {human}. The image follows."),
            format!("{label} image, {human}"),
        )
        .with_images(vec![ImageContent::new(
            format.media_type,
            BASE64.encode(bytes),
            size,
        )])
    }

    /// The whole-file read: gg's original behavior, offered under
    /// [`Unlimited`](ReadPolicy::Unlimited).
    fn read_whole(bytes: &[u8]) -> ToolOutcome {
        let total = bytes.len();
        let truncated = total > READ_FILE_CAP;
        let slice = if truncated {
            &bytes[..READ_FILE_CAP]
        } else {
            bytes
        };
        let mut contents = String::from_utf8_lossy(slice).into_owned();
        if truncated {
            contents.push_str(&format!(
                "\n\n[truncated: showing {READ_FILE_CAP} of {total} bytes]"
            ));
        }
        ToolOutcome::ok(contents, format!("read {total} bytes"))
    }

    /// The windowed read the capped modes offer: `window` lines starting at the 1-based
    /// `offset`, with a footer telling the agent what it is looking at and how to get the
    /// rest.
    ///
    /// A window that happens to cover the whole file produces **no** footer, so a file
    /// shorter than the cap reads identically under all three modes and only files big
    /// enough to actually be capped differ between arms.
    fn read_window(bytes: &[u8], offset: usize, window: usize, reduced: bool) -> ToolOutcome {
        let text = String::from_utf8_lossy(bytes);
        let lines: Vec<&str> = text.split_inclusive('\n').collect();
        let total = lines.len();

        let start = offset.saturating_sub(1);
        if start >= total && total > 0 {
            return ToolOutcome::error(format!(
                "read_file: `offset` {offset} is past the end of the file ({total} lines)"
            ));
        }
        let end = start.saturating_add(window).min(total);

        let mut contents: String = lines[start..end].concat();
        let bytes_returned = contents.len();
        if bytes_returned > READ_FILE_CAP {
            contents.truncate(floor_char_boundary(&contents, READ_FILE_CAP));
            contents.push_str(&format!(
                "\n\n[truncated: showing {READ_FILE_CAP} of {bytes_returned} bytes]"
            ));
        }

        let windowed = start > 0 || end < total;
        if !windowed {
            return ToolOutcome::ok(contents, format!("read {bytes_returned} bytes"));
        }

        let mut note = format!("showing lines {}-{end} of {total}", start + 1);
        if reduced {
            note.push_str(&format!(
                "; `limit` was reduced to this run's {window}-line cap"
            ));
        }
        if end < total {
            note.push_str(&format!("; continue with offset: {}", end + 1));
        }
        contents.push_str(&format!("\n\n[{note}]"));

        ToolOutcome::ok(
            contents,
            format!(
                "read lines {}-{end} of {total} ({bytes_returned} bytes)",
                start + 1
            ),
        )
    }
}

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        READ_FILE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        let path = json!({
            "type": "string",
            "description": "Workspace-relative path to the file to read."
        });
        // The unlimited mode offers no paging arguments at all: with the whole file in
        // every result there is nothing for the agent to page through, and offering knobs
        // that never bind would misrepresent the arm.
        let Some(cap) = self.policy.line_cap() else {
            return ToolDefinition::new(
                "read_file",
                "Read a file from the workspace and return its contents (truncated if very \
                 large). Text files are returned as text; a PNG, JPEG, GIF, or WebP image \
                 is returned as the image itself when the session's model can see one, and \
                 otherwise described.",
                json!({
                    "type": "object",
                    "properties": { "path": path },
                    "required": ["path"],
                    "additionalProperties": false
                }),
            );
        };

        let (description, limit_description) = match self.policy {
            ReadPolicy::HardCap(cap) => (
                format!(
                    "Read a file from the workspace. A text file returns at most {cap} \
                     lines per call, so read a long one a window at a time by passing \
                     `offset`; the result tells you how many lines the file has and where \
                     to continue from. A PNG, JPEG, GIF, or WebP image is returned whole, \
                     as the image itself, when the session's model can see one — \
                     `offset`/`limit` do not apply to it."
                ),
                format!(
                    "How many lines to return (default and maximum {cap}; a larger value \
                     is reduced to {cap})."
                ),
            ),
            _ => (
                format!(
                    "Read a file from the workspace. A text file returns {cap} lines by \
                     default, starting at `offset`; pass a larger `limit` when you need \
                     more of the file at once. The result tells you how many lines the file \
                     has and where to continue from. A PNG, JPEG, GIF, or WebP image is \
                     returned whole, as the image itself, when the session's model can see \
                     one — `offset`/`limit` do not apply to it."
                ),
                format!("How many lines to return (default {cap}; larger is allowed)."),
            ),
        };

        ToolDefinition::new(
            "read_file",
            description,
            json!({
                "type": "object",
                "properties": {
                    "path": path,
                    "offset": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "1-based line number to start reading from (default 1)."
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "description": limit_description
                    }
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let rel_path = match required_str(&args, "path", "read_file") {
            Ok(rel) => rel,
            Err(message) => return ToolOutcome::error(message),
        };
        let path = match resolve_within(&ctx.workspace_dir, &rel_path) {
            Ok(path) => path,
            Err(why) => return ToolOutcome::error(format!("`read_file`: {why}")),
        };
        let offset = match positive_arg(&args, "offset", "read_file") {
            Ok(offset) => offset.unwrap_or(1),
            Err(message) => return ToolOutcome::error(message),
        };
        let limit = match positive_arg(&args, "limit", "read_file") {
            Ok(limit) => limit,
            Err(message) => return ToolOutcome::error(message),
        };

        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) => return ToolOutcome::error(format!("read_file: {err}")),
        };

        // An image is answered as an image, before any line windowing: `offset`/`limit`
        // describe lines of text and mean nothing for a picture, and decoding the bytes
        // as lossy UTF-8 would return noise.
        if let Some(format) = sniff_image(&bytes) {
            return Self::read_image(&rel_path, format, &bytes, ctx);
        }

        match self.policy.window(limit) {
            (Some(window), reduced) => Self::read_window(&bytes, offset, window, reduced),
            (None, _) => Self::read_whole(&bytes),
        }
    }
}

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

/// Writes (creating or overwriting) a file, workspace-relative.
pub struct WriteFileTool;

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "write_file",
            "Write UTF-8 text to a file in the workspace, creating parent directories \
             and overwriting any existing file.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to write."
                    },
                    "contents": {
                        "type": "string",
                        "description": "The file's full contents."
                    }
                },
                "required": ["path", "contents"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let path = match resolve_arg(&args, "path", "write_file", &ctx.workspace_dir) {
            Ok(path) => path,
            Err(message) => return ToolOutcome::error(message),
        };
        let contents = match required_str(&args, "contents", "write_file") {
            Ok(contents) => contents,
            Err(message) => return ToolOutcome::error(message),
        };

        if let Some(parent) = path.parent()
            && let Err(err) = std::fs::create_dir_all(parent)
        {
            return ToolOutcome::error(format!("write_file: creating parent dirs: {err}"));
        }
        if let Err(err) = std::fs::write(&path, contents.as_bytes()) {
            return ToolOutcome::error(format!("write_file: {err}"));
        }

        let bytes = contents.len();
        ToolOutcome::ok(
            format!("wrote {bytes} bytes"),
            format!("wrote {bytes} bytes"),
        )
    }
}

// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------

/// Replaces an exact, unique occurrence of a string in a file (this repo's `Edit`
/// semantics).
pub struct EditFileTool;

#[async_trait]
impl Tool for EditFileTool {
    fn name(&self) -> &str {
        "edit_file"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "edit_file",
            "Replace an exact occurrence of `old_string` with `new_string` in a \
             workspace file. `old_string` must appear exactly once; the edit fails if \
             it is missing or ambiguous.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to edit."
                    },
                    "old_string": {
                        "type": "string",
                        "description": "The exact text to replace (must be unique in the file)."
                    },
                    "new_string": {
                        "type": "string",
                        "description": "The replacement text."
                    }
                },
                "required": ["path", "old_string", "new_string"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let path = match resolve_arg(&args, "path", "edit_file", &ctx.workspace_dir) {
            Ok(path) => path,
            Err(message) => return ToolOutcome::error(message),
        };
        let old_string = match required_str(&args, "old_string", "edit_file") {
            Ok(value) => value,
            Err(message) => return ToolOutcome::error(message),
        };
        let new_string = match required_str(&args, "new_string", "edit_file") {
            Ok(value) => value,
            Err(message) => return ToolOutcome::error(message),
        };

        if old_string.is_empty() {
            return ToolOutcome::error("edit_file: `old_string` must not be empty".to_string());
        }
        if old_string == new_string {
            return ToolOutcome::error(
                "edit_file: `old_string` and `new_string` are identical; nothing to change"
                    .to_string(),
            );
        }

        let contents = match std::fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(err) => return ToolOutcome::error(format!("edit_file: {err}")),
        };

        let occurrences = contents.matches(&old_string).count();
        match occurrences {
            0 => {
                return ToolOutcome::error(
                    "edit_file: `old_string` was not found in the file".to_string(),
                );
            }
            1 => {}
            n => {
                return ToolOutcome::error(format!(
                    "edit_file: `old_string` is not unique ({n} occurrences); \
                     include more surrounding context to make it unique"
                ));
            }
        }

        let updated = contents.replacen(&old_string, &new_string, 1);
        if let Err(err) = std::fs::write(&path, updated.as_bytes()) {
            return ToolOutcome::error(format!("edit_file: writing back: {err}"));
        }

        ToolOutcome::ok("replaced 1 occurrence", "edited (1 replacement)")
    }
}

// ---------------------------------------------------------------------------
// list_dir
// ---------------------------------------------------------------------------

/// Lists a directory's entries, workspace-relative.
pub struct ListDirTool;

#[async_trait]
impl Tool for ListDirTool {
    fn name(&self) -> &str {
        "list_dir"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "list_dir",
            "List the entries of a directory in the workspace. Directories are \
             suffixed with `/`. Defaults to the workspace root.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative directory (defaults to `.`)."
                    }
                },
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        // `path` is optional here and defaults to the workspace root.
        let rel = match args.get("path") {
            None | Some(Value::Null) => ".".to_string(),
            Some(Value::String(value)) => value.clone(),
            Some(_) => {
                return ToolOutcome::error(
                    "`list_dir`: argument `path` must be a string".to_string(),
                );
            }
        };
        let dir = match resolve_within(&ctx.workspace_dir, &rel) {
            Ok(dir) => dir,
            Err(why) => return ToolOutcome::error(format!("`list_dir`: {why}")),
        };

        let read = match std::fs::read_dir(&dir) {
            Ok(read) => read,
            Err(err) => return ToolOutcome::error(format!("list_dir: {err}")),
        };

        let mut entries: Vec<String> = Vec::new();
        for entry in read {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => return ToolOutcome::error(format!("list_dir: {err}")),
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.push(if is_dir { format!("{name}/") } else { name });
        }
        entries.sort();

        let count = entries.len();
        let output = if entries.is_empty() {
            "(empty directory)".to_string()
        } else {
            entries.join("\n")
        };
        ToolOutcome::ok(output, format!("{count} entries"))
    }
}

#[cfg(test)]
#[path = "filesystem.test.rs"]
mod tests;

#[cfg(test)]
#[path = "filesystem.read.test.rs"]
mod read_tests;

#[cfg(test)]
#[path = "filesystem.image.test.rs"]
mod image_tests;
