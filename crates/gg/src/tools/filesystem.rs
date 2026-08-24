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
//! [unlimited](ReadPolicy::Unlimited) (to the end of the file unless the model asks for a
//! `limit`) or a [default cap](ReadPolicy::DefaultCap) (N lines unless the model explicitly asks
//! for more). Both modes take `offset`/`limit` and honour them whenever they are given; the modes
//! differ only in what a call that names no `limit` gets. An enabled capability names the mode and
//! writes the cap it is conducted at; gg selects neither on an operator's behalf.
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

#[path = "filesystem.search.rs"]
mod search;

pub(crate) use search::clip_line;
pub use search::{SEARCH_TOOL, SearchTool};

use super::{
    ApiData, ArgumentError, DirEntryData, DirEntryKind, FileImageData, FileTextData, Tool,
    ToolContext, ToolFailure, ToolOutcome, invalid_argument, required_str, saturating_u32,
};
use test_cabinet_core::gg::CAPABILITY_READ_FILE;
// The read vocabulary — the two mode ids and the one param — is `crates/core`'s, because the
// console writes a read-file capability with the same names this reads it back by. Re-exported
// rather than imported so `crate::tools` still names them for the modules that only ever say which
// mode a configuration is on.
pub use test_cabinet_core::gg::{
    PARAM_LINE_CAP, READ_MODE_DEFAULT_CAP, READ_MODE_UNLIMITED, READ_MODES,
};

use crate::model::{ImageContent, ToolDefinition};

/// The `read_file` tool name — also what the [system prompt](crate::prompts) checks for when it
/// decides whether to state this run's [line cap](ReadPolicy).
pub const READ_FILE_TOOL: &str = "read_file";

/// Ceiling on the bytes `read_file` returns to the model, so a huge file cannot flood
/// context. Applied **after** any [line window](ReadPolicy), as the last-resort backstop
/// against a file with enormous lines; the returned text carries a truncation note.
///
/// Visible to the crate because [session capture](crate::capture) sizes its own tool-payload
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

/// What a [`lineCap`](PARAM_LINE_CAP) of zero would do, in the capability's own terms — the clause
/// a [refusal](crate::validate) carries, written once so both readers of the param say it the same
/// way.
const LINE_CAP_CONSEQUENCE: &str = "a cap of no lines would make every read return nothing";

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
///
/// The third variant is not a mode: [`LaunchRefused`](Self::LaunchRefused) is what a total resolver
/// answers with once the launch it was reading is already refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadPolicy {
    /// Read to the end of the file when no `limit` is named — the control arm, selected by
    /// [`unlimited`](READ_MODE_UNLIMITED). An `offset` and a `limit` are honoured exactly as under
    /// the capped mode; the mode only decides what a call that names no `limit` gets.
    Unlimited,
    /// Return this many lines per call *by default*, honoring any larger `limit` the agent
    /// explicitly asks for. The cap is a nudge rather than a ceiling.
    DefaultCap(usize),
    /// **Not a read mode: the launch is already refused.** What [`resolve`](Self::resolve) hands
    /// back once it has nothing left to select from — the capability named no arm, or named one gg
    /// has no mode for, or wrote no [`lineCap`](PARAM_LINE_CAP) the capped arm could be conducted
    /// at. The resolver is total, so it answers with something; this is the something, and its name
    /// is what tells the next reader of that line that no run is going to reach it.
    ///
    /// It is deliberately not one of the two arms. Resolving a hole to `Unlimited` is precisely the
    /// substitution the [refusal](crate::validate) exists to prevent: it would hand an agent
    /// uncapped reads under the capped arm's name and record the study as though the capped arm had
    /// been conducted.
    LaunchRefused,
}

impl ReadPolicy {
    /// Resolve the policy from an **enabled** read-file capability's `implementation` and `params`.
    ///
    /// Enabled is the caller's to establish: the [`lineCap`](PARAM_LINE_CAP) is required of a
    /// capability that offers a `read_file` and of nothing else, so a declaration that offers none
    /// is read by [`check_declaration`] instead.
    ///
    /// Three ways a declaration leaves nothing to select, and all three end at
    /// [`LaunchRefused`](Self::LaunchRefused):
    ///
    /// - **No arm.** The mode is the read-cap experiment's own variable and gg selects none on an
    ///   operator's behalf. Reporting the absence belongs to the launch pass, which is the one
    ///   reader that can see the switch, so nothing is said here.
    /// - **An arm gg has no mode for.** Reported here, and this is the sharpest case of the rule in
    ///   gg: a typo'd `defaultcap` read as `unlimited` hands its agent uncapped reads while the
    ///   run's record names the capped arm — the two arms of the study, conducted as one.
    /// - **No `lineCap`, or one that is no whole number of lines of one or more.** Reported at the
    ///   param's own locus by [`required_positive_count_param`](crate::validate::required_positive_count_param),
    ///   which is the only way this reads it, so the param cannot be reached without the reaching
    ///   being the reporting.
    ///
    /// The `lineCap` is required whichever arm is selected, on the terms every knob in gg is judged
    /// by: a sweep that varies the mode over one shared params block is judged the same way on every
    /// launch in it, and which arm happens to consult a value is a different question from whether
    /// it was written.
    pub fn resolve(
        implementation: Option<&str>,
        params: &Value,
        report: &mut crate::validate::LaunchReport,
    ) -> Self {
        let cap = crate::validate::required_positive_count_param(
            params,
            CAPABILITY_READ_FILE,
            PARAM_LINE_CAP,
            LINE_CAP_CONSEQUENCE,
            report,
        );
        Self::select(implementation, cap, report)
    }

