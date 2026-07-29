import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type {
  GgCapabilitySet,
  GgReplayRecord,
  GgReplayStep,
} from "@test-cabinet/run-record/gg";
import { useBackend } from "../../../../client/context";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { routes } from "../../../routes";
import {
  deriveReplaySteps,
  readCall,
  readDid,
  readOutcome,
  readSaw,
  type ReplayToolCall,
} from "./replaySteps";
import runExec from "../RunExec.module.scss";
import styles from "./GgReplayView.module.scss";

// The step-through replay debug view (`/runs/gg/:runId/replay`, consoles only). This
// is DEBUG TOOLING, not a normal result surface: replay capture is opt-in and off by
// default, so it is reached only from a finished gg run whose recorded capability set
// had the `replay` capability on. It fetches the run's stored replay record
// (`GET /runs/{id}/replay`), derives the per-agent step-through model
// ({@link deriveReplaySteps}, the client mirror of the Rust `steps()` derivation),
// and lets a developer walk exactly what each agent SAW (its model request — the
// prompt/context) and DID (the model response + tool calls, each paired with its
// recorded result), stepping forward/back, jumping, and filtering to one agent to
// follow it through a deep agent tree. A dense, information-rich layout is right here:
// clarity over polish.

const numberFmt = new Intl.NumberFormat("en-US");

type LoadState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; record: GgReplayRecord };

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
      .then((record) => {
        if (cancelled) return;
        setLoad(record ? { kind: "ready", record } : { kind: "empty" });
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
        comment={<>// debug-only: step through what each agent saw and did</>}
        arg={runId ?? ""}
      />

      <p className={styles.debugNote}>
        Debug tooling. Replay reconstructs a captured run step for step from its
        recorded model I/O and tool results — it is not part of the run&apos;s
        result surface.{" "}
        {runId && (
          <Link to={routes.runDetail(runId)}>Back to the run</Link>
        )}
        .
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
          No replay record for this run. Replay is a debug-only capability that is
          off by default — this run was not captured for replay.
        </p>
      )}
      {load.kind === "error" && (
        <p className={`${runExec.notice} ${runExec.error}`}>
          Could not load the replay record: {load.message}
        </p>
      )}
      {load.kind === "ready" && <ReplayStepper record={load.record} />}
    </PageLayout>
  );
}

// The loaded step-through surface: the capability-set header, the agent filter/tree,
// the playback controls, and the current step (what one agent saw and did).
function ReplayStepper({ record }: { record: GgReplayRecord }) {
  const steps = useMemo(() => deriveReplaySteps(record), [record]);

  // The distinct agents in first-appearance (global-`seq`) order, each with its step
  // count — the filter/tree that lets a developer follow one agent through the run.
  const agents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const step of steps) {
      counts.set(step.agentId, (counts.get(step.agentId) ?? 0) + 1);
    }
    return [...counts.entries()].map(([id, count]) => ({ id, count }));
  }, [steps]);

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
      <ReplayHeader record={record} stepCount={steps.length} agentCount={agents.length} />

      {/* The agent filter/tree: All, then one entry per agent with its step count. */}
      <div className={styles.agentBar} role="tablist" aria-label="Filter by agent">
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
          All agents{" "}
          <span className={styles.agentCount}>{steps.length}</span>
        </button>
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={agentFilter === a.id}
            className={styles.agentChip}
            data-active={agentFilter === a.id ? "" : undefined}
            onClick={() => {
              setAgentFilter(a.id);
              setCursor(0);
            }}
          >
            {a.id === "root" ? "root" : a.id}{" "}
            <span className={styles.agentCount}>{a.count}</span>
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

