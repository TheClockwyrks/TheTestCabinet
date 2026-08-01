//! `tcab gg-replay` — reconstruct a **gg** run from a captured replay record.
//!
//! Replay is gg's [debugging tool](https://docs.testcabinet.ai/gg/replay/): every run pins its
//! non-deterministic inputs — each agent's model I/O, every tool result, gg's own subprocesses, the
//! turn-boundary probes — into a replay record (the
//! [`replay`](test_cabinet_core::gg::CAPABILITY_REPLAY) capability only escalates the
//! [fidelity](test_cabinet_core::gg_replay::GgReplayFidelity)). This command feeds that record to
//! gg's [`replay_driver`](test_cabinet_gg::replay_driver), which re-runs the session's turn loop
//! from the record with **no live model and no real tools**: it re-emits the reconstructed telemetry
//! (the same NDJSON stream a live run emits) and yields the per-agent step-through a developer
//! walks.
//!
//! It is debug-only: it does not seed a workspace, launch a container, or produce a scored run. If
//! the record is incomplete — a turn wants a model response or tool outcome the record never pinned
//! — the driver reports the exact gap rather than guessing, which is precisely what replay exists to
//! expose.
//!
//! # What this reads
//!
//! Both formats, through one type. [`GgReplayRecord`] **upgrades** a
//! [v1](test_cabinet_core::gg_replay::GG_REPLAY_FORMAT_V1) body — the flat shape gg wrote before
//! pooling, and still what `GET /runs/{id}/replay` serves for every run captured before the change —
//! into the pooled v2 shape as it deserializes, so a record from either era reconstructs here. A
//! record from a **newer** gg is refused by that same deserializer rather than read partially:
//! reconstructing a session from an incomplete understanding of its inputs is worse than not
//! reconstructing it.

use anyhow::{Context, bail};
use test_cabinet_core::gg_replay::GgReplayRecord;

use crate::cli::GgReplayArgs;

/// Load the replay record at `--record`, reconstruct the run (streaming the reconstructed telemetry
/// to stdout), and print a summary — optionally writing the step-through list to `--steps`.
pub async fn execute(args: GgReplayArgs) -> anyhow::Result<()> {
    let raw = std::fs::read_to_string(&args.record)
        .with_context(|| format!("reading the replay record at {}", args.record.display()))?;

    let record: GgReplayRecord = serde_json::from_str(&raw)
        .with_context(|| format!("parsing the replay record at {}", args.record.display()))?;

    println!(
        "tcab gg-replay: reconstructing session `{}` from {} ({} recorded input(s))",
        record.session_id,
        args.record.display(),
        record.entries.len(),
    );
    if record.captured_before_v2() {
        println!(
            "  the record was captured by an older gg (format v{}); the inputs that format had no \
             seam for — model errors, gg's own subprocesses, the turn-boundary probes — are absent \
             from it rather than from the run.",
            record.upgraded_from.unwrap_or_default(),
        );
    }

    // The reconstruction re-emits the run's telemetry to stdout as it walks the agent tree. A
    // divergence (a recorded response/tool result missing for a step) stops it with a precise error
    // — the gap the record failed to pin — rather than a silently mis-reconstructed run.
    let reconstruction = match test_cabinet_gg::replay_driver::reconstruct(record) {
        Ok(reconstruction) => reconstruction,
        Err(err) => bail!("the replay record does not reconstruct: {err}"),
    };

    println!(
        "\nreconstructed {} step(s): {} model turn(s) ({} failed call(s)), {} tool result(s), {} \
         subprocess(es), across {} agent(s).",
        reconstruction.steps.len(),
        reconstruction.model_calls,
        reconstruction.model_errors,
        reconstruction.tool_calls,
        reconstruction.commands,
        reconstruction.agent_count,
    );

    if let Some(path) = &args.steps {
        let json = serde_json::to_string_pretty(&reconstruction.steps)
            .context("serializing the reconstructed step-through list")?;
        std::fs::write(path, json)
            .with_context(|| format!("writing the step-through list to {}", path.display()))?;
        println!("  step-through written to {}", path.display());
    }

    Ok(())
}
