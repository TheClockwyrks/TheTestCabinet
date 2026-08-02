//! `tcab gg-playback` — re-run a recorded **gg** session through the *real* turn loop.
//!
//! This is the front end for gg's [playback](test_cabinet_gg::playback), and it is deliberately not
//! the same command as [`gg-replay`](super::gg_replay). Replay walks a record passively and shows
//! you the transcript; a playback *drives the loop* with only the model call and the shell answered
//! from the record and every other side effect performed for real. A session that took half an hour
//! reconstructs in seconds, with no API key set and no provider reachable, and the question it
//! answers is the one a transcript viewer cannot: **does this build of gg still produce that
//! session?**
//!
//! # What this prints, and what it exits with
//!
//! One human report on stdout, ending in the line every consumer reads:
//!
//! ```text
//! FAITHFUL: yes  (exit 0, strictness exact, ordering seq)
//! ```
//!
//! and the [exit code](test_cabinet_gg::playback::PlaybackReport::exit_code) carries the mode as
//! well as the verdict — `0` faithful, `1` exact-and-diverged, `2` reconstructed under `shape`,
//! `3` under `none` — so a CI script that checks `== 0` cannot mistake a relaxed reconstruction for
//! a clean one, which is precisely the mistake a mode reached for to unblock a red build invites.
//!
//! # The report is written whatever happened
//!
//! `--report` is written on every path that reached a reconstruction at all, **including** the one
//! where a fatal divergence stopped it. That is the whole error design of the library surfacing
//! here: a fatal divergence comes back as a report carrying what stopped it rather than as an error
//! that throws the report away, because the divergences found before the stop are exactly what the
//! developer ran the playback for.
//!
//! # The workspace
//!
//! A playback builds in an **empty** directory and refuses a non-empty one, which is the single
//! guardrail between its real `write_file` and `git` writes and a collected run's produced tree.
//! With no `--workspace` this command builds in a temporary directory and removes it afterwards:
//! the products of a playback are the report and the telemetry stream, not the tree — and a tree
//! whose recorded shell commands did not run is missing everything a command would have created,
//! so it must never be fed to produced-code analysis.
//!
//! One thing that tree picks up is **its own capture journal**: gg's capture is always on and a
//! reconstruction runs the real loop, so a playback records itself. This command neither suppresses
//! it nor announces it, which is the decision rather than an oversight — suppressing it would mean
//! reconstructing under a configuration the recorded run did not have, and announcing it would put
//! a line in every report to describe a file that the default invocation deletes moments later.
//! Under `--workspace` it stays, and it is a perfectly good record: a reconstruction's inputs are as
//! worth pinning as a run's, and it assembles and plays back like any other.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::Context;
use serde::Serialize;
use test_cabinet_core::gg::{GgAgentStatus, GgSessionSummary};
use test_cabinet_core::gg_replay::{GgFingerprintComponent, GgReplayRecord};
use test_cabinet_gg::playback::drift::{Drift, DriftKind, Strictness};
use test_cabinet_gg::playback::shell::MissPolicy;
use test_cabinet_gg::playback::{AgentOutcome, Ordering, Playback, PlaybackReport};

use crate::cli::{GgPlaybackArgs, OrderingArg, StrictnessArg};
use crate::commands::gg_replay::RecordSource;

/// How the program names itself in the reconstruction's output.
const PROGRAM: &str = "tcab gg-playback";

