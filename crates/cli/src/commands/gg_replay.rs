//! `tcab gg-replay` — reconstruct a **gg** run from a captured replay record.
//!
//! Replay is gg's [debugging tool](https://docs.testcabinet.ai/gg/replay/): a run with the `replay`
//! capability on pins its two non-deterministic inputs — each agent's model I/O and every tool
//! result — into a `.gg/replay.json` record. This command feeds that record to gg's
//! [`replay_driver`](test_cabinet_gg::replay_driver), which re-runs the session's turn loop from the
//! record with **no live model and no real tools**: it re-emits the reconstructed telemetry (the
//! same NDJSON stream a live run emits) and yields the per-agent step-through a developer walks.
//!
//! It is debug-only: it does not seed a workspace, launch a container, or produce a scored run. If
//! the record is incomplete — a turn wants a model response or tool outcome the record never pinned
//! — the driver reports the exact gap rather than guessing, which is precisely what replay exists to
//! expose.

use anyhow::{Context, bail};
use test_cabinet_core::gg::GgReplayRecordV1;

use crate::cli::GgReplayArgs;

/// Load the replay record at `--record`, reconstruct the run (streaming the reconstructed telemetry
/// to stdout), and print a summary — optionally writing the step-through list to `--steps`.
pub async fn execute(args: GgReplayArgs) -> anyhow::Result<()> {
    let raw = std::fs::read_to_string(&args.record)
        .with_context(|| format!("reading the replay record at {}", args.record.display()))?;
    let record: GgReplayRecordV1 = serde_json::from_str(&raw)
        .with_context(|| format!("parsing the replay record at {}", args.record.display()))?;

    println!(
        "tcab gg-replay: reconstructing session `{}` from {} ({} recorded input(s))",
        record.session_id,
        args.record.display(),
        record.entries.len(),
    );

    // The reconstruction re-emits the run's telemetry to stdout as it walks the agent tree. A
    // divergence (a recorded response/tool result missing for a step) stops it with a precise error
    // — the gap the record failed to pin — rather than a silently mis-reconstructed run.
    let reconstruction = match test_cabinet_gg::replay_driver::reconstruct(&record) {
        Ok(reconstruction) => reconstruction,
        Err(err) => bail!("the replay record does not reconstruct: {err}"),
    };

    println!(
        "\nreconstructed {} step(s): {} model turn(s), {} tool result(s), across {} agent(s).",
        reconstruction.steps.len(),
        reconstruction.model_calls,
        reconstruction.tool_calls,
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
