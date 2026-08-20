import {
  BLOCKING_HOOK_EVENTS,
  AUTHORED_HOOK_TIMEOUT_SECS,
  GG_BUILTIN_HOOK_HINTS,
  GG_BUILTIN_HOOK_IDS,
  HOOK_DECISION_CONTRACT,
  HOOK_KINDS,
  HOOK_OUTPUT_OPTIONS,
  hookEventsForScope,
  type GgHookScope,
} from "./ggCatalog";
import { FieldLabel } from "./GgCapabilityFields";
import { blankHookDraft, type GgHookDraft } from "./ggConfigDraft";
import runExec from "../RunExec.module.scss";
import gg from "./GgConfigEditor.module.scss";

/**
 * A hook list and its Add button, for one of the two declaration sites.
 *
 * Both sites render this — the configuration's session hooks and an agent's own — because
 * a hook is authored the same way wherever it is declared. What differs is only which
 * events are on offer, which is exactly what [scope](GgHookScope) selects: the run may
 * declare the two session events, an agent the other eight. An operator is never shown an
 * event the site cannot hold, so a hook can never be authored into the list gg would
 * refuse it in.
 */
export function GgHookList({
  hooks,
  scope,
  readOnly,
  onChange,
  emptyNote,
}: {
  hooks: ReadonlyArray<GgHookDraft>;
  scope: GgHookScope;
  readOnly: boolean;
  onChange: (next: GgHookDraft[]) => void;
  /** What to say when there are none, in this site's terms ("No session hooks."). */
  emptyNote: string;
}) {
  const patch = (id: string, next: Partial<GgHookDraft>) =>
    onChange(
      hooks.map((hook) => (hook.id === id ? { ...hook, ...next } : hook)),
    );
  const remove = (id: string) =>
    onChange(hooks.filter((hook) => hook.id !== id));
  const add = () => onChange([...hooks, blankHookDraft(scope)]);

  return (
    <>
      {hooks.length === 0 ? (
        <p className={runExec.muted}>{emptyNote}</p>
      ) : (
        <div className={gg.hookList}>
          {hooks.map((hook) => (
            <HookRow
              key={hook.id}
              hook={hook}
              scope={scope}
              readOnly={readOnly}
              onPatch={(next) => patch(hook.id, next)}
              onRemove={() => remove(hook.id)}
            />
          ))}
        </div>
      )}
      {!readOnly && (
        <button type="button" className={runExec.secondary} onClick={add}>
          Add hook
        </button>
      )}
    </>
  );
}

/**
 * One hook's card: the event it fires at, which of the three kinds it is, and the fields
 * that kind needs.
 *
 * A card, and not a run of fields, because a hook is several controls and a list of them
 * is several hooks: without a border to say where one ends, an operator reading down the
 * list cannot tell which Command belongs to which Event. It wears the same panel a model
 * slot and a machine's state wear, which is this form's vocabulary for "one record".
 *
 * Every kind's fields are held in the draft at once and only the current kind's are
 * rendered, so switching kind and switching back does not lose what was typed. The
 * blocking note under the event picker is read off a table rather than off the `pre-`
 * prefix, because `pre-compact` is a `pre-` event that deliberately cannot block — and a
 * gate an operator believes they have is worse than no gate at all.
 */
