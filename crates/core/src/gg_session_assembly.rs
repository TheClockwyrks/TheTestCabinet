//! Host-side **assembly**: folding a gg run's
//! [capture journal](crate::gg_session_journal) into the served
//! [session record](crate::gg_session_record::GgSessionRecord).
//!
//! This is the other half of the split [format v2](crate::gg_session_record) is built on. In the
//! container gg appends one line per pinned input and assembles nothing; here, on the
//! host, after the working tree has been collected and the container is gone, those lines
//! become the one document a replay driver and the console read. Everything about the
//! placement is deliberate:
//!
//! - **On the host, not in the container.** Assembly is the expensive half — it reads the
//!   whole journal and gzips a whole record — and doing it in the container would spend
//!   the *test case's* runtime budget on gg's own diagnostics. The
//!   [post-run seam](crate::post_run) it runs at has no runtime cap and runs after the
//!   run's measured duration is frozen, so it cannot cost a run its score.
//! - **Not in the driver's memory.** A journal is bounded by
//!   [`replay_max_bytes`](crate::gg::GgRunLimits) rather than by anything small, and the
//!   driver pod holds one run at a time on a modest memory limit. So the document is
//!   never built in memory: each of its five arrays is streamed into a **segment file**
//!   as the journal is walked, and the segments are then copied through a gzip encoder
//!   into the final artifact. Peak memory is one journal line.
//!
//! # Where the segment files live, and why it is not `/tmp`
//!
//! Segment files cost roughly the journal's own size again while assembly runs, so a
//! 256 MiB journal transiently needs ~512 MiB of disk. The scratch directory is therefore
//! derived from the **output path** rather than taken as a parameter or from
//! [`std::env::temp_dir`]: the artifact is written into the run tree, so scratch beside it
//! is guaranteed to be the same volume the run tree already sized for. A `/tmp` that is a
//! small `tmpfs` — the usual shape in a container — would turn a large but perfectly
//! ordinary run into a failed assembly, or into memory pressure on the pod.
//!
//! # What is refused, and what is merely reported
//!
//! The distinction is whether the damage is *bounded*. A journal that stops early is a
//! shorter record and says so; a journal whose **indices do not line up** would produce a
//! record that looks complete and is wrong — a message body substituted for another one
//! in a recorded prompt, or an out-of-range pool reference that panics whatever walks
//! it. So:
//!
//! | Condition | Outcome |
//! | --- | --- |
//! | No terminating [`End`](crate::gg_session_journal::GgJournalLine::End) line | [`SessionKilled`](crate::gg_session_record::GgSessionTruncationReason::SessionKilled), everything read is kept |
//! | A torn or unparseable line | [`CorruptJournal`](crate::gg_session_record::GgSessionTruncationReason::CorruptJournal) at the last complete `seq`, everything before it kept |
//! | `End` disagreeing with the walk's own count | `CorruptJournal`, for the same reason the count is written at all |
//! | A pool line whose index is not the next one | **Refused** — no record is written |
//! | An entry referencing past a pool's end | **Refused** — no record is written |
//! | A journal in a format this build does not write | **Refused** — a newer gg is never guessed at |
//!
//! A refusal is an ordinary stage failure: the seam logs it and the run is untouched, so
//! the honest signal is a run with no replay artifact rather than a run with a subtly
//! wrong one.

use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Seek, Write};
use std::path::Path;

use flate2::Compression;
use flate2::write::GzEncoder;
use serde::Serialize;
use tempfile::TempDir;

use crate::error::{Error, Result};
use crate::gg::GgCapabilitySet;
use crate::gg_session_journal::{GG_SESSION_JOURNAL_PATH, GgJournalLine};
use crate::gg_session_record::{
    GG_SESSION_FORMAT_VERSION, GgSessionAgent, GgSessionEntry, GgSessionEntryKind,
    GgSessionRecorder, GgSessionSeed, GgSessionTruncation, GgSessionTruncationReason,
};
use crate::post_run::{PostRunContext, PostRunReport, PostRunStage};

