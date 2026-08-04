//! The filesystem tools: read, write, edit, and list files.
//!
//! gg runs inside the run container, so these tools operate on the **local**
//! filesystem, exactly as `sh -c` does. A path a tool accepts is resolved by
//! [`resolve_path`] the way any process resolves one: a relative path against gg's
//! working directory (the invocation's workspace root, or the agent's worktree when it
//! has one), an absolute path as itself.
//!
//! There is deliberately **no** confinement to the workspace root. The container *is* the
//! boundary — the only things in it are what the run was seeded with — so a lexical guard
//! bought no safety and cost real function: gg's own [shell](super::shell) offloads command
//! output to `/tmp/gg-shell` and tells the agent to go read it, and a run that then answers
//! `read_file` with "must be workspace-relative" is refusing to honour an instruction gg
//! itself gave. Anything reachable through these tools is reachable through one `cat`
//! anyway.
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
//! [unlimited](ReadPolicy::Unlimited) (the whole file, one call) or a
//! [default cap](ReadPolicy::DefaultCap) (N lines unless the model explicitly asks for
//! more). The capped mode takes `offset`/`limit` so the agent can page through a file; the
//! unlimited mode offers neither, because there is nothing to page.
//!
//! Neither mode can refuse a whole-file read — see [`ReadPolicy`] for why that is a property
//! rather than an accident.
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

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde_json::{Value, json};

use super::{
    ArgumentError, DirEntryData, DirEntryKind, FileImageData, FileTextData, Tool, ToolContext,
    ToolData, ToolFailure, ToolOutcome, invalid_argument, required_str, saturating_u32,
};
use crate::model::{ImageContent, ToolDefinition};

/// The `read_file` tool name — also what the [system prompt](crate::prompts) checks for when it
/// decides whether to state this run's [line cap](ReadPolicy).
pub const READ_FILE_TOOL: &str = "read_file";

/// Ceiling on the bytes `read_file` returns to the model, so a huge file cannot flood
/// context. Applied **after** any [line window](ReadPolicy), as the last-resort backstop
/// against a file with enormous lines; the returned text carries a truncation note.
///
/// Visible to the crate because [replay capture](crate::replay) sizes its own tool-payload
/// ceiling *at* this number and asserts the relation at compile time: a record has to keep whole
/// whatever the model was shown whole, so lowering the replay ceiling below this one — or raising
/// this one above it — must fail the build rather than quietly start recording a file the model
/// read in full as a tail of itself.
pub(crate) const READ_FILE_CAP: usize = 256 * 1024;

/// Ceiling on the **decoded** size of an image `read_file` will attach, in bytes.
///
/// An inline image is base64'd into the request body (≈4/3 its size) and charged to the
/// context window at a rate no estimator can pin down, so an unbounded one is the single
/// easiest way for a run to blow its window on one call. 8 MiB clears every reference
/// mockup a test case ships by a wide margin while still refusing, say, a captured video
/// frame dump. A larger image is described rather than attached — the read still
/// succeeds.
const IMAGE_ATTACH_CAP: u64 = 8 * 1024 * 1024;

/// The read-file capability's `lineCap` param: the default number of lines a
/// [default-capped](ReadPolicy::DefaultCap) read returns.
pub const PARAM_LINE_CAP: &str = "lineCap";

/// The [implementation](test_cabinet_core::gg::GgCapabilityConfig::implementation) id
/// selecting the unlimited read mode — a call returns the whole file. The default, so a
/// capability set that says nothing about read modes behaves as gg always has.
pub const READ_MODE_UNLIMITED: &str = "unlimited";

/// The implementation id selecting the default-capped read mode: a call returns
/// [`lineCap`](PARAM_LINE_CAP) lines unless the agent explicitly asks for more, which is
/// honored.
pub const READ_MODE_DEFAULT_CAP: &str = "default-cap";

