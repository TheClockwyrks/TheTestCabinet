import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import { useBackend } from "../../../../client/context";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { routes } from "../../../routes";
import { formatCost } from "./GgOverviewWidgets";
import { MessageRow } from "./RequestsView";
import { ExpandablePre } from "./MessageOverlay";
import {
  buildLegacyReplayWalk,
  buildReplayWalk,
  contextSummary,
  truncationNotice,
  type ReplayContextItem,
  type ReplayStep,
  type ReplayText,
  type ReplayToolResult,
  type ReplayWalk,
} from "./replayModel";
import panels from "./GgPanels.module.scss";
import runExec from "../RunExec.module.scss";
import styles from "./GgReplayView.module.scss";

// The step-through Replay view (`/runs/gg/:runId/replay`, consoles only).
//
// Every gg run is captured (see gg/replay), so this is reachable from any gg run rather
// than only from one somebody thought to switch recording on for — which was the whole
// problem with the debug-only capture it replaces, since a surprising outcome is by
// definition not one anybody predicted. It fetches the run's stored record
// (`GET /runs/{id}/replay`), resolves it into the walk model (`replayModel`), and lets a
// developer step through exactly what each agent SAW (the request, message by message,
// with the window position gg recorded for each) and DID (the response and its tool
// calls, each paired with the outcome the run's dispatch returned), stepping
// forward/back, jumping, and filtering to one agent to follow it through a deep tree.
//
// The messages themselves render through the live monitor's own message row rather than
// a second renderer: a replay record and the telemetry message log are the same material
// captured at two fidelities, and two components drawing it would drift.

const numberFmt = new Intl.NumberFormat("en-US");

/**
 * The line under a payload the record kept only part of.
 *
 * Rendered rather than left implicit because the alternative is worse than showing
 * nothing: a reader shown the tail of a forty-megabyte build log with no notice reads it
 * as the whole of what the command printed, and concludes the command printed nothing
 * interesting. It names the escalation that would have kept the whole of it, since
 * "capture it at full fidelity next time" is the only thing to *do* about a clip.
 */