/// The file name a run tree carries its assembled session record under, at the **root** of
/// the run directory rather than inside `implementation/`.
///
/// `implementation/` is a verbatim copy of what the model produced; a host-written file
/// there would read as code the model wrote. The root is also what the
/// [run-tree artifact convention](crate::post_run) names: `<name>.json.gz` here, mirrored
/// into the backend store as opaque bytes and served back content-negotiated.
pub const GG_SESSION_TREE_ARTIFACT: &str = "replay.json.gz";

/// What one [assembly](assemble_journal_to_gz) produced.
///
/// Reported rather than inferred from the artifact, because the two figures an operator
/// wants — how much was captured, and whether it is all of it — are exactly the two a
/// gzipped file on disk does not show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GgSessionAssembly {
    /// How many [entries](GgSessionEntry) the assembled record carries.
    pub entries: u64,
    /// What the record is missing, when it is missing something.
    pub truncation: Option<GgSessionTruncation>,
    /// The size of the written `.gz`, so a run's log can say what the artifact cost.
    pub compressed_bytes: u64,
}

/// Fold the capture journal at `journal` into a gzipped
/// [session record](crate::gg_session_record::GgSessionRecord) at `output`, streaming through
/// scratch [segment files](self#where-the-segment-files-live-and-why-it-is-not-tmp)
/// beside `output` so peak memory is one journal line.
///
/// `output` is written **only** on success: an assembly that refuses its journal leaves
/// no artifact at all rather than a partial one, which is what keeps "the file exists" a
/// usable statement about the record. That holds for an I/O failure *mid-write* as well as
/// for a refusal, because the document is streamed into the scratch directory and moved
/// into place once it is whole — the scratch tree is on `output`'s own volume precisely so
/// that move is a rename and not a second copy.
///
/// See the [module documentation](self) for which damage is reported as a
/// [truncation](GgSessionTruncation) and which is refused outright.
pub fn assemble_journal_to_gz(journal: &Path, output: &Path) -> Result<GgSessionAssembly> {
    let scratch = scratch_beside(output)?;
    let mut segments = Segments::create(scratch.path())?;
    let mut reader = BufReader::new(
        File::open(journal)
            .map_err(|err| journal_error(journal, format!("cannot be read: {err}")))?,
    );

    let mut header: Option<JournalHeader> = None;
    let mut provenance = Provenance::default();
    let mut entries: u64 = 0;
    let mut last_seq: Option<u64> = None;
    // Set when the walk stops on damage; superseded by whatever the `End` line reports if
    // the walk reaches one.
    let mut damaged: Option<GgSessionTruncation> = None;
    let mut end: Option<EndLine> = None;

    let mut line = Vec::new();
    loop {
        line.clear();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(|err| journal_error(journal, format!("cannot be read: {err}")))?;
        if read == 0 {
            break;
        }
        // Read as bytes rather than as `str` lines precisely for this check: the writer
        // terminates every line it writes, so a final chunk without its newline is by
        // definition a line that was still being written when the process stopped. A
        // partial line can also cut a UTF-8 sequence in half, which a lossy `lines()`
        // would have quietly repaired into unparseable JSON with no way to tell the two
        // apart.
        if line.last() != Some(&b'\n') {
            damaged = Some(corrupt_at(last_seq));
            break;
        }
        line.pop();
        if line.is_empty() {
            continue;
        }
        let parsed = match serde_json::from_slice::<GgJournalLine>(&line) {
            Ok(parsed) => parsed,
            // Not distinguished from a torn tail, because on disk they are not
            // distinguishable: both are a line this build cannot read, and both keep
            // everything that came before.
            Err(_) => {
                damaged = Some(corrupt_at(last_seq));
                break;
            }
        };
        match parsed {
            GgJournalLine::Header {
                format_version,
                session_id,
                capability_set,
                recorder,
            } => {
                if format_version != GG_SESSION_FORMAT_VERSION {
                    return Err(journal_error(
                        journal,
                        format!(
                            "is in journal format {format_version}, which this build does not \
                             assemble (it writes {GG_SESSION_FORMAT_VERSION}); a record from a gg \
                             this one does not understand is refused rather than guessed at"
                        ),
                    ));
                }
                if header.is_some() {
                    return Err(journal_error(
                        journal,
                        "carries a second header line; a journal records exactly one session",
                    ));
                }
                header = Some(JournalHeader {
                    format_version,
                    session_id,
                    capability_set,
                    recorder,
                });
            }
            GgJournalLine::Seed { seed } => {
                // The last one wins: the recorder rewrites the envelope when a value it could
                // not know at launch has since resolved (see the journal line's docs).
                provenance.seed = *seed;
            }
            GgJournalLine::Agent { agent } => provenance.upsert_agent(*agent),
            GgJournalLine::Message { index, message } => {
                expect_next_index(journal, "message", index, segments.messages.count)?;
                segments.messages.push(&message)?;
            }
            GgJournalLine::Toolset { index, toolset } => {
                expect_next_index(journal, "toolset", index, segments.toolsets.count)?;
                segments.toolsets.push(&toolset)?;
            }
            GgJournalLine::Text { index, text, clip } => {
                expect_next_index(journal, "text", index, segments.texts.count)?;
                segments.texts.push(&text)?;
                // Pushed after the text it describes, so the clip table stays in ascending pool
                // order — which is what lets a reader binary-search it.
                if let Some(clip) = clip {
                    segments.clips.push(&clip)?;
                }
            }
            GgJournalLine::Entry { entry } => {
                check_entry_references(journal, &segments, &entry)?;
                segments.entries.push(&*entry)?;
                entries += 1;
                last_seq = Some(entry.seq);
            }
            GgJournalLine::End {
                entries: reported,
                truncation,
            } => {
                end = Some(EndLine {
                    entries: reported,
                    truncation,
                });
                break;
            }
        }
    }

    let Some(header) = header else {
        // Without a header there is no session id and no capability set, so there is no
        // record to write — not even an empty one. A journal this short is a gg that died
        // before its first flush, which the missing artifact reports honestly.
        return Err(journal_error(
            journal,
            "has no header line, so the session it belongs to is unknown",
        ));
    };
    let truncation = resolve_truncation(damaged, end, entries, last_seq);

    // Staged, then moved into place. A failure inside `write_record` — a full disk, a
    // short write copying a segment in — would otherwise leave a truncated `.gz` at the
    // run tree root, which the driver would go on to mirror as the run's record.
    let staged = scratch.path().join("record.json.gz");
    let compressed_bytes =
        write_record(&staged, &header, &provenance, segments, truncation.as_ref())?;
    std::fs::rename(&staged, output)?;
    Ok(GgSessionAssembly {
        entries,
        truncation,
        compressed_bytes,
    })
}