    /// The mode `implementation` names, at whatever `cap` survived being read — the half of
    /// [`resolve`](Self::resolve) that is the same question whether or not the capability offers a
    /// `read_file`, so [`check_declaration`] asks it too and an unrecognized mode is refused
    /// wherever it is written.
    fn select(
        implementation: Option<&str>,
        cap: Option<u64>,
        report: &mut crate::validate::LaunchReport,
    ) -> Self {
        // Saturating rather than refusing: a cap past `usize` is a number of lines no file has, and
        // "every line of it" is exactly what the operator asked for.
        let cap = cap.map(|cap| usize::try_from(cap).unwrap_or(usize::MAX));
        match implementation.map(str::trim) {
            Some(READ_MODE_UNLIMITED) => Self::Unlimited,
            Some(READ_MODE_DEFAULT_CAP) => cap.map_or(Self::LaunchRefused, Self::DefaultCap),
            Some("") | None => Self::LaunchRefused,
            Some(unknown) => {
                report.report(
                    crate::validate::LaunchDefect::run_level(
                        crate::validate::implementation_locus(CAPABILITY_READ_FILE),
                        unknown,
                        format!(
                            "the `{CAPABILITY_READ_FILE}` capability's implementation names how \
                             much of a file one call returns; gg has no such mode, and reading it \
                             as `{READ_MODE_UNLIMITED}` would hand this agent uncapped reads under \
                             the capped arm's name."
                        ),
                    )
                    .known(READ_MODES),
                );
                Self::LaunchRefused
            }
        }
    }

    /// The line cap in force, or `None` under [`Unlimited`](Self::Unlimited). Read by the tool
    /// itself (to word the `limit` argument's default) and by the [system prompt](crate::prompts),
    /// which states the cap up front so the model is not left to discover it one truncated read at
    /// a time.
    ///
    /// [`LaunchRefused`](Self::LaunchRefused) answers `None` as well, because there is no cap to
    /// state and no run to state it in.
    pub fn line_cap(&self) -> Option<usize> {
        match *self {
            Self::Unlimited | Self::LaunchRefused => None,
            Self::DefaultCap(cap) => Some(cap),
        }
    }

    /// How many lines a call asking for `requested` lines actually gets. `None` for `requested`
    /// means the agent named no `limit`, so the mode's default applies; `None` in the return
    /// means to the end of the file.
    ///
    /// A `requested` window is always honoured verbatim — no mode reduces it and no mode ignores
    /// it. The mode decides only what an absent `limit` means: the cap under the capped mode, the
    /// end of the file under the unlimited one. That is what makes a whole-file read reachable from
    /// every mode, and a paged read reachable from every mode too.
    fn window(&self, requested: Option<usize>) -> Option<usize> {
        match (*self, requested) {
            (_, Some(want)) => Some(want),
            // A refused launch offers no window either, and nothing reaches this to be windowed.
            (Self::Unlimited | Self::LaunchRefused, None) => None,
            // The default cap is exactly the one the agent can talk its way past.
            (Self::DefaultCap(cap), None) => Some(cap),
        }
    }
}

/// The read half of one profile's contribution to the
/// [launch pass](crate::validate::validate_launch): the [read mode](ReadPolicy) and the line cap it
/// declares, read exactly as the run will read them.
///
/// **The switch decides which reading it gets.** An enabled capability offers a `read_file` and is
/// therefore owed a cap, so it goes through [`ReadPolicy::resolve`] — the same function, reading the
/// same [`PARAM_LINE_CAP`], that [`read_policy`](super::read_policy) will call on the first turn. A
/// disabled one offers nothing and is short of nothing; what it carries is the configuration the
/// capped arm *would* have run at, so it is read by [`check_declaration`] and every value in it is
/// still judged.
pub fn check_launch(
    profile: &test_cabinet_core::gg::GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) {
    let Some(capability) = profile.capability(CAPABILITY_READ_FILE) else {
        return;
    };
    if capability.enabled {
        ReadPolicy::resolve(
            capability.implementation.as_deref(),
            &capability.params,
            report,
        );
    } else {
        check_declaration(
            capability.implementation.as_deref(),
            &capability.params,
            report,
        );
    }
}