/// The line cap the [default-capped](ReadPolicy::DefaultCap) read mode uses when its capability
/// declares no [`lineCap`](PARAM_LINE_CAP) (or declares a nonsensical one).
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
/// ever half-sees. These two modes are the arms of that experiment.
///
/// **Every mode a caller can reach is one the caller can read a whole file through** — either
/// because the mode returns it whole or because a large enough `limit` is honoured. There is
/// deliberately no mode that refuses: a hard ceiling would make it impossible to put a document
/// in front of an agent in full, and gg has one caller that must be able to
/// ([autoloaded specifications](crate::agent), which seed a case's specs whole).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ReadPolicy {
    /// Return the whole file in one call, with no `offset`/`limit` arguments — gg's
    /// original behavior, and the control arm. The default, so an unconfigured
    /// read-file capability reads exactly as gg always has.
    #[default]
    Unlimited,
    /// Return this many lines per call *by default*, honoring any larger `limit` the agent
    /// explicitly asks for. The cap is a nudge rather than a ceiling.
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
            Self::DefaultCap(cap) => Some(cap),
        }
    }

    /// How many lines a call asking for `requested` lines actually gets. `None` for `requested`
    /// means the agent named no `limit`, so the mode's default applies; `None` in the return
    /// means the whole file.
    ///
    /// A `requested` window is always honoured verbatim — no mode reduces one — which is what
    /// makes a whole-file read reachable from every mode.
    fn window(&self, requested: Option<usize>) -> Option<usize> {
        match (*self, requested) {
            (Self::Unlimited, _) => None,
            (Self::DefaultCap(cap), None) => Some(cap),
            // The default cap is exactly the one the agent can talk its way past.
            (Self::DefaultCap(_), Some(want)) => Some(want),
        }
    }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/// Resolve `path` the way any process in the container would: relative to gg's working
/// directory `cwd` (the invocation's workspace root — the agent's own worktree when it has
/// one), or as itself when it is absolute.
///
/// `..` is ordinary here — it is left in the path for the kernel to resolve, which is both
/// simpler and more correct than normalizing it away, since a lexical `a/../b` is not `b`
/// when `a` is a symlink.
///
/// The one refusal left is an empty path, which is a mistake in the call rather than a
/// destination: joined onto `cwd` it would silently name the working directory itself, so a
/// `write_file` of `""` would try to overwrite a directory.
pub fn resolve_path(cwd: &Path, path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("path must not be empty".to_string());
    }
    Ok(cwd.join(path))
}

/// Read `field` from `args` as an **optional** positive integer (the `offset`/`limit`
/// paging arguments). Absent or `null` is `None` — the caller's default applies — while a
/// present value that is not a positive integer is an error rather than a silent default,
/// so a model passing `0` or `"10"` is told instead of quietly getting something else.
fn positive_arg(args: &Value, field: &str) -> Result<Option<usize>, ArgumentError> {
    match args.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|&n| n > 0)
            .map(|n| Some(n as usize))
            .ok_or_else(|| ArgumentError(format!("argument `{field}` must be a positive integer"))),
    }
}