/// The [post-run stage](crate::post_run) that assembles a gg run's capture journal into the
/// run tree's [`replay.json.gz`](GG_SESSION_TREE_ARTIFACT).
///
/// Wired into [`RunEngine::session_assembler`](crate::RunEngine) by the host that drives
/// runs. It applies only to **gg** runs — the seam invokes every wired stage
/// unconditionally, so deciding "this run has nothing for me" is the stage's own job — and
/// only to gg runs that actually captured something: a run whose capture never started
/// (an older gg in the container, an unwritable workspace) leaves no journal, and a
/// missing journal is an ordinary absence rather than a failure.
///
/// On success it **removes the journal from the collected tree**. The tree is copied
/// verbatim into the run's `implementation/` directory and from there into the run-tree
/// archive, so leaving a full conversation transcript inside it would ship the transcript
/// — and would additionally count it as code the model wrote. The assembled record at the
/// tree root is where that content belongs.
///
/// A journal the assembly **refused** is deliberately left where it is: the record that
/// would have superseded it does not exist, so the journal is the only remaining account
/// of the session and the only thing a human can diagnose the refusal from. It costs
/// bulk in the archive, and it is never a *publish* exposure — seeding excludes `/.gg/`
/// from the run's git repository, so it cannot reach the public per-run repo — which is
/// what makes keeping it the better trade.
#[derive(Debug, Default, Clone, Copy)]
pub struct GgSessionAssembler;

