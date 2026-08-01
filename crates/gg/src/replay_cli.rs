//! The **shared command-line front end** for a passive replay reconstruction: reading a
//! [replay record](GgReplayRecord) off disk, driving it through the
//! [replay driver](crate::replay_driver), and reporting what came back.
//!
//! Two binaries reconstruct records, and they must agree to the character on what a
//! reconstruction *says*:
//!
//! - **`gg replay --record <FILE>`** — gg reconstructing a record it (or a build like it) wrote.
//!   This is the entrypoint that makes the old-binary path possible at all: a record whose inputs a
//!   newer gg no longer understands can be handed back to the gg that recorded it, and the only way
//!   that works is if every published gg can be asked to replay.
//! - **`tcab gg-replay [RUN_ID] | --record <FILE>`** — the developer-facing entrypoint, which
//!   additionally resolves a record out of the backend and can delegate the whole reconstruction to
//!   an older `gg` via `--gg`.
//!
//! When `tcab` delegates, its output is the *older binary's* output — so if the two front ends
//! diverged, the same record would summarize differently depending on which binary happened to run
//! it, and a developer comparing two reconstructions would be reading a difference in the reporter
//! rather than in the run. Hence one module, in the crate both binaries link.
//!
//! # Reading a record
//!
//! [`read_record`] accepts the two shapes a record is actually found in. A run tree holds
//! `replay.json.gz` (the [run-tree artifact convention](test_cabinet_core::gg_replay)), while
//! `GET /runs/{id}/replay` serves plain JSON to a client that does not advertise gzip. Sniffing the
//! gzip magic rather than trusting the file extension means a record replays from wherever it was
//! obtained, including a file somebody renamed. Both formats — [v1](
//! test_cabinet_core::gg_replay::GG_REPLAY_FORMAT_V1) and v2 — arrive through one type, because a
//! v1 body is upgraded into the v2 shape as it deserializes.

use std::io::Write;
use std::path::Path;

use anyhow::{Context, bail};
use test_cabinet_core::gg_replay::GgReplayRecord;

use crate::replay_driver::ReplayReconstruction;

/// How one reconstruction describes itself in its own output.
///
/// Everything here is presentation: which program is speaking, where the record came from, and
/// where (if anywhere) the step-through is written. The reconstruction itself is a pure function of
/// the record.
#[derive(Debug, Clone)]
pub struct ReplayReport<'a> {
    /// How the running program names itself — `gg replay`, `tcab gg-replay`. Prefixed to the
    /// opening line so a delegated reconstruction says plainly which binary produced it.
    pub program: &'a str,
    /// Where the record was read from, for the opening line: a file path, or a run id and the
    /// backend it came from.
    pub source: &'a str,
    /// Where to write the reconstructed per-agent step-through list as JSON — what a debugging UI
    /// renders. `None` reports only the telemetry and the summary.
    pub steps: Option<&'a Path>,
}

/// Read a replay record from `path`, transparently gunzipping a gzipped one.
///
/// The two byte shapes are distinguishable with certainty (a JSON document never begins
/// `0x1f 0x8b`), which is what lets this take the file as it is found rather than requiring the
/// caller to have unpacked it first — the run tree's copy is `replay.json.gz`, and asking a
/// developer to `gunzip` before every reconstruction is a step whose only purpose is to be
/// forgotten.
pub fn read_record(path: &Path) -> anyhow::Result<GgReplayRecord> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("reading the replay record at {}", path.display()))?;
    parse_record(&bytes).with_context(|| format!("parsing the replay record at {}", path.display()))
}

/// Parse a replay record from raw bytes, gunzipping first when they are a gzip member.
///
/// A record from a **newer** gg is refused by the deserializer rather than read partially:
/// reconstructing a session from an incomplete understanding of its inputs is worse than not
/// reconstructing it.
pub fn parse_record(bytes: &[u8]) -> anyhow::Result<GgReplayRecord> {
    Ok(serde_json::from_slice(&decompressed(bytes)?)?)
}