/// How many lines `bytes` holds, counted the way [`ReadFileTool::read_window`] windows them
/// (`split_inclusive('\n')`): a trailing newline ends the last line rather than starting an empty
/// one, and empty input is zero lines rather than one.
///
/// Counted over the **bytes** rather than a decoded string because `0x0A` never occurs inside a
/// multi-byte UTF-8 sequence, so the two agree exactly — and lossy decoding a 200 MiB file just to
/// count its lines would be a real cost for no gain.
fn count_lines(bytes: &[u8]) -> u32 {
    if bytes.is_empty() {
        return 0;
    }
    let newlines = bytes.iter().filter(|byte| **byte == b'\n').count();
    let unterminated = usize::from(bytes.last() != Some(&b'\n'));
    saturating_u32(newlines + unterminated)
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
pub(crate) fn human_bytes(bytes: u64) -> String {
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

/// Reads a file's contents within the run's [`ReadPolicy`].
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
    fn read_image(path: &str, format: ImageFormat, bytes: &[u8], ctx: &ToolContext) -> ToolOutcome {
        let size = bytes.len() as u64;
        let label = format.label;
        let human = human_bytes(size);

        // The sidecar says the same three things the prose does — what it is, how big it is, and
        // whether the model is actually being shown it — so a structured caller never has to
        // decide whether "cannot be shown to you" appearing in a sentence means it was withheld.
        let described = |shown: bool, why: Option<&str>| {
            ToolData::FileImage(FileImageData {
                media_type: format.media_type.to_string(),
                label: label.to_string(),
                bytes: size,
                shown,
                not_shown_reason: why.map(str::to_string),
            })
        };

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
                    "`{path}` is a {label} image ({human}). It cannot be shown to you: \
                     {why}. Reading it again will not help — work from the written \
                     specification, and treat any file named as a reference image the same way."
                ),
                format!("{label} image, {human} (not shown: no image input)"),
            )
            .with_data(described(false, Some(why)));
        }

        if size > IMAGE_ATTACH_CAP {
            let why = format!(
                "the image is larger than the {} display limit",
                human_bytes(IMAGE_ATTACH_CAP)
            );
            return ToolOutcome::ok(
                format!(
                    "`{path}` is a {label} image ({human}). It is too large to display \
                     (the limit is {}); work from the written specification instead.",
                    human_bytes(IMAGE_ATTACH_CAP)
                ),
                format!("{label} image, {human} (too large to show)"),
            )
            .with_data(described(false, Some(&why)));
        }

        ToolOutcome::ok(
            format!("`{path}` — {label} image, {human}. The image follows."),
            format!("{label} image, {human}"),
        )
        .with_images(vec![ImageContent::new(
            format.media_type,
            BASE64.encode(bytes),
            size,
        )])
        .with_data(described(true, None))
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
        // `contents` is what the file says; `output` is `contents` plus whatever gg has to add
        // about it. Keeping them apart is what lets the sidecar hand back a file body that is
        // exactly the file's, with no footer for a caller to strip back off.
        let contents = String::from_utf8_lossy(slice).into_owned();
        let mut output = contents.clone();
        if truncated {
            output.push_str(&format!(
                "\n\n[truncated: showing {READ_FILE_CAP} of {total} bytes]"
            ));
        }

        let returned_lines = count_lines(contents.as_bytes());
        ToolOutcome::ok(output, format!("read {total} bytes")).with_data(ToolData::FileText(
            FileTextData {
                first_line: 1,
                last_line: returned_lines,
                // The byte ceiling can cut a whole-file read short, so the file's length is
                // counted over all of its bytes rather than over what came back.
                total_lines: if truncated {
                    count_lines(bytes)
                } else {
                    returned_lines
                },
                byte_truncated: truncated,
                contents,
            },
        ))
    }

    /// The windowed read the capped modes offer: `window` lines starting at the 1-based
    /// `offset`, with a footer telling the agent what it is looking at and how to get the
    /// rest.
    ///
    /// A window that happens to cover the whole file produces **no** footer, so a file
    /// shorter than the cap reads identically under both modes and only files big
    /// enough to actually be capped differ between arms.
    fn read_window(bytes: &[u8], offset: usize, window: usize) -> ToolOutcome {
        let text = String::from_utf8_lossy(bytes);
        let lines: Vec<&str> = text.split_inclusive('\n').collect();
        let total = lines.len();

        let start = offset.saturating_sub(1);
        if start >= total && total > 0 {
            // An offset beyond the file is a value out of range, not a missing file: the file was
            // found, and the message names its length so the next call can be corrected.
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                format!("`offset` {offset} is past the end of the file ({total} lines)"),
            );
        }
        let end = start.saturating_add(window).min(total);

        // As in `read_whole`: `contents` is the file's own text (byte-truncated if it had to be),
        // and `output` is that plus gg's footers.
        let mut contents: String = lines[start..end].concat();
        let bytes_returned = contents.len();
        let byte_truncated = bytes_returned > READ_FILE_CAP;
        if byte_truncated {
            contents.truncate(floor_char_boundary(&contents, READ_FILE_CAP));
        }
        let mut output = contents.clone();
        if byte_truncated {
            output.push_str(&format!(
                "\n\n[truncated: showing {READ_FILE_CAP} of {bytes_returned} bytes]"
            ));
        }

        let data = ToolData::FileText(FileTextData {
            contents,
            first_line: saturating_u32(start + 1),
            last_line: saturating_u32(end),
            total_lines: saturating_u32(total),
            byte_truncated,
        });

        let windowed = start > 0 || end < total;
        if !windowed {
            return ToolOutcome::ok(output, format!("read {bytes_returned} bytes")).with_data(data);
        }

        let mut note = format!("showing lines {}-{end} of {total}", start + 1);
        if end < total {
            note.push_str(&format!("; continue with offset: {}", end + 1));
        }
        output.push_str(&format!("\n\n[{note}]"));

        ToolOutcome::ok(
            output,
            format!(
                "read lines {}-{end} of {total} ({bytes_returned} bytes)",
                start + 1
            ),
        )
        .with_data(data)
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
            "description": "Path to the file to read — relative to the workspace root, or absolute."
        });
        // The unlimited mode offers no paging arguments at all: with the whole file in
        // every result there is nothing for the agent to page through, and offering knobs
        // that never bind would misrepresent the arm.
        let Some(cap) = self.policy.line_cap() else {
            return ToolDefinition::new(
                "read_file",
                "Read a file and return its contents (truncated if very \
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

        let (description, limit_description) = (
            format!(
                "Read a file. A text file returns {cap} lines by \
                 default, starting at `offset`; pass a larger `limit` when you need \
                 more of the file at once. The result tells you how many lines the file \
                 has and where to continue from. A PNG, JPEG, GIF, or WebP image is \
                 returned whole, as the image itself, when the session's model can see \
                 one — `offset`/`limit` do not apply to it."
            ),
            format!("How many lines to return (default {cap}; larger is allowed)."),
        );

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
        let path = match required_str(&args, "path") {
            Ok(path) => path,
            Err(error) => return error.into(),
        };
        let offset = match positive_arg(&args, "offset") {
            Ok(offset) => offset,
            Err(error) => return error.into(),
        };
        let limit = match positive_arg(&args, "limit") {
            Ok(limit) => limit,
            Err(error) => return error.into(),
        };
        self.read(ctx, path, offset, limit)
    }
}

