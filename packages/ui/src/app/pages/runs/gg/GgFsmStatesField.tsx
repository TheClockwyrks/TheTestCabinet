// The state-machine editor: the control behind a `states` param, and the one place a
// gg **process** is authored (see gg/fsms).
//
// A machine is a document about ORDER. Its rows are the states, in the order they are
// declared — the first is the one the machine enters — and each row says three things:
// which of the configuration's agent profiles runs while the machine sits there, where
// that agent may go next, and what each of those moves carries with it. Nothing else is
// authored here: a state is not a second place to configure an agent, it BINDS one, so
// the model, the capabilities and the prompt are read off the profile it names.
//
// The transfer checkboxes are the reason the module model exists, so they are on the
// edge rather than on the state: what a successor inherits is a property of the move,
// not of either end of it. They are explicit by contract (a recorded machine has to say
// what it carries), and a new edge opens with History ticked — the common case, still
// written down.

import { MODULE_KINDS } from "./ggCatalog";
import {
  blankStateDraft,
  blankTransitionDraft,
  renameStateDraft,
  type StateDraft,
  type TransitionDraft,
} from "./ggConfigDraft";
import type { GgModuleKind } from "@test-cabinet/run-record/gg";
import runExec from "../RunExec.module.scss";
import gg from "./GgConfigEditor.module.scss";

interface GgFsmStatesFieldProps {
  /** The machine as it stands. Empty is a legitimate half-built state to hold. */
  states: ReadonlyArray<StateDraft>;
  /**
   * The configuration's agent profiles, in editor order — what a state may run.
   * `machine` marks a profile that is itself an FSM shell: it is still offered (a
   * stored machine that names one must round-trip and be *shown* to be wrong rather
   * than silently repointed), and the label says so.
   */
  agents: ReadonlyArray<{
    id: string;
    slug: string;
    name: string;
    machine: boolean;
  }>;
  readOnly: boolean;
  /**
   * What is wrong with the machine, if anything, and what is odd about it — the
   * console's mirror of gg's launch failure and launch warnings, so a machine the
   * editor accepts is one gg will start.
   */
  error?: string | null;
  warnings?: ReadonlyArray<string>;
  onChange: (states: StateDraft[]) => void;
}