/// Load the record (by run id or from `--record`), reconstruct the session, write the report and
/// the telemetry, and hand back the exit code the reconstruction earned.
pub async fn execute(args: GgPlaybackArgs) -> anyhow::Result<ExitCode> {
    let source = RecordSource::new(args.run_id.as_deref(), args.record.as_deref())?;
    let record = source.load().await?;

    // A temporary workspace is bound for the whole reconstruction and dropped at the end of it, so
    // the "removed afterwards" promise is kept by the type rather than by a cleanup call that an
    // early return could skip.
    let scratch = match args.workspace {
        Some(_) => None,
        None => Some(tempfile::TempDir::new().context("creating a temporary playback workspace")?),
    };
    let workspace = match (&args.workspace, &scratch) {
        (Some(path), _) => path.clone(),
        // A named child rather than the temporary directory itself: the playback's own guard
        // refuses a directory that is not empty, and a `TempDir` that some other tool has already
        // dropped a file into would be refused for a reason nobody could act on.
        (None, Some(scratch)) => scratch.path().join("playback"),
        (None, None) => unreachable!("a workspace is either named or temporary"),
    };

    print_banner(&source.label(), &record, &workspace, &args);

    let mut playback = Playback::new(record, &workspace)
        .strictness(strictness(args.strictness))
        .ordering(ordering(args.ordering));
    if let Some(miss) = miss_policy(&args) {
        playback = playback.miss_policy(miss);
    }
    let report = playback.run().await?;

    // Written before anything is printed, so a report exists even if a broken pipe kills the
    // rendering half-way — and so the "report written to …" line is only printed once it is true.
    if let Some(path) = args.events.as_deref() {
        write_events(path, &report)?;
    }
    if let Some(path) = args.report.as_deref() {
        write_report(path, &report, args.ordering)?;
    }

    print_report(&report, &args);
    Ok(ExitCode::from(exit_byte(report.exit_code())))
}

/// The opening lines: what is being reconstructed, where, and by whose record.
///
/// The recorder block is printed before the reconstruction rather than after because it is what
/// explains a surprising result. A record written by a different gg than the one running is the
/// single most common reason a reconstruction diverges everywhere at once, and reading that fact
/// *first* saves the reader from interpreting a wall of drift as a regression.
fn print_banner(label: &str, record: &GgReplayRecord, workspace: &Path, args: &GgPlaybackArgs) {
    println!(
        "{PROGRAM}: reconstructing {label} in {}",
        workspace.display()
    );
    match record.recorder.gg_version.as_deref() {
        Some(version) => println!("  recorded by gg {version}"),
        None => println!("  the record does not say which gg wrote it"),
    }
    println!(
        "  {} recorded inputs across {} agent(s), {:?} fidelity",
        record.entries.len(),
        record.agents.len(),
        record.fidelity,
    );
    println!(
        "  strictness {}, ordering {}{}",
        strictness(args.strictness).label(),
        ordering_label(args.ordering),
        match miss_policy(args) {
            Some(MissPolicy::Execute) => ", unrecorded commands EXECUTED",
            Some(MissPolicy::Stop) => ", unrecorded commands fatal",
            _ => "",
        },
    );
    println!();
}

/// The divergences, the components that moved, each agent's ending, and the verdict.
fn print_report(report: &PlaybackReport, args: &GgPlaybackArgs) {
    if report.divergences.is_empty() {
        println!("divergences: none");
    } else {
        println!("divergences: {}", report.divergences.len());
        for drift in &report.divergences {
            println!("  {drift}");
            // The rendered prompt region, indented under the divergence that carries it. This is
            // the answer to "what did I break?", and it is the reason a `system` drift is worth
            // more than a line saying the system prompt moved.
            if let Some(diff) = &drift.diff {
                for line in diff.lines() {
                    println!("      {line}");
                }
            }
        }
    }

    // The fingerprint components that moved, deduplicated, in the matrix's own order — the single
    // most diagnostic line in the report, because a component names *which* half of prompt
    // construction changed.
    let components = moved_components(&report.divergences);
    if !components.is_empty() {
        println!("components: {}", components.join(", "));
    }
    if let Some(stopped) = &report.stopped_on {
        println!("stopped on: {stopped}");
    }

    println!("agents:");
    for agent in &report.agents {
        println!(
            "  {} (profile {}) recorded={} reconstructed={}",
            agent.agent_id,
            agent.profile,
            status(agent.recorded),
            status(agent.reconstructed),
        );
    }

    if let Some(path) = args.report.as_deref() {
        println!("report written to {}", path.display());
    }
    if let Some(path) = args.events.as_deref() {
        println!(
            "{} telemetry event(s) written to {}",
            report.events.len(),
            path.display()
        );
    }

    println!();
    println!(
        "FAITHFUL: {}  (exit {}, strictness {}, ordering {})",
        if report.faithful { "yes" } else { "no" },
        report.exit_code(),
        report.strictness.label(),
        ordering_label(args.ordering),
    );
}