impl ReadFileTool {
    /// Read a file — the **standard, typed** `read_file` API function both call paths
    /// reach: the JSON tool-calling [adapter](Tool::invoke) after it parses its arguments, and the
    /// [responses-as-code membrane](crate::sandbox) directly with the typed values a program passed.
    ///
    /// `offset` is normalised to gg's 1-based first line (a `Some(0)` — which the WIT `option<u32>`
    /// admits but the schema's `minimum: 1` forbids — reads from the start, rather than costing a
    /// turn on an argument error about a constraint the signature never stated).
    pub(crate) fn read(
        &self,
        ctx: &ToolContext,
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> ToolOutcome {
        let resolved = match resolve_path(&ctx.workspace_dir, &path) {
            Ok(resolved) => resolved,
            Err(why) => return invalid_argument(why),
        };
        let offset = offset.map(|offset| offset.max(1)).unwrap_or(1);

        let bytes = match std::fs::read(&resolved) {
            Ok(bytes) => bytes,
            Err(err) => {
                return ToolOutcome::failed(ToolFailure::from_io(&err), format!("`{path}`: {err}"));
            }
        };

        // An image is answered as an image, before any line windowing: `offset`/`limit`
        // describe lines of text and mean nothing for a picture, and decoding the bytes
        // as lossy UTF-8 would return noise.
        if let Some(format) = sniff_image(&bytes) {
            return Self::read_image(&path, format, &bytes, ctx);
        }

        match self.policy.window(limit) {
            Some(window) => Self::read_window(&bytes, offset, window),
            None => Self::read_whole(&bytes),
        }
    }
}

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

/// Writes (creating or overwriting) a file.
pub struct WriteFileTool;

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "write_file",
            "Write UTF-8 text to a file, creating parent directories \
             and overwriting any existing file.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to write — relative to the workspace root, or absolute."
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
        let path = match required_str(&args, "path") {
            Ok(path) => path,
            Err(error) => return error.into(),
        };
        let contents = match required_str(&args, "contents") {
            Ok(contents) => contents,
            Err(error) => return error.into(),
        };
        self.write(ctx, path, contents)
    }
}

impl WriteFileTool {
    /// Write a file — the **standard, typed** `write_file` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn write(&self, ctx: &ToolContext, path: String, contents: String) -> ToolOutcome {
        let resolved = match resolve_path(&ctx.workspace_dir, &path) {
            Ok(resolved) => resolved,
            Err(why) => return invalid_argument(why),
        };

        if let Some(parent) = resolved.parent()
            && let Err(err) = std::fs::create_dir_all(parent)
        {
            return ToolOutcome::failed(
                ToolFailure::from_io(&err),
                format!("creating parent dirs: {err}"),
            );
        }
        if let Err(err) = std::fs::write(&resolved, contents.as_bytes()) {
            return ToolOutcome::failed(ToolFailure::from_io(&err), format!("`{path}`: {err}"));
        }

        let bytes = contents.len();
        ToolOutcome::ok(
            format!("wrote {bytes} bytes"),
            format!("wrote {bytes} bytes"),
        )
        .with_data(ToolData::BytesWritten(bytes as u64))
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
             file. `old_string` must appear exactly once; the edit fails if \
             it is missing or ambiguous.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to edit — relative to the workspace root, or absolute."
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
        let path = match required_str(&args, "path") {
            Ok(path) => path,
            Err(error) => return error.into(),
        };
        let old_string = match required_str(&args, "old_string") {
            Ok(value) => value,
            Err(error) => return error.into(),
        };
        let new_string = match required_str(&args, "new_string") {
            Ok(value) => value,
            Err(error) => return error.into(),
        };
        self.edit(ctx, path, old_string, new_string)
    }
}