function HookRow({
  hook,
  scope,
  readOnly,
  onPatch,
  onRemove,
}: {
  hook: GgHookDraft;
  scope: GgHookScope;
  readOnly: boolean;
  onPatch: (patch: Partial<GgHookDraft>) => void;
  onRemove: () => void;
}) {
  const events = hookEventsForScope(scope);
  const event = events.find((e) => e.value === hook.event);
  const kind = HOOK_KINDS.find((k) => k.value === hook.kind);
  const blocks = BLOCKING_HOOK_EVENTS.includes(hook.event);
  return (
    <div className={gg.hookRow}>
      <div className={gg.hookHeading}>
        <label className={`${runExec.field} ${gg.hookField}`}>
          <FieldLabel
            label="Event"
            hint={event?.hint ?? "Which point of the run this hook fires at."}
          />
          <select
            className={runExec.input}
            value={hook.event}
            disabled={readOnly}
            onChange={(e) =>
              onPatch({ event: e.target.value as GgHookDraft["event"] })
            }
          >
            {/* A hook stored against the other site's event — only reachable from a
                configuration hand-edited on the wire — keeps its own value as an option
                rather than silently reading as the first event in the list. gg will
                refuse it, and the operator can see what to change. */}
            {!event && <option value={hook.event}>{hook.event}</option>}
            {events.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${runExec.field} ${gg.hookField}`}>
          <FieldLabel
            label="Kind"
            hint={
              kind?.hint ??
              "What this hook runs, and how gg reads what came back."
            }
          />
          <select
            className={runExec.input}
            value={hook.kind}
            disabled={readOnly}
            onChange={(e) =>
              onPatch({ kind: e.target.value as GgHookDraft["kind"] })
            }
          >
            {HOOK_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${runExec.field} ${gg.hookField}`}>
          <FieldLabel
            label="Name"
            hint="An operator's label, shown wherever gg reports this hook running or blocking. Optional — gg falls back to describing what it runs."
          />
          <input
            className={runExec.input}
            value={hook.name}
            disabled={readOnly}
            placeholder="e.g. build must pass"
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </label>
        {!readOnly && (
          // The same ✕ every other removable record in this form carries (a model slot,
          // an agent, a machine's state), so "get rid of this one" is one control an
          // operator learns once. Its accessible name says which hook, because a list of
          // them presents several.
          <button
            type="button"
            className={gg.slotRemove}
            onClick={onRemove}
            aria-label={`Remove the ${hook.name.trim() || event?.label || hook.event} hook`}
          >
            ✕
          </button>
        )}
      </div>

      {/* An annotation on the event picked above, not a section: it takes the card's own
          gap and nothing more. */}
      <p className={gg.hookBlocking}>
        {blocks
          ? "This event can be blocked: a hook that refuses stops the operation, and the reason it gives is what the model reads."
          : "This event cannot be blocked — whatever the hook says, the operation goes ahead."}
      </p>

      {hook.kind === "command" && (
        <div className={gg.limitGrid}>
          <label className={gg.capParamField}>
            <FieldLabel
              label="Command"
              hint="The command line, run through `sh -c`. It receives no input from gg."
            />
            <input
              className={runExec.input}
              value={hook.command}
              disabled={readOnly}
              placeholder="e.g. npm test"
              onChange={(e) => onPatch({ command: e.target.value })}
            />
          </label>
          <label className={gg.capParamField}>
            <FieldLabel
              label="Working directory"
              hint="Relative to gg's working directory, or absolute. Blank runs it in the agent's workspace root — which for an agent working in an isolated worktree is that worktree."
            />
            <input
              className={runExec.input}
              value={hook.cwd}
              disabled={readOnly}
              placeholder="the workspace root"
              onChange={(e) => onPatch({ cwd: e.target.value })}
            />
          </label>
          <label className={gg.capParamField}>
            <FieldLabel
              label="Timeout (seconds)"
              hint="How long it may run before it is killed. Required: gg has no ceiling of its own to run a hook that declares none under, so a new hook opens on a generous figure — a hook command is typically a build or a test suite — and you keep it or change it."
            />
            <input
              className={runExec.input}
              type="number"
              min={0}
              value={hook.timeoutSecs}
              disabled={readOnly}
              placeholder={String(AUTHORED_HOOK_TIMEOUT_SECS)}
              onChange={(e) => onPatch({ timeoutSecs: e.target.value })}
            />
          </label>
          <label className={gg.capParamField}>
            <FieldLabel
              label="Output mode"
              hint="How much of the output comes back inline and what happens to the rest. Blank follows the agent's own shell configuration, which is almost always what you mean."
            />
            <select
              className={runExec.input}
              value={hook.output}
              disabled={readOnly}
              onChange={(e) => onPatch({ output: e.target.value })}
            >
              {HOOK_OUTPUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {hook.kind === "built-in" && (
        <label className={gg.capParamField}>
          <FieldLabel
            label="Script"
            hint={
              GG_BUILTIN_HOOK_HINTS[hook.script] ??
              "One of gg's own hook scripts."
            }
          />
          <select
            className={runExec.input}
            value={hook.script}
            disabled={readOnly}
            onChange={(e) => onPatch({ script: e.target.value })}
          >
            {GG_BUILTIN_HOOK_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      )}

      {hook.kind === "custom" && (
        <label className={gg.capParamField}>
          <FieldLabel
            label="Script"
            hint="Run with the event as its sole argument, a JSON string. A `#!` line chooses the interpreter; without one it is run by `sh`. It must exit 0 and print one decision object on stdout — a non-zero exit or unreadable output is the hook itself failing, which stops the run."
          />
          <textarea
            className={runExec.input}
            rows={8}
            value={hook.source}
            disabled={readOnly}
            placeholder={
              '#!/bin/sh\n# $1 is the event, as JSON.\necho \'{"action":"continue"}\''
            }
            onChange={(e) => onPatch({ source: e.target.value })}
          />
          <p className={runExec.muted}>
            Print exactly one of:
            <code className={gg.hookContract}>{HOOK_DECISION_CONTRACT}</code>
          </p>
        </label>
      )}
    </div>
  );
}