function ClipNotice({ text }: { text: ReplayText }) {
  if (!text.clip) return null;
  return (
    <p className={styles.msgMeta}>
      Clipped: the last {numberFmt.format(text.clip.keptBytes)} of{" "}
      {numberFmt.format(text.clip.originalBytes)} bytes. Enable the{" "}
      <code>replay</code> capability to capture payloads whole.
    </p>
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "empty" }
  // A record written by a newer gg than this app reads. Called out explicitly rather
  // than walked: every format shares its outer field names, so walking one anyway
  // produces a plausible-looking session the reader has no way to tell from a real one.
  // See `StoredGgReplay`.
  | { kind: "newer"; formatVersion: number }
  | { kind: "error"; message: string }
  | { kind: "ready"; walk: ReplayWalk };

export function GgReplayView() {
  const { runId } = useParams<{ runId: string }>();
  const { client } = useBackend();

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!runId) return;
    if (!client?.readGgReplay) {
      setLoad({ kind: "unsupported" });
      return;
    }
    let cancelled = false;
    setLoad({ kind: "loading" });
    client
      .readGgReplay(runId)
      .then((stored) => {
        if (cancelled) return;
        if (!stored) {
          setLoad({ kind: "empty" });
        } else if (stored.format === "newer") {
          setLoad({ kind: "newer", formatVersion: stored.formatVersion });
        } else if (stored.format === "v1") {
          setLoad({
            kind: "ready",
            walk: buildLegacyReplayWalk(stored.record),
          });
        } else {
          setLoad({ kind: "ready", walk: buildReplayWalk(stored.record) });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad({ kind: "error", message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [runId, client]);

  return (
    <PageLayout>
      <PromptHeader
        command="--gg replay"
        comment={<>// step through what each agent saw and did</>}
        arg={runId ?? ""}
      />

      <p className={styles.debugNote}>
        Every gg run records the inputs it consumed — each agent&apos;s model
        I/O, every tool result, and the window gg built for each turn — so a
        finished run can be walked step for step.{" "}
        {runId && <Link to={routes.runDetail(runId)}>Back to the run</Link>}.
      </p>

      {load.kind === "loading" && (
        <p className={`${runExec.notice}`}>Loading the replay record…</p>
      )}
      {load.kind === "unsupported" && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          This backend cannot serve replay records.
        </p>
      )}
      {load.kind === "empty" && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          No replay record for this run. Capture became unconditional in gg
          0.7.0 — a run from before that was recorded only if the{" "}
          <code>replay</code> capability happened to be on.
        </p>
      )}
      {load.kind === "newer" && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          This run&apos;s replay record is in format v{load.formatVersion},
          which this app cannot read yet — it was captured by a newer gg.
          Nothing is wrong with the run or the record; a newer record can hold
          inputs this build has never heard of, and walking it anyway would show
          you a session that reads as complete while silently missing them, so
          it is not walked.
        </p>
      )}
      {load.kind === "error" && (
        <p className={`${runExec.notice} ${runExec.error}`}>
          Could not load the replay record: {load.message}
        </p>
      )}
      {load.kind === "ready" && <ReplayStepper walk={load.walk} />}
    </PageLayout>
  );
}

// The loaded step-through surface: the record header, the agent filter/tree, the
// playback controls, and the current step.
function ReplayStepper({ walk }: { walk: ReplayWalk }) {
  const steps = walk.steps;

  // The current agent filter (null = all agents, interleaved on the global timeline)
  // and the step cursor into the resulting filtered list.
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      agentFilter == null
        ? steps
        : steps.filter((s) => s.agentId === agentFilter),
    [steps, agentFilter],
  );

  const [cursor, setCursor] = useState(0);
  // Keep the cursor in range whenever the filter (and thus the list length) changes.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const current = filtered[cursor] ?? null;
  const atStart = cursor <= 0;
  const atEnd = cursor >= filtered.length - 1;

  // Arrow keys step through, so a developer can walk the run without reaching for the
  // buttons. Scoped to the surface so it never hijacks typing elsewhere.
  const surfaceRef = useRef<HTMLDivElement>(null);
  const step = (delta: number) =>
    setCursor((c) => Math.min(Math.max(0, c + delta), filtered.length - 1));

  return (
    <div
      className={styles.surface}
      ref={surfaceRef}
      tabIndex={0}
      role="group"
      aria-label="Replay step-through"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          step(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          step(-1);
        }
      }}
    >
      {/* What this record can and cannot tell you, before anything derived from it.
          Both notices are statements about the capture rather than errors: the record
          is served either way, and a reader who does not know the difference blames the
          run for a gap in the recording. */}
      {walk.capturedBeforeV2 && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          Captured by an older gg (record format v{walk.capturedFormatVersion}).
          It pins each agent&apos;s model I/O and tool results, and nothing
          else: there are no prompt frames, so the Context column is empty, and
          no agent provenance, seed or compaction-client tagging. Everything
          shown below is what that record holds.
        </p>
      )}
      {walk.truncation && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          {truncationNotice(walk.truncation)}
        </p>
      )}

      <ReplayHeader walk={walk} />

      {/* The agent filter/tree: All, then one entry per agent with its step count. */}
      <div
        className={styles.agentBar}
        role="tablist"
        aria-label="Filter by agent"
      >
        <button
          type="button"
          role="tab"
          aria-selected={agentFilter == null}
          className={styles.agentChip}
          data-active={agentFilter == null ? "" : undefined}
          onClick={() => {
            setAgentFilter(null);
            setCursor(0);
          }}
        >
          All agents <span className={styles.agentCount}>{steps.length}</span>
        </button>
        {walk.agents.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={agentFilter === a.id}
            className={styles.agentChip}
            data-active={agentFilter === a.id ? "" : undefined}
            title={agentTitle(a.profile, a.origin, a.terminalStatus)}
            onClick={() => {
              setAgentFilter(a.id);
              setCursor(0);
            }}
          >
            {a.id}
            {a.profile && (
              <span className={styles.agentProfile}>{a.profile}</span>
            )}{" "}
            <span className={styles.agentCount}>{a.steps}</span>
          </button>
        ))}
      </div>

      {/* Playback controls: first/prev/next/last, a live step counter, and a jump
          slider across the filtered list. */}
      <div className={styles.controls}>
        <div className={styles.buttons}>
          <button type="button" onClick={() => setCursor(0)} disabled={atStart}>
            ⏮ First
          </button>
          <button type="button" onClick={() => step(-1)} disabled={atStart}>
            ← Prev
          </button>
          <button type="button" onClick={() => step(1)} disabled={atEnd}>
            Next →
          </button>
          <button
            type="button"
            onClick={() => setCursor(filtered.length - 1)}
            disabled={atEnd}
          >
            Last ⏭
          </button>
        </div>
        <span className={styles.counter} data-testid="replay-counter">
          <span className={styles.counterStep}>
            {filtered.length === 0
              ? "no steps"
              : `step ${cursor + 1} / ${filtered.length}`}
          </span>
          {current && (
            <span className={styles.counterSeq}> · seq {current.seq}</span>
          )}
        </span>
        {filtered.length > 1 && (
          <input
            className={styles.jump}
            type="range"
            min={0}
            max={filtered.length - 1}
            value={cursor}
            aria-label="Jump to step"
            onChange={(e) => setCursor(Number(e.target.value))}
          />
        )}
      </div>

      {current ? (
        <StepView step={current} showAgent={agentFilter == null} />
      ) : (
        <p className={styles.empty}>No steps for this agent.</p>
      )}
    </div>
  );
}