// The record header: the session id and a compact read-out of the recorded capability
// set (the run's exact configuration) — so a replay is self-describing.
function ReplayHeader({
  record,
  stepCount,
  agentCount,
}: {
  record: GgReplayRecord;
  stepCount: number;
  agentCount: number;
}) {
  return (
    <div className={styles.header}>
      <div className={styles.headerRow}>
        <span className={styles.headerKey}>session</span>
        <code className={styles.headerVal}>{record.sessionId}</code>
      </div>
      <div className={styles.headerRow}>
        <span className={styles.headerKey}>captured</span>
        <span className={styles.headerVal}>
          {numberFmt.format(stepCount)} model turn
          {stepCount === 1 ? "" : "s"} across {numberFmt.format(agentCount)} agent
          {agentCount === 1 ? "" : "s"}
        </span>
      </div>
      <CapabilityLine set={record.capabilitySet} />
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

// One step: which agent, what it SAW (the model request — messages + offered tools),
// what it DID (the response text + tool calls), and each tool call's recorded RESULT.
function StepView({
  step,
  showAgent,
}: {
  step: GgReplayStep;
  showAgent: boolean;
}) {
  const saw = readSaw(step.saw);
  const did = readDid(step.did);
  const synthetic = step.saw == null && step.did == null;

  return (
    <div className={styles.step}>
      <div className={styles.stepTitle}>
        {showAgent && (
          <span className={styles.stepAgent}>
            {step.agentId === "root" ? "root" : step.agentId}
          </span>
        )}
        <span className={styles.stepSeq}>seq {step.seq}</span>
        {synthetic && (
          <span className={styles.stepSynthetic}>
            orphan tool result (no model turn)
          </span>
        )}
      </div>

      <div className={styles.panes}>
        {/* SAW: the request the agent was given this turn. */}
        <section className={styles.pane}>
          <h3 className={styles.paneTitle}>
            Saw <span className={styles.paneSub}>the model request</span>
          </h3>
          {step.saw == null ? (
            <p className={styles.empty}>No request (synthetic step).</p>
          ) : (
            <>
              <div className={styles.messages}>
                {saw.messages.length === 0 ? (
                  <p className={styles.empty}>No messages.</p>
                ) : (
                  saw.messages.map((m, i) => (
                    <div
                      key={i}
                      className={styles.message}
                      data-role={m.role}
                    >
                      <span className={styles.msgRole}>{m.role}</span>
                      <div className={styles.msgBody}>
                        {m.content != null && (
                          <pre className={styles.msgContent}>{m.content}</pre>
                        )}
                        {m.toolCalls.map((tc, j) => (
                          <ToolCallLine key={j} call={tc} />
                        ))}
                        {m.toolCallId && (
                          <span className={styles.msgMeta}>
                            answers call {m.toolCallId}
                          </span>
                        )}
                        {m.content == null &&
                          m.toolCalls.length === 0 &&
                          !m.toolCallId && (
                            <span className={styles.msgMeta}>(empty)</span>
                          )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {saw.tools.length > 0 && (
                <details className={styles.tools}>
                  <summary>
                    {saw.tools.length} tool
                    {saw.tools.length === 1 ? "" : "s"} offered
                  </summary>
                  <ul className={styles.toolList}>
                    {saw.tools.map((t) => (
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

        {/* DID: the response the model produced this turn. */}
        <section className={styles.pane}>
          <h3 className={styles.paneTitle}>
            Did <span className={styles.paneSub}>the model response</span>
          </h3>
          {did == null ? (
            <p className={styles.empty}>No response (synthetic step).</p>
          ) : (
            <div className={styles.response}>
              {did.text ? (
                <pre className={styles.msgContent}>{did.text}</pre>
              ) : (
                <p className={styles.empty}>No assistant text.</p>
              )}
              {did.toolCalls.length > 0 && (
                <div className={styles.respCalls}>
                  <span className={styles.respCallsLabel}>
                    called {did.toolCalls.length} tool
                    {did.toolCalls.length === 1 ? "" : "s"}
                  </span>
                  {did.toolCalls.map((tc, i) => (
                    <ToolCallLine key={i} call={tc} />
                  ))}
                </div>
              )}
              <div className={styles.respMeta}>
                {did.finishReason && (
                  <span>
                    <span className={styles.respMetaKey}>finish</span>
                    {did.finishReason}
                  </span>
                )}
                {typeof did.usage?.totalTokens === "number" && (
                  <span>
                    <span className={styles.respMetaKey}>tokens</span>
                    {numberFmt.format(did.usage.totalTokens)}
                  </span>
                )}
              </div>
            </div>
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
          step.toolResults.map((tr, i) => {
            const call = readCall(tr.call);
            const outcome = readOutcome(tr.outcome);
            return (
              <div key={i} className={styles.result}>
                <div className={styles.resultHead}>
                  <span
                    className={styles.resultStatus}
                    data-ok={outcome.ok === false ? undefined : ""}
                  >
                    {outcome.ok === false ? "error" : "ok"}
                  </span>
                  <code className={styles.resultName}>{call.name}</code>
                  {call.id && (
                    <span className={styles.msgMeta}>{call.id}</span>
                  )}
                </div>
                {call.arguments != null &&
                  !(
                    typeof call.arguments === "object" &&
                    Object.keys(call.arguments as object).length === 0
                  ) && (
                    <pre className={styles.args}>
                      {JSON.stringify(call.arguments, null, 2)}
                    </pre>
                  )}
                {outcome.summary && (
                  <p className={styles.resultSummary}>{outcome.summary}</p>
                )}
                <pre className={styles.output}>{outcome.output}</pre>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

// A single tool call line: the tool name and its arguments, shown inline under an
// assistant message or a response's called-tools list.
function ToolCallLine({ call }: { call: ReplayToolCall }) {
  const hasArgs =
    call.arguments != null &&
    !(
      typeof call.arguments === "object" &&
      Object.keys(call.arguments as object).length === 0
    );
  return (
    <div className={styles.callLine}>
      <span className={styles.callName}>
        <code>{call.name}</code>
      </span>
      {hasArgs && (
        <pre className={styles.args}>
          {JSON.stringify(call.arguments, null, 2)}
        </pre>
      )}
    </div>
  );
}