/// Gunzip `bytes` when they are a gzip member, otherwise hand them back unchanged.
///
/// Sniffed by the two-byte gzip magic (RFC 1952 §2.3.1) rather than by file extension or by a
/// `Content-Encoding` header, neither of which survives a record being moved around. The two shapes
/// cannot be confused: a JSON document never begins `0x1f 0x8b`.
///
/// Public because `tcab gg-replay --gg <VERSION>` needs the *bytes* rather than the parsed record —
/// it hands them to an older binary, and re-serializing a parsed record would hand that binary a
/// **v2 document**, having silently upgraded away the very v1 shape it was resolved to read.
pub fn decompressed(bytes: &[u8]) -> anyhow::Result<Vec<u8>> {
    if !bytes.starts_with(&[0x1f, 0x8b]) {
        return Ok(bytes.to_vec());
    }
    let mut out = Vec::new();
    std::io::Read::read_to_end(
        &mut flate2::read::GzDecoder::new(std::io::Cursor::new(bytes)),
        &mut out,
    )
    .context("decompressing the gzipped replay record")?;
    Ok(out)
}

/// Reconstruct `record` and report it on `out`, writing the step-through list when one was asked
/// for.
///
/// The reconstruction streams the run's telemetry to **stdout** on its own (the same NDJSON channel
/// a live gg run emits on); `out` carries only the human-facing frame around it, and is injected so
/// a test can read what a reconstruction said without capturing the process's stdout.
pub fn reconstruct_and_report(
    record: GgReplayRecord,
    report: &ReplayReport<'_>,
    out: &mut dyn Write,
) -> anyhow::Result<ReplayReconstruction> {
    reconstruct_and_report_with_sink(record, report, out, Box::new(crate::telemetry::StdoutSink))
}

/// [`reconstruct_and_report`], but streaming the reconstructed telemetry to an arbitrary `sink` —
/// so a test can read what the front end *says* without the run's NDJSON going to the process's
/// stdout alongside it. Mirrors the driver's own
/// [`reconstruct`](crate::replay_driver::reconstruct) / `reconstruct_with_sink` pair.
pub(crate) fn reconstruct_and_report_with_sink(
    record: GgReplayRecord,
    report: &ReplayReport<'_>,
    out: &mut dyn Write,
    sink: Box<dyn crate::telemetry::EventSink>,
) -> anyhow::Result<ReplayReconstruction> {
    let ReplayReport {
        program,
        source,
        steps,
    } = report;

    writeln!(
        out,
        "{program}: reconstructing session `{}` from {source} ({} recorded input(s))",
        record.session_id,
        record.entries.len(),
    )?;
    if let Some(version) = &record.recorder.gg_version {
        writeln!(out, "  recorded by gg {version}")?;
    }
    if record.captured_before_v2() {
        writeln!(
            out,
            "  the record was captured by an older gg (format v{}); the inputs that format had no \
             seam for — model errors, gg's own subprocesses, the turn-boundary probes — are absent \
             from it rather than from the run.",
            record.upgraded_from.unwrap_or_default(),
        )?;
    }

    // The reconstruction re-emits the run's telemetry to stdout as it walks the agent tree. A
    // divergence (a recorded response/tool result missing for a step) stops it with a precise error
    // — the gap the record failed to pin — rather than a silently mis-reconstructed run.
    let reconstruction = match crate::replay_driver::reconstruct_with_sink(record, sink) {
        Ok(reconstruction) => reconstruction,
        Err(err) => bail!("the replay record does not reconstruct: {err}"),
    };

    writeln!(
        out,
        "\nreconstructed {} step(s): {} model turn(s) ({} failed call(s)), {} tool result(s), {} \
         subprocess(es), across {} agent(s).",
        reconstruction.steps.len(),
        reconstruction.model_calls,
        reconstruction.model_errors,
        reconstruction.tool_calls,
        reconstruction.commands,
        reconstruction.agent_count,
    )?;

    if let Some(path) = steps {
        let json = serde_json::to_string_pretty(&reconstruction.steps)
            .context("serializing the reconstructed step-through list")?;
        std::fs::write(path, json)
            .with_context(|| format!("writing the step-through list to {}", path.display()))?;
        writeln!(out, "  step-through written to {}", path.display())?;
    }

    Ok(reconstruction)
}

#[cfg(test)]
#[path = "replay_cli.test.rs"]
mod tests;