impl EditFileTool {
    /// Replace an exact, unique occurrence in a file — the **standard, typed** `edit_file`
    /// API function both the JSON [adapter](Tool::invoke) and the
    /// [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn edit(
        &self,
        ctx: &ToolContext,
        path: String,
        old_string: String,
        new_string: String,
    ) -> ToolOutcome {
        let resolved = match resolve_path(&ctx.workspace_dir, &path) {
            Ok(resolved) => resolved,
            Err(why) => return invalid_argument(why),
        };

        if old_string.is_empty() {
            return invalid_argument("`old_string` must not be empty");
        }
        if old_string == new_string {
            return invalid_argument("`old_string` and `new_string` are identical");
        }

        let contents = match std::fs::read_to_string(&resolved) {
            Ok(contents) => contents,
            Err(err) => {
                return ToolOutcome::failed(ToolFailure::from_io(&err), format!("`{path}`: {err}"));
            }
        };

        let occurrences = contents.matches(&old_string).count();
        match occurrences {
            // Two different failures with two different recoveries: text that is not there has to
            // be re-read, while text that is there several times has to be disambiguated. A caller
            // that can tell them apart can do both without a round trip through the prose.
            0 => {
                return ToolOutcome::failed(
                    ToolFailure::NotFound,
                    "`old_string` was not found in the file",
                );
            }
            1 => {}
            n => {
                return ToolOutcome::failed(
                    ToolFailure::Conflict,
                    format!("`old_string` is not unique ({n} occurrences)"),
                );
            }
        }

        let updated = contents.replacen(&old_string, &new_string, 1);
        if let Err(err) = std::fs::write(&resolved, updated.as_bytes()) {
            return ToolOutcome::failed(ToolFailure::from_io(&err), format!("writing back: {err}"));
        }

        ToolOutcome::ok("replaced 1 occurrence", "edited (1 replacement)")
    }
}

// ---------------------------------------------------------------------------
// list_dir
// ---------------------------------------------------------------------------

/// Lists a directory's entries.
pub struct ListDirTool;

#[async_trait]
impl Tool for ListDirTool {
    fn name(&self) -> &str {
        "list_dir"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "list_dir",
            "List a directory's entries. Directories are \
             suffixed with `/`. Defaults to the workspace root.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory to list — relative to the workspace root, or absolute (defaults to `.`)."
                    }
                },
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        // `path` is optional here and defaults to the workspace root.
        let path = match args.get("path") {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) => Some(value.clone()),
            Some(_) => {
                return invalid_argument("`list_dir`: argument `path` must be a string");
            }
        };
        self.list(ctx, path)
    }
}

impl ListDirTool {
    /// List a directory — the **standard, typed** `list_dir` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach. A `None`
    /// path lists the workspace root.
    pub(crate) fn list(&self, ctx: &ToolContext, path: Option<String>) -> ToolOutcome {
        let path = path.unwrap_or_else(|| ".".to_string());
        let dir = match resolve_path(&ctx.workspace_dir, &path) {
            Ok(dir) => dir,
            Err(why) => return invalid_argument(format!("`list_dir`: {why}")),
        };

        let read = match std::fs::read_dir(&dir) {
            Ok(read) => read,
            Err(err) => {
                return ToolOutcome::failed(ToolFailure::from_io(&err), format!("list_dir: {err}"));
            }
        };

        // Carried as `(display, entry)` so the sort stays byte-for-byte the one the prose has
        // always used — on the rendered name, `/` suffix and all — while the sidecar keeps the
        // entry's real name and kind instead of re-deriving them from a trailing slash.
        let mut entries: Vec<(String, DirEntryData)> = Vec::new();
        for entry in read {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    return ToolOutcome::failed(
                        ToolFailure::from_io(&err),
                        format!("list_dir: {err}"),
                    );
                }
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            // An unreadable file type is reported as `Other` rather than guessed at — and, as
            // before, is not suffixed, since gg does not know it to be a directory.
            let kind = match entry.file_type() {
                Ok(file_type) if file_type.is_dir() => DirEntryKind::Directory,
                Ok(file_type) if file_type.is_file() => DirEntryKind::File,
                Ok(_) | Err(_) => DirEntryKind::Other,
            };
            let display = if kind == DirEntryKind::Directory {
                format!("{name}/")
            } else {
                name.clone()
            };
            entries.push((display, DirEntryData { name, kind }));
        }
        entries.sort_by(|(left, _), (right, _)| left.cmp(right));

        let count = entries.len();
        let output = if entries.is_empty() {
            "(empty directory)".to_string()
        } else {
            entries
                .iter()
                .map(|(display, _)| display.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        };
        ToolOutcome::ok(output, format!("{count} entries")).with_data(ToolData::DirEntries(
            entries.into_iter().map(|(_, entry)| entry).collect(),
        ))
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