/// The distinct fingerprint components that moved, in the drift matrix's own order —
/// message count, system, tools, conversation — because that is the order of informativeness the
/// comparison itself uses, and a report that listed them in detection order would bury the most
/// telling one behind its consequences.
pub fn moved_components(divergences: &[Drift]) -> Vec<&'static str> {
    const ORDER: [GgFingerprintComponent; 4] = [
        GgFingerprintComponent::Messages,
        GgFingerprintComponent::System,
        GgFingerprintComponent::Tools,
        GgFingerprintComponent::Conversation,
    ];
    ORDER
        .into_iter()
        .filter(|component| {
            divergences
                .iter()
                .any(|drift| drift.kind == DriftKind::Fingerprint(*component))
        })
        .map(|component| DriftKind::Fingerprint(component).label())
        .collect()
}

/// How an agent status reads in the per-agent table, with the absent case spelled out rather than
/// printed as `None`: an agent the reconstruction never produced and an agent whose loop never
/// ended are different things, and both are worth saying in words.
fn status(status: Option<GgAgentStatus>) -> &'static str {
    match status {
        Some(GgAgentStatus::Running) => "running",
        Some(GgAgentStatus::Blocked) => "blocked",
        Some(GgAgentStatus::Done) => "done",
        Some(GgAgentStatus::Failed) => "failed",
        None => "(none)",
    }
}

/// The library strictness a `--strictness` value selects.
fn strictness(arg: StrictnessArg) -> Strictness {
    match arg {
        StrictnessArg::Exact => Strictness::Exact,
        StrictnessArg::Shape => Strictness::Shape,
        StrictnessArg::None => Strictness::None,
    }
}

/// The library ordering a `--ordering` value selects.
fn ordering(arg: OrderingArg) -> Ordering {
    match arg {
        OrderingArg::Seq => Ordering::Seq,
        OrderingArg::Free => Ordering::Free,
    }
}

/// How an ordering names itself in the report. Not derived from `Debug`, because this string is
/// read by a person and printed beside the flag they typed.
fn ordering_label(arg: OrderingArg) -> &'static str {
    match arg {
        OrderingArg::Seq => "seq",
        OrderingArg::Free => "free",
    }
}

/// The miss policy the two escape flags select, or `None` to leave the library's default
/// (synthesize a classified failure and carry on) in place.
///
/// The flags are mutually exclusive at the clap level, so the impossible combination never reaches
/// here.
pub fn miss_policy(args: &GgPlaybackArgs) -> Option<MissPolicy> {
    match (args.execute_unrecorded, args.stop_on_unrecorded) {
        (true, _) => Some(MissPolicy::Execute),
        (_, true) => Some(MissPolicy::Stop),
        _ => None,
    }
}

/// The process exit code, narrowed to the byte [`ExitCode`] carries.
///
/// The library's codes are 0–3, so the clamp is defensive rather than load-bearing — but a future
/// code that wrapped to 0 would silently report a diverged reconstruction as a faithful one, which
/// is the one mistake this command must never make.
fn exit_byte(code: i32) -> u8 {
    u8::try_from(code).unwrap_or(u8::MAX)
}

/// Write the reconstruction's telemetry as NDJSON — the same shape a live run's stream has, so
/// whatever reads one reads this.
fn write_events(path: &Path, report: &PlaybackReport) -> anyhow::Result<()> {
    let mut out = String::new();
    for event in &report.events {
        out.push_str(&serde_json::to_string(event).context("serializing a telemetry event")?);
        out.push('\n');
    }
    write_file(path, &out)
}

/// Write the divergence report as JSON.
fn write_report(path: &Path, report: &PlaybackReport, ordering: OrderingArg) -> anyhow::Result<()> {
    let file = PlaybackReportFile::new(report, ordering);
    let json = serde_json::to_string_pretty(&file).context("serializing the playback report")?;
    write_file(path, &format!("{json}\n"))
}

/// Write `contents` to `path`, creating the parent directory when it is named but absent.
fn write_file(path: &Path, contents: &str) -> anyhow::Result<()> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::write(path, contents).with_context(|| format!("writing {}", path.display()))
}