// An agent chip's tooltip: what the provenance table says about it, when the record
// carries one at all.
function agentTitle(
  profile: string | null,
  origin: string | null,
  terminalStatus: string | null,
): string | undefined {
  const parts = [
    profile && `profile ${profile}`,
    origin,
    terminalStatus && `ended ${terminalStatus}`,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// The record header: what was captured, by which build, at which fidelity, and the
// recorded capability set (the run's exact configuration) — so a record is
// self-describing.
function ReplayHeader({ walk }: { walk: ReplayWalk }) {
  const turns = walk.steps.length;
  const agents = walk.agents.length;
  return (
    <div className={styles.header}>
      <div className={styles.headerRow}>
        <span className={styles.headerKey}>session</span>
        <code className={styles.headerVal}>{walk.sessionId}</code>
      </div>
      <div className={styles.headerRow}>
        <span className={styles.headerKey}>captured</span>
        <span className={styles.headerVal}>
          {numberFmt.format(turns)} model turn{turns === 1 ? "" : "s"} across{" "}
          {numberFmt.format(agents)} agent{agents === 1 ? "" : "s"} ·{" "}
          {walk.fidelity} fidelity
          {walk.recorder.ggVersion ? ` · gg ${walk.recorder.ggVersion}` : ""}
          {walk.recorder.commit ? ` (${walk.recorder.commit.slice(0, 8)})` : ""}
        </span>
      </div>
      <CapabilityLine set={walk.capabilitySet} />
      {walk.prompt && (
        <div className={styles.headerRow}>
          <span className={styles.headerKey}>prompt</span>
          <span className={styles.headerVal}>
            <ExpandablePre
              content={walk.prompt}
              className={styles.seedPrompt}
              label="the session's build prompt"
            />
          </span>
        </div>
      )}
    </div>
  );
}

function CapabilityLine({ set }: { set: GgCapabilitySet }) {
  const agents = set.agents ?? [];
  // The Root agent stands in for the run's headline capabilities on this one-line
  // summary. The models do not: a run binds one per agent profile, and naming only the
  // root's would report a multi-model session as a single-model one. Every distinct
  // model the run bound is listed, in profile order, de-duplicated so the common case
  // (every profile on the same model) still reads as one name.
  const enabled = (agents[0]?.capabilities ?? [])
    .filter((c) => c.enabled)
    .map((c) => c.id);
  const models = [...new Set(agents.map((a) => a.modelId).filter((id) => id))];
  return (
    <div className={styles.headerRow}>
      <span className={styles.headerKey}>config</span>
      <span className={styles.headerVal}>
        {set.preset ? `preset ${set.preset} · ` : ""}
        {enabled.length ? enabled.join(", ") : "no capabilities"}
        {models.length ? ` · ${models.join(", ")}` : ""}
      </span>
    </div>
  );
}

// One step: which agent, what it SAW (the request — each message with the window
// position recorded for it, plus the offered tools), what it DID (the response, or the
// error the call failed with), each tool call's recorded RESULT, and any other input the
// turn consumed.
function StepView({
  step,
  showAgent,
}: {
  step: ReplayStep;
  showAgent: boolean;
}) {
  return (
    <div className={styles.step}>
      <div className={styles.stepTitle}>
        {showAgent && <span className={styles.stepAgent}>{step.agentId}</span>}
        <span className={styles.stepSeq}>seq {step.seq}</span>
        {step.role === "compaction" && (
          <span
            className={styles.stepFlag}
            title="gg's compaction summarizer, not the agent's own turn loop"
          >
            compaction client
          </span>
        )}
        {step.shape === "complete_requiring" && (
          <span
            className={styles.stepFlag}
            title="the model was forced to call the one offered tool"
          >
            required tool
          </span>
        )}
        {step.orphan && (
          <span className={styles.stepSynthetic}>
            orphan input (no model turn to attach to)
          </span>
        )}
      </div>

      <div className={styles.panes}>
        {/* SAW: the request the agent was given this turn. */}
        <section className={styles.pane}>
          <h3 className={styles.paneTitle}>
            Saw <span className={styles.paneSub}>the model request</span>
          </h3>
          {step.request.length === 0 ? (
            <p className={styles.empty}>No request recorded for this step.</p>
          ) : (
            <>
              <ul className={panels.reqMessages}>
                {step.request.map((row) => (
                  <MessageRow
                    key={row.key}
                    message={row.message ?? undefined}
                    source={
                      row.context
                        ? row.context.source
                        : { unattributed: row.message?.role ?? "message" }
                    }
                    context={<ContextCell item={row.context} />}
                  />
                ))}
              </ul>
              {step.tools.length > 0 && (
                <details className={styles.tools}>
                  <summary>
                    {step.tools.length} tool
                    {step.tools.length === 1 ? "" : "s"} offered
                  </summary>
                  <ul className={styles.toolList}>
                    {step.tools.map((t) => (
                      <li key={t.name}>
                        <code>{t.name}</code>
                        {t.description && (
                          <span className={styles.toolDesc}>
                            {" "}
                            — {t.description}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </section>

        {/* DID: the response the model produced this turn — or the error it failed
            with, which v1 dropped entirely even though a vision refusal and a retry
            exhaustion both change what the loop does next. */}
        <section className={styles.pane}>
          <h3 className={styles.paneTitle}>
            Did <span className={styles.paneSub}>the model response</span>
          </h3>
          {step.error ? (
            <div className={styles.modelError}>
              <div className={styles.resultHead}>
                <span className={styles.resultStatus}>{step.error.kind}</span>
                {step.error.status != null && (
                  <span className={styles.msgMeta}>
                    HTTP {step.error.status}
                  </span>
                )}
                {step.error.attempts != null && (
                  <span className={styles.msgMeta}>
                    {step.error.attempts} attempt
                    {step.error.attempts === 1 ? "" : "s"}
                  </span>
                )}
                {step.error.modelId && (
                  <code className={styles.resultName}>
                    {step.error.modelId}
                  </code>
                )}
              </div>
              <pre className={styles.output}>{step.error.message}</pre>
            </div>
          ) : step.response ? (
            <div className={styles.response}>
              <ul className={panels.reqMessages}>
                <MessageRow message={step.response.message} source="reply" />
              </ul>
              <div className={styles.respMeta}>
                {step.response.finishReason && (
                  <span>
                    <span className={styles.respMetaKey}>finish</span>
                    {step.response.finishReason}
                  </span>
                )}
                {step.response.cost != null && (
                  <span>
                    <span className={styles.respMetaKey}>cost</span>
                    {formatCost(step.response.cost)}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className={styles.empty}>No response recorded for this step.</p>
          )}
        </section>
      </div>

      {/* The recorded RESULT of each tool call this turn made. */}
      <section className={styles.results}>
        <h3 className={styles.paneTitle}>
          Tool results{" "}
          <span className={styles.paneSub}>what each call returned</span>
        </h3>
        {step.toolResults.length === 0 ? (
          <p className={styles.empty}>No tool results this turn.</p>
        ) : (
          step.toolResults.map((result) => (
            <ToolResultView key={result.key} result={result} />
          ))
        )}
      </section>

      {/* Everything else the turn consumed: the orchestrator's own `git`, a shell
          command that bypassed tool dispatch, the cancel probe, the deadline clock.
          Each of these changes control flow, and each was invisible in v1. */}
      {step.side.length > 0 && (
        <section className={styles.results}>
          <h3 className={styles.paneTitle}>
            Other inputs{" "}
            <span className={styles.paneSub}>what else this turn consumed</span>
          </h3>
          <ul className={styles.sideList}>
            {step.side.map((entry) => (
              <li key={entry.key} className={styles.sideEntry}>
                {entry.kind === "cancel_probe" ? (
                  <span>
                    <span className={styles.sideKind}>cancel probe</span>
                    {entry.canceled ? "canceled" : "still running"}
                  </span>
                ) : entry.kind === "clock" ? (
                  <span>
                    <span className={styles.sideKind}>clock</span>
                    {numberFmt.format(entry.elapsedMs)} ms elapsed
                    {entry.remainingMs != null &&
                      `, ${numberFmt.format(entry.remainingMs)} ms left`}
                  </span>
                ) : (
                  <>
                    <span>
                      <span className={styles.sideKind}>
                        {entry.kind === "git" ? "git" : entry.origin}
                      </span>
                      <code className={styles.resultName}>
                        {entry.command.command}
                      </code>
                      <span className={styles.msgMeta}>
                        exit {entry.command.exitCode}
                        {entry.command.cwd ? ` · in ${entry.command.cwd}` : ""}
                      </span>
                    </span>
                    {entry.command.stdout.text && (
                      <>
                        <ExpandablePre
                          content={entry.command.stdout.text}
                          className={styles.output}
                          label={`${entry.command.command} stdout`}
                        />
                        <ClipNotice text={entry.command.stdout} />
                      </>
                    )}
                    {entry.command.stderr.text && (
                      <>
                        <ExpandablePre
                          content={entry.command.stderr.text}
                          className={styles.output}
                          label={`${entry.command.command} stderr`}
                        />
                        <ClipNotice text={entry.command.stderr} />
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// The Context column's cell: where this message sat in the agent's window. Ellipsized
// to one line with the whole of it in the row's tooltip, since a paged file view's
// `path@offset+limit` is routinely longer than the column.
//
// A message with no frame behind it gets an em dash rather than a blank — a pre-v2
// record carries no prompt frames at all, and the banner above says so, but a blank cell
// still reads as a rendering gap where a stated absence does not.
function ContextCell({ item }: { item: ReplayContextItem | null }) {
  if (!item) {
    return (
      <span
        className={styles.contextMissing}
        title="this record carries no prompt frame for the turn"
      >
        —
      </span>
    );
  }
  const summary = contextSummary(item);
  return <span title={summary}>{summary}</span>;
}

// One tool call and the outcome the run's dispatch returned for it — the call's
// arguments, its summary line, its output, and any images it produced.
function ToolResultView({ result }: { result: ReplayToolResult }) {
  const hasArgs =
    result.arguments != null &&
    !(
      typeof result.arguments === "object" &&
      Object.keys(result.arguments as object).length === 0
    );
  return (
    <div className={styles.result}>
      <div className={styles.resultHead}>
        <span
          className={styles.resultStatus}
          data-ok={result.ok ? "" : undefined}
        >
          {result.ok ? "ok" : "error"}
        </span>
        <code className={styles.resultName}>{result.name}</code>
        {result.id && <span className={styles.msgMeta}>{result.id}</span>}
        {result.cwd && <span className={styles.msgMeta}>in {result.cwd}</span>}
      </div>
      {hasArgs && (
        <pre className={styles.args}>
          {JSON.stringify(result.arguments, null, 2)}
        </pre>
      )}
      {result.summary && (
        <p className={styles.resultSummary}>{result.summary}</p>
      )}
      <ExpandablePre
        content={result.output.text}
        className={styles.output}
        label={`${result.name} output`}
      />
      <ClipNotice text={result.output} />
      {result.images.length > 0 && (
        <ul className={panels.reqImages}>
          {result.images.map((image, i) => (
            <li key={i} className={panels.reqImage}>
              {image.dataBase64 != null && (
                <img
                  className={panels.reqImageThumb}
                  src={`data:${image.mediaType};base64,${image.dataBase64}`}
                  alt={`${result.name} produced a ${image.mediaType} image`}
                />
              )}
              <span className={panels.reqImageMeta}>{image.mediaType}</span>
            </li>
          ))}
        </ul>
      )}
      {result.failure && (
        <pre className={styles.args}>
          {JSON.stringify(result.failure, null, 2)}
        </pre>
      )}
    </div>
  );
}