export function GgFsmStatesField({
  states,
  agents,
  readOnly,
  error,
  warnings = [],
  onChange,
}: GgFsmStatesFieldProps) {
  // The states a transition may address: the named ones. An unnamed row is not yet a
  // state anything can move to, so offering it would be offering an edge to nowhere.
  const targets = states
    .map((state) => state.name.trim())
    .filter((name) => name.length > 0);

  const patchState = (index: number, patch: Partial<StateDraft>) =>
    onChange(
      states.map((state, i) => (i === index ? { ...state, ...patch } : state)),
    );
  const patchTransition = (
    index: number,
    edgeIndex: number,
    patch: Partial<TransitionDraft>,
  ) =>
    patchState(index, {
      transitions: (states[index]?.transitions ?? []).map((edge, j) =>
        j === edgeIndex ? { ...edge, ...patch } : edge,
      ),
    });

  return (
    <div
      className={`${gg.capParamField} ${gg.fsmField}`}
      role="group"
      aria-label="States"
    >
      <div className={gg.fsmStates}>
        {states.map((state, i) => {
          const entry = i === 0;
          const terminal = state.transitions.length === 0;
          // A state names an agent by profile id, so a rename leaves it pointed where
          // it was. A stored id that matches no profile is kept and shown as missing
          // rather than repointed at whatever happens to be first.
          const runs = agents.find((a) => a.id === state.agentId);
          return (
            <div
              key={i}
              className={gg.fsmState}
              data-entry={entry ? "" : undefined}
            >
              <div className={gg.fsmStateHead}>
                <span className={gg.fsmStateBadge}>
                  {entry ? "entry" : `${i + 1}`}
                </span>
                <input
                  className={`${runExec.input} ${gg.fsmStateName}`}
                  type="text"
                  value={state.name}
                  disabled={readOnly}
                  aria-label={`State ${i + 1} name`}
                  // A rename carries every edge that pointed at the old name, so a
                  // machine cannot be broken halfway through typing a new one.
                  onChange={(e) =>
                    onChange(renameStateDraft(states, i, e.target.value))
                  }
                  placeholder="e.g. explore"
                  spellCheck={false}
                />
                <span className={gg.fsmRuns}>runs</span>
                <select
                  className={`${runExec.select} ${gg.fsmStateAgent}`}
                  value={state.agentId}
                  disabled={readOnly}
                  aria-label={`State ${i + 1} agent`}
                  onChange={(e) => patchState(i, { agentId: e.target.value })}
                >
                  {!runs && (
                    <option value={state.agentId}>
                      {state.agentId
                        ? `${state.agentId} (missing)`
                        : "(pick an agent)"}
                    </option>
                  )}
                  {/* The slug is offered beside the name because two profiles may carry
                      one name — a menu of two identical labels would be a choice the
                      author could not make. The state stores the profile's internal id,
                      which is the option's value and is shown to nobody. */}
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || "unnamed"} ({a.slug}
                      {a.machine ? ", a machine" : ""})
                    </option>
                  ))}
                </select>
                {terminal && (
                  <span
                    className={gg.fsmTerminal}
                    title="No transitions: the machine ends when this agent ends, and its ending is the machine's return value."
                  >
                    terminal
                  </span>
                )}
                {!readOnly && (
                  <>
                    {/* The entry state is a position, not a flag — the same way the
                        root agent is `agents[0]` — so "make this the entry" moves the
                        row to the front rather than setting anything. */}
                    {!entry && (
                      <button
                        type="button"
                        className={runExec.secondary}
                        aria-label={`Make state ${i + 1} the entry state`}
                        onClick={() =>
                          onChange([state, ...states.filter((_, j) => j !== i)])
                        }
                      >
                        Make entry
                      </button>
                    )}
                    <button
                      type="button"
                      className={gg.slotRemove}
                      aria-label={`Remove state ${i + 1}`}
                      // Removing a state takes the edges into it with it: an edge to a
                      // state that no longer exists is a machine gg refuses to launch,
                      // and leaving one behind would make deleting a row break a
                      // different row.
                      onClick={() =>
                        onChange(
                          states
                            .filter((_, j) => j !== i)
                            .map((other) => ({
                              ...other,
                              transitions: other.transitions.filter(
                                (edge) =>
                                  edge.to.trim() !== state.name.trim() ||
                                  !state.name.trim(),
                              ),
                            })),
                        )
                      }
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
              <ul className={gg.fsmTransitions}>
                {state.transitions.map((edge, j) => (
                  <li key={j} className={gg.fsmTransition}>
                    <div className={gg.fsmTransitionHead}>
                      <span className={gg.fsmArrow} aria-hidden="true">
                        →
                      </span>
                      <select
                        className={`${runExec.select} ${gg.fsmTarget}`}
                        value={edge.to}
                        disabled={readOnly}
                        aria-label={`State ${i + 1} transition ${j + 1} target`}
                        onChange={(e) =>
                          patchTransition(i, j, { to: e.target.value })
                        }
                      >
                        {!targets.includes(edge.to) && (
                          <option value={edge.to}>
                            {edge.to
                              ? `${edge.to} (no such state)`
                              : "(pick a state)"}
                          </option>
                        )}
                        {targets.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <input
                        className={`${runExec.input} ${gg.fsmWhen}`}
                        type="text"
                        value={edge.description}
                        disabled={readOnly}
                        aria-label={`State ${i + 1} transition ${j + 1} description`}
                        onChange={(e) =>
                          patchTransition(i, j, { description: e.target.value })
                        }
                        placeholder="when the model should take this edge"
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          className={gg.slotRemove}
                          aria-label={`Remove state ${i + 1} transition ${j + 1}`}
                          onClick={() =>
                            patchState(i, {
                              transitions: state.transitions.filter(
                                (_, k) => k !== j,
                              ),
                            })
                          }
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div
                      className={gg.fsmTransfer}
                      role="group"
                      aria-label={`State ${i + 1} transition ${j + 1} transfer`}
                    >
                      <span className={gg.fsmTransferLabel}>carries</span>
                      {MODULE_KINDS.map((kind) => (
                        <label
                          key={kind.value}
                          className={gg.toggleItem}
                          title={kind.hint}
                        >
                          <input
                            type="checkbox"
                            checked={edge.transfer.includes(kind.value)}
                            disabled={readOnly}
                            onChange={(e) =>
                              patchTransition(i, j, {
                                transfer: nextTransfer(
                                  edge.transfer,
                                  kind.value,
                                  e.target.checked,
                                ),
                              })
                            }
                          />
                          <span>{kind.label}</span>
                        </label>
                      ))}
                      {edge.transfer.length === 0 && (
                        <span className={gg.fsmReset}>
                          carries nothing — the next state starts fresh
                        </span>
                      )}
                    </div>
                  </li>
                ))}
                {!readOnly && (
                  <li>
                    <button
                      type="button"
                      className={runExec.secondary}
                      onClick={() =>
                        patchState(i, {
                          transitions: [
                            ...state.transitions,
                            // Pre-pointed at the next state declared, which is what an
                            // author adding an edge to a linear process means; anything
                            // else is one click on the target picker.
                            blankTransitionDraft(
                              targets.find(
                                (name) => name !== state.name.trim(),
                              ) ?? "",
                            ),
                          ],
                        })
                      }
                    >
                      + Add transition from {state.name.trim() || "this state"}
                    </button>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <button
          type="button"
          className={runExec.secondary}
          onClick={() => onChange([...states, blankStateDraft()])}
        >
          + Add state
        </button>
      )}
      {error && <span className={gg.fieldError}>{error}</span>}
      {warnings.map((warning) => (
        <span key={warning} className={gg.limitWarning}>
          {warning}
        </span>
      ))}
    </div>
  );
}

/** `transfer` with `kind` added (`on`) or removed, kept in the catalog's order. */
function nextTransfer(
  transfer: ReadonlyArray<GgModuleKind>,
  kind: GgModuleKind,
  on: boolean,
): GgModuleKind[] {
  const next = new Set(transfer);
  if (on) next.add(kind);
  else next.delete(kind);
  return MODULE_KINDS.map((k) => k.value).filter((k) => next.has(k));
}