/// The JSON `--report` document.
///
/// A CLI artifact rather than a cross-language contract type: nothing in the TypeScript workspace
/// reads it, and registering it as a contract type would publish a schema for a debugging tool's
/// output. Its shape mirrors the library's
/// [report](test_cabinet_gg::playback::PlaybackReport) with the telemetry stream left out — that
/// is what `--events` is for, and inlining several megabytes of events into a document whose point
/// is the verdict would make the verdict hard to find.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackReportFile<'a> {
    /// The reconstructed session's id (the record's).
    session_id: &'a str,
    /// The one boolean every consumer reads.
    faithful: bool,
    /// The exit code this reconstruction earned, so a script that captured the report but not the
    /// process status still has it.
    exit_code: i32,
    /// The mode it ran under. Stamped beside `faithful` because a relaxed reconstruction that is
    /// mistaken for a clean one is the single most misleading thing this command can produce.
    strictness: &'a str,
    /// Whether recorded inputs were served under the ordering barrier.
    ordering: &'a str,
    /// The directory it built in.
    workspace: PathBuf,
    /// Every divergence, in detection order.
    divergences: Vec<DriftOut<'a>>,
    /// The first fatal divergence — what the reconstruction stopped on.
    stopped_on: Option<DriftOut<'a>>,
    /// The fingerprint components that moved, deduplicated.
    components: Vec<&'static str>,
    /// Each recorded agent's ending beside the reconstructed one.
    agents: Vec<AgentOut<'a>>,
    /// How many telemetry events the reconstruction emitted (the events themselves go to
    /// `--events`).
    event_count: usize,
    /// The terminal session summary, when the reconstruction reached one.
    summary: Option<&'a GgSessionSummary>,
}

impl<'a> PlaybackReportFile<'a> {
    /// Project the library's report into the document.
    fn new(report: &'a PlaybackReport, ordering: OrderingArg) -> Self {
        Self {
            session_id: &report.session_id,
            faithful: report.faithful,
            exit_code: report.exit_code(),
            strictness: report.strictness.label(),
            ordering: ordering_label(ordering),
            workspace: report.workspace.clone(),
            divergences: report.divergences.iter().map(DriftOut::new).collect(),
            stopped_on: report.stopped_on.as_ref().map(DriftOut::new),
            components: moved_components(&report.divergences),
            agents: report.agents.iter().map(AgentOut::new).collect(),
            event_count: report.events.len(),
            summary: report.summary.as_ref(),
        }
    }
}

/// One divergence, as the report document carries it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DriftOut<'a> {
    /// The stable, machine-readable kind — `system`, `tool-result`, `deadlock`, …
    kind: &'static str,
    /// The recorded agent it is attributed to, empty for a session-level finding.
    agent_id: &'a str,
    /// A self-contained sentence naming what diverged.
    detail: &'a str,
    /// Whether it stopped the reconstruction.
    fatal: bool,
    /// The rendered first differing region of the two system prompts, for a `system` drift.
    #[serde(skip_serializing_if = "Option::is_none")]
    diff: Option<&'a str>,
}

impl<'a> DriftOut<'a> {
    /// Project one ledger entry.
    fn new(drift: &'a Drift) -> Self {
        Self {
            kind: drift.kind.label(),
            agent_id: &drift.agent_id,
            detail: &drift.detail,
            fatal: drift.fatal,
            diff: drift.diff.as_deref(),
        }
    }
}

/// One agent's recorded ending beside its reconstructed one, as the report document carries it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentOut<'a> {
    /// The recorded agent's id.
    agent_id: &'a str,
    /// The profile it ran under.
    profile: &'a str,
    /// How it ended in the recorded run.
    recorded: Option<GgAgentStatus>,
    /// How it ended in the reconstruction.
    reconstructed: Option<GgAgentStatus>,
}

impl<'a> AgentOut<'a> {
    /// Project one comparison.
    fn new(agent: &'a AgentOutcome) -> Self {
        Self {
            agent_id: &agent.agent_id,
            profile: &agent.profile,
            recorded: agent.recorded,
            reconstructed: agent.reconstructed,
        }
    }
}

#[cfg(test)]
#[path = "gg_playback.test.rs"]
mod tests;