#[async_trait::async_trait]
impl PostRunStage for GgSessionAssembler {
    fn name(&self) -> &'static str {
        "gg-session-record"
    }

    async fn run(&self, context: &PostRunContext<'_>) -> Result<PostRunReport> {
        if !context.request.is_gg() {
            return Ok(PostRunReport::empty());
        }
        let journal = context.artifacts.repo_path.join(GG_SESSION_JOURNAL_PATH);
        if !journal.exists() {
            return Ok(PostRunReport::empty());
        }
        let output = context.run_dir.join(GG_SESSION_TREE_ARTIFACT);
        // The `?` is what leaves a refused journal in the tree, and that is the intent:
        // with no record to supersede it, the journal is the only account of the session
        // left to diagnose the refusal from (see this stage's documentation).
        let assembly = assemble_journal_to_gz(&journal, &output)?;
        if let Err(err) = std::fs::remove_file(&journal) {
            // Not fatal: the record is already written, and the exclusion seeding adds
            // for `/.gg/` keeps the leftover out of every git operation regardless. It is
            // still worth a warning, because the leftover is bulk in a published tree.
            tracing::warn!(
                error = %err,
                journal = %journal.display(),
                "could not remove the capture journal from the collected tree",
            );
        }
        tracing::info!(
            entries = assembly.entries,
            compressed_bytes = assembly.compressed_bytes,
            truncated = assembly.truncation.is_some(),
            "assembled the gg session record",
        );
        Ok(PostRunReport::artifact(output))
    }
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/// The identity a journal's header line carries into the record it assembles into.
struct JournalHeader {
    /// The record format the journal declares, already checked against this build's.
    format_version: u32,
    /// The gg session id — the run id.
    session_id: String,
    /// The run's capability set, boxed exactly as the journal line carries it: assembly
    /// only copies it through to the record, never reads it.
    capability_set: Box<GgCapabilitySet>,
    /// Which build captured.
    recorder: GgSessionRecorder,
}

/// The record's **provenance**: the invocation envelope and the agent table, folded out of
/// the journal's [`Seed`](GgJournalLine::Seed) and [`Agent`](GgJournalLine::Agent) lines.
///
/// The one part of an assembled record that is held **in memory** rather than streamed
/// through a [segment file](Segment), and deliberately so: both are bounded by the run's
/// *shape* — one envelope, one row per agent — rather than by its length, which is the term
/// the segments exist to remove. A thousand-turn run has the same provenance as a two-turn
/// one. They also cannot be streamed, because both are written more than once: a later line
/// supersedes an earlier one, and a segment file only appends.
#[derive(Debug, Default)]
struct Provenance {
    /// The fixed identity the session started from, as the **last**
    /// [`Seed`](GgJournalLine::Seed) line stated it. Default — an empty envelope — for a
    /// journal that carried none, which is every journal written before the line existed.
    seed: GgSessionSeed,
    /// One row per agent, in the order the run created them.
    agents: Vec<GgSessionAgent>,
}