/// Everything a **disabled** read-file capability's declaration is judged on: the mode it names,
/// and the [`lineCap`](PARAM_LINE_CAP) it writes, each read exactly as an enabled one's is.
///
/// What it is *not* judged on is absence. A capability that offers no `read_file` configures
/// nothing, so there is no cap it could be short of — and requiring one here would refuse the very
/// document that expresses the off arm of a comparison. Everything written is still read, which is
/// what keeps the two arms of that comparison one document with one switch moved rather than two
/// documents judged differently.
fn check_declaration(
    implementation: Option<&str>,
    params: &Value,
    report: &mut crate::validate::LaunchReport,
) {
    let cap = crate::validate::positive_count_param(
        params,
        CAPABILITY_READ_FILE,
        PARAM_LINE_CAP,
        LINE_CAP_CONSEQUENCE,
        report,
    );
    ReadPolicy::select(implementation, cap, report);
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

/// The `path` argument's schema, worded once for all five filesystem tools: `lead` names what
/// the path points at, and the resolution rule is the same everywhere.
fn path_param(lead: &str) -> Value {
    json!({
        "type": "string",
        "description": format!("{lead}. Workspace-relative or absolute."),
    })
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
        // decide whether "cannot be displayed" appearing in a sentence means it was withheld.
        let described = |shown: bool, why: Option<&str>| {
            ApiData::FileImage(FileImageData {
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
                    "`{path}` is a {label} image ({human}); it cannot be displayed: {why}. \
                     Re-reading will not help — work from the written specification, and treat \
                     any file named as a reference image the same way."
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
                    "`{path}` is a {label} image ({human}); too large to display (limit {}). \
                     Work from the written specification instead.",
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

    /// The whole-file read: what [`Unlimited`](ReadPolicy::Unlimited) answers a call that names
    /// neither `offset` nor `limit` with. Byte for byte the same text a window covering the file
    /// returns, without the line splitting.
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
        ToolOutcome::ok(output, format!("read {total} bytes")).with_data(ApiData::FileText(
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

    /// The windowed read every mode offers: `window` lines starting at the 1-based `offset`,
    /// with a footer telling the agent what it is looking at and how to get the rest. An
    /// `offset` without a `limit` under the unlimited mode arrives here with a window of
    /// `usize::MAX`, which reads from the offset to the end of the file.
    ///
    /// A window that happens to cover the whole file produces **no** footer, so a file
    /// shorter than the cap reads identically under both modes and only reads that were
    /// actually windowed (a start past line 1, or an end short of the file) say so.
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

        let data = ApiData::FileText(FileTextData {
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
        let path = path_param("File to read");
        // Both modes offer the paging arguments and honour them; they differ only in what an
        // absent `limit` means, which is stated on `limit` itself. The cap belongs on the
        // argument that overrides it: the system prompt already tells a capped run's model how
        // many lines a read returns.
        let limit_description = match self.policy.line_cap() {
            Some(cap) => format!("Lines to return (default {cap}; larger is allowed)."),
            None => "Lines to return (default: to the end of the file).".to_string(),
        };

        ToolDefinition::new(
            "read_file",
            "Read a file.",
            json!({
                "type": "object",
                "properties": {
                    "path": path,
                    "offset": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "First line to read, 1-based (default 1)."
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
            // No `limit` and no cap: an `offset` alone still windows the read — from that line
            // to the end of the file, footer included — and only a call that named neither
            // argument gets the file whole.
            None if offset > 1 => Self::read_window(&bytes, offset, usize::MAX),
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
            "Write UTF-8 text to a file, creating parent directories and overwriting \
             any existing file.",
            json!({
                "type": "object",
                "properties": {
                    "path": path_param("File to write"),
                    "contents": {
                        "type": "string",
                        "description": "Full file contents."
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
        .with_data(ApiData::BytesWritten(bytes as u64))
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
            "Replace `old_string` with `new_string` in a file. `old_string` must match \
             the file's text exactly and occur exactly once.",
            json!({
                "type": "object",
                "properties": {
                    "path": path_param("File to edit"),
                    "old_string": {
                        "type": "string",
                        "description": "Text to replace."
                    },
                    "new_string": {
                        "type": "string",
                        "description": "Replacement text."
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
            "List a directory's entries.",
            json!({
                "type": "object",
                "properties": {
                    "path": path_param("Directory to list (default `.`)")
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
            Err(why) => return invalid_argument(why),
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
        ToolOutcome::ok(output, format!("{count} entries")).with_data(ApiData::DirEntries(
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