impl Provenance {
    /// Add `agent`, or replace the row it already has.
    ///
    /// A linear scan rather than a map, for the reason the table is in memory at all: it is
    /// bounded by the run's agent count — single digits for almost every run, and bounded by
    /// the parallelism cap and the board for the rest — and the position matters. Replacing in
    /// place is what keeps the table in **creation order** while letting the terminal row
    /// supersede the opening one.
    fn upsert_agent(&mut self, agent: GgSessionAgent) {
        match self
            .agents
            .iter_mut()
            .find(|existing| existing.agent_id == agent.agent_id)
        {
            Some(existing) => *existing = agent,
            None => self.agents.push(agent),
        }
    }
}

/// What the terminating line reported, kept apart from the walk's own figures so the two
/// can be compared.
struct EndLine {
    /// How many entries the recorder says it wrote.
    entries: u64,
    /// Why capture stopped short, when it did.
    truncation: Option<GgSessionTruncation>,
}

/// The truncation the assembled record should carry.
///
/// The rule is that the journal's *structure* outranks its self-report, because a
/// recorder that stopped deliberately still wrote a correct journal, whereas one whose
/// count does not match the walk did not:
///
/// 1. no `End` at all ⇒ whatever the walk found (a torn line) or, failing that, a killed
///    session — the absence of the marker is the only signal a killed gg can leave;
/// 2. an `End` whose count disagrees with the walk ⇒ corrupt, superseding the reason the
///    recorder gave, since the record demonstrably does not hold what the recorder says
///    it wrote;
/// 3. otherwise the recorder's own report, which is the ordinary case (`None` for a
///    complete capture, a ceiling breach for a deliberate stop).
fn resolve_truncation(
    damaged: Option<GgSessionTruncation>,
    end: Option<EndLine>,
    entries: u64,
    last_seq: Option<u64>,
) -> Option<GgSessionTruncation> {
    let Some(end) = end else {
        return Some(damaged.unwrap_or(GgSessionTruncation {
            reason: GgSessionTruncationReason::SessionKilled,
            last_seq,
            bytes: None,
        }));
    };
    if end.entries != entries {
        return Some(GgSessionTruncation {
            reason: GgSessionTruncationReason::CorruptJournal,
            last_seq,
            // The recorder's byte figure survives: it is still the honest answer to "how
            // much was written", which the count mismatch says nothing about.
            bytes: end.truncation.and_then(|truncation| truncation.bytes),
        });
    }
    end.truncation
}

/// A [corruption](GgSessionTruncationReason::CorruptJournal) that kept everything up to
/// `last_seq`.
fn corrupt_at(last_seq: Option<u64>) -> GgSessionTruncation {
    GgSessionTruncation {
        reason: GgSessionTruncationReason::CorruptJournal,
        last_seq,
        bytes: None,
    }
}

/// Require a pool line to land at the pool's next free index.
///
/// The redundancy between the line's declared index and its position is the whole gap
/// detector: a pool that skips would shift every later reference by one, so an entry
/// asking for message 7 would be handed message 6's body — a record that reads as
/// complete and describes a conversation that never happened.
fn expect_next_index(journal: &Path, pool: &str, index: u32, next: u64) -> Result<()> {
    if u64::from(index) == next {
        return Ok(());
    }
    Err(journal_error(
        journal,
        format!(
            "has a gap in its {pool} pool: a line claims index {index} but {next} {pool} \
             entries have been read, so every later reference would resolve to the wrong body"
        ),
    ))
}

/// Require every pool reference an entry makes to point at a body already read.
///
/// A journal writes an entry's newly interned bodies immediately before the entry itself,
/// so a forward reference cannot happen in a well-formed journal — which is exactly why
/// one that does happen means the journal is not the journal it claims to be, and is
/// refused rather than served as a record whose consumers index out of bounds.
///
/// The match is exhaustive on purpose: a new [entry kind](GgSessionEntryKind) carrying a
/// pool reference must be added here, and the compiler is what says so.
fn check_entry_references(
    journal: &Path,
    segments: &Segments,
    entry: &GgSessionEntry,
) -> Result<()> {
    let check = |pool: &str, index: u32, len: u64| -> Result<()> {
        if u64::from(index) < len {
            return Ok(());
        }
        Err(journal_error(
            journal,
            format!(
                "has a dangling reference: the entry at seq {} names {pool} {index}, but only \
                 {len} have been read",
                entry.seq
            ),
        ))
    };
    let request = |request: &crate::gg_session_record::GgSessionRequest| -> Result<()> {
        for message in &request.messages {
            check("message", *message, segments.messages.count)?;
        }
        if let Some(toolset) = request.toolset {
            check("toolset", toolset, segments.toolsets.count)?;
        }
        Ok(())
    };
    match &entry.kind {
        GgSessionEntryKind::ModelIo { request: sent, .. }
        | GgSessionEntryKind::ModelError { request: sent, .. } => request(sent)?,
        GgSessionEntryKind::ToolResult { outcome, .. } => {
            check("text", outcome.output, segments.texts.count)?;
            if let Some(summary) = outcome.summary {
                check("text", summary, segments.texts.count)?;
            }
        }
        GgSessionEntryKind::PromptFrame { items } => {
            for item in items {
                check("message", item.message, segments.messages.count)?;
            }
        }
        GgSessionEntryKind::Shell { command, .. } | GgSessionEntryKind::Git { command } => {
            check("text", command.stdout, segments.texts.count)?;
            check("text", command.stderr, segments.texts.count)?;
        }
        GgSessionEntryKind::CancelProbe { .. } | GgSessionEntryKind::Clock { .. } => {}
    }
    Ok(())
}

/// A journal that cannot be assembled, named by path so a run's warning says *which*
/// journal — a stage's error is the only place this surfaces.
fn journal_error(journal: &Path, detail: impl Into<String>) -> Error {
    Error::GgSessionJournal {
        path: journal.display().to_string(),
        detail: detail.into(),
    }
}

// ---------------------------------------------------------------------------
// Segment files
// ---------------------------------------------------------------------------

/// A scratch directory on the **same volume as `output`**, removed when it drops.
///
/// Deriving the location from the output rather than accepting it (or reaching for
/// [`std::env::temp_dir`]) is the enforcement of R17: segments cost the journal's size
/// again, and the only directory known to have room for that is the one the run tree is
/// already being written into.
fn scratch_beside(output: &Path) -> Result<TempDir> {
    let parent = output.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;
    Ok(tempfile::Builder::new()
        .prefix(".replay-assembly-")
        .tempdir_in(parent)?)
}

/// One JSON array of the record, accumulated as its serialized elements — commas and all,
/// but without the enclosing brackets — in a scratch file.
///
/// Holding the *serialized* form rather than the values is what bounds memory: an element
/// is written the moment its journal line is read and is never held again.
struct Segment {
    /// The open scratch file, buffered because elements are small and numerous.
    writer: BufWriter<File>,
    /// How many elements have been written — the array's length, and (for a pool) the
    /// next index a line may claim.
    count: u64,
}

impl Segment {
    /// Create an empty segment file named `name` under `dir`.
    ///
    /// Opened for reading as well as writing: the same handle is rewound and copied
    /// into the artifact once the walk is done, so the file is never reopened by path
    /// (and cannot be swapped underneath the assembly between the two).
    fn create(dir: &Path, name: &str) -> Result<Self> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(dir.join(name))?;
        Ok(Self {
            writer: BufWriter::new(file),
            count: 0,
        })
    }

    /// Append `value` as the array's next element.
    fn push<T: Serialize>(&mut self, value: &T) -> Result<()> {
        if self.count > 0 {
            self.writer.write_all(b",")?;
        }
        serde_json::to_writer(&mut self.writer, value)?;
        self.count += 1;
        Ok(())
    }

    /// Flush the segment and hand back its file, rewound for reading.
    fn rewind(self) -> Result<File> {
        let mut file = self
            .writer
            .into_inner()
            .map_err(|err| Error::Io(err.into_error()))?;
        file.rewind()?;
        Ok(file)
    }
}

/// The six arrays of an assembled record, one segment file each.
struct Segments {
    /// The message pool.
    messages: Segment,
    /// The offered-toolset pool.
    toolsets: Segment,
    /// The text pool.
    texts: Segment,
    /// The [clip](crate::gg_session_record::GgSessionTextClip) table: which texts are clips.
    clips: Segment,
    /// The input log.
    entries: Segment,
}

impl Segments {
    /// Create the five empty segment files under `dir`.
    fn create(dir: &Path) -> Result<Self> {
        Ok(Self {
            messages: Segment::create(dir, "messages")?,
            toolsets: Segment::create(dir, "toolsets")?,
            texts: Segment::create(dir, "texts")?,
            clips: Segment::create(dir, "clips")?,
            entries: Segment::create(dir, "entries")?,
        })
    }
}

// ---------------------------------------------------------------------------
// Writing the document
// ---------------------------------------------------------------------------

/// Stream the record to `output` as gzipped compact JSON, returning its size on disk.
///
/// The document is written **field by field** rather than by serializing a
/// [`GgSessionRecord`](crate::gg_session_record::GgSessionRecord), because the whole point of the
/// segments is that the arrays never exist in memory at once — and `serde_json` has no way
/// to emit an array from a file. The cost of that is a hand-written object, so the field
/// set is pinned by a test against what the record itself serializes; a field added to the
/// record without being added here fails it.
fn write_record(
    output: &Path,
    header: &JournalHeader,
    provenance: &Provenance,
    segments: Segments,
    truncation: Option<&GgSessionTruncation>,
) -> Result<u64> {
    let file = File::create(output)?;
    let mut out = GzEncoder::new(BufWriter::new(file), Compression::default());

    out.write_all(b"{")?;
    write_field(&mut out, "formatVersion", &header.format_version)?;
    out.write_all(b",")?;
    write_field(&mut out, "recorder", &header.recorder)?;
    out.write_all(b",")?;
    write_field(&mut out, "sessionId", &header.session_id)?;
    out.write_all(b",")?;
    write_field(&mut out, "capabilitySet", &header.capability_set)?;
    // The provenance the walk folded out of the journal's `Seed`/`Agent` lines. Both are
    // written as values rather than as segments because both are bounded by the run's shape
    // rather than its length, and both are supersedable (see `Provenance`). A journal that
    // carried neither — every journal a pre-M7.5 gg wrote — yields an empty envelope and an
    // empty table, which is what `#[serde(default)]` means on the record: a reader asks the
    // table whether an agent row exists, never the format version.
    out.write_all(b",")?;
    write_field(&mut out, "seed", &provenance.seed)?;
    out.write_all(b",")?;
    write_field(&mut out, "agents", &provenance.agents)?;

    for (name, segment) in [
        ("messages", segments.messages),
        ("toolsets", segments.toolsets),
        ("texts", segments.texts),
        ("clips", segments.clips),
        ("entries", segments.entries),
    ] {
        write!(out, ",\"{name}\":[")?;
        std::io::copy(&mut segment.rewind()?, &mut out)?;
        out.write_all(b"]")?;
    }

    if let Some(truncation) = truncation {
        out.write_all(b",")?;
        write_field(&mut out, "truncation", truncation)?;
    }
    out.write_all(b"}")?;

    let mut written = out.finish()?;
    written.flush()?;
    Ok(written.get_ref().metadata()?.len())
}

/// Write one `"name":<json>` pair, with the value serialized compactly.
fn write_field<W: Write, T: Serialize>(out: &mut W, name: &str, value: &T) -> Result<()> {
    write!(out, "\"{name}\":")?;
    serde_json::to_writer(&mut *out, value)?;
    Ok(())
}

#[cfg(test)]
#[path = "gg_session_assembly.test.rs"]
mod tests;
