import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { GgConfigInput } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { BackChevron } from "../../components/BackChevron";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { routes } from "../../routes";
import { GgConfigEditor } from "../runs/gg/GgConfigEditor";
import {
  agentSaveError,
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  draftSaveError,
  emptyDraft,
  resetCapabilitiesForMode,
  type GgConfigDraft,
} from "../runs/gg/ggConfigDraft";
import { builtInDraft } from "../runs/gg/useGgConfigs";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// What a configuration looked like when it was loaded (or last saved), as the one string
// the dirty check compares against. The capability set is serialized because that is the
// form the configuration is actually stored in — it ignores the editor's internal ids and
// the order the agents happen to sit in, so reopening and closing a configuration without
// touching it never counts as a change.
function snapshotOf(name: string, description: string, draft: GgConfigDraft) {
  return JSON.stringify({
    name: name.trim(),
    description: description.trim(),
    set: capabilitySetFromDraft(draft, null),
  });
}

// What the operator is told they would lose. Kept out of the handler so the confirm text
// is one thing, said the same way wherever navigation is intercepted.
const UNSAVED_CHANGES =
  "This gg configuration has unsaved changes. Leave without saving them?";

// The gg configuration editor (`/account/gg/new` and `/account/gg/:configId/edit`):
// a configuration's name, its one-line purpose, and the capability set itself.
// Save creates or updates and returns to the gg tab.
//
// The page has two modes, because the editor does: on the **configuration** it shows the
// identity fields and the Save button, and while an **agent** is open it shows neither —
// an agent is saved (or cancelled) back onto the configuration first, and only the
// configuration itself is written to the account. That is also what keeps a
// configuration-level complaint ("the `reviewer` agent defers to no declared slot") off
// the screen while a different agent is being edited.
//
// A configuration is deliberately test-case-free and need not bind a model: the New
// run page supplies the case and binds the primary slot from its own model picker,
// so one configuration serves a whole sweep. Console-only; gated on a signed-in
// account.
export function GgConfigEditPage() {
  const { configId } = useParams();
  const editing = Boolean(configId);
  const [params] = useSearchParams();
  // `?from=builtin:<name>` / `?from=saved:<id>` seeds a new configuration from an
  // existing one — how the list page's Duplicate action works.
  const from = params.get("from");
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<GgConfigDraft>(() => emptyDraft());
  // What the form held when it was loaded — the baseline the unsaved-changes prompt
  // measures against.
  const [saved, setSaved] = useState<string | null>(null);
  // Which agent's view is open, and the whole draft as it was when it opened: cancelling
  // an agent restores that, which is what makes Cancel mean something on a form that
  // edits a single draft in place.
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentSnapshot, setAgentSnapshot] = useState<GgConfigDraft | null>(
    null,
  );

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    // Seed the form and take the baseline the unsaved-changes prompt measures against —
    // whatever the form opened on is, by definition, unedited.
    const seed = (
      nextName: string,
      nextDescription: string,
      nextDraft: GgConfigDraft,
    ) => {
      setName(nextName);
      setDescription(nextDescription);
      setDraft(nextDraft);
      setSaved(snapshotOf(nextName, nextDescription, nextDraft));
    };
    // A built-in seed needs no round-trip; everything else reads the account's
    // stored configurations (to load the one being edited, or the one duplicated).
    const seedBuiltIn = from?.startsWith("builtin:")
      ? builtInDraft(from.slice("builtin:".length))
      : null;
    if (seedBuiltIn) {
      seed(`${from!.slice("builtin:".length)} (copy)`, "", seedBuiltIn);
      setLoading(false);
    } else if (!editing && !from) {
      seed("", "", emptyDraft());
      setLoading(false);
    } else {
      Promise.resolve(backend.listGgConfigs?.(token) ?? [])
        .then((configs) => {
          if (!active) return;
          const wantedId = editing
            ? configId
            : from?.startsWith("saved:")
              ? from.slice("saved:".length)
              : undefined;
          const found = configs.find((c) => c.id === wantedId);
          if (!found) {
            setError("That configuration no longer exists.");
          } else {
            seed(
              editing ? found.name : `${found.name} (copy)`,
              found.description,
              draftFromCapabilitySet(found.capabilitySet),
            );
          }
          setLoading(false);
        })
        .catch((e) => {
          if (!active) return;
          setError(String(e));
          setLoading(false);
        });
    }
    backend
      .listModels()
      .then((ms) => active && setModels(ms))
      .catch(() => {
        // The model catalog is optional; the slot pickers stay free-text.
      });
    return () => {
      active = false;
    };
  }, [backend, token, editing, configId, from]);

  const structuralError = draftSaveError(draft);
  const savable = name.trim().length > 0 && structuralError === null && !busy;
  // Only what is wrong with the open agent — a configuration-level complaint about some
  // other agent is not this view's business, and cannot be fixed from it.
  const agentError = editingAgentId
    ? agentSaveError(draft, editingAgentId)
    : null;

  const dirty = useMemo(
    () => saved !== null && snapshotOf(name, description, draft) !== saved,
    [saved, name, description, draft],
  );

  // Leaving with unsaved work needs a confirmation, whichever way the operator leaves:
  // the page's own back control (below) and a full-page navigation (here). A React Router
  // navigation triggered outside this page cannot be intercepted under a `BrowserRouter`
  // — there is no data router to block on — so the back control is deliberately the one
  // in-app exit and is guarded directly.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const confirmLeave = useCallback(
    () => !dirty || window.confirm(UNSAVED_CHANGES),
    [dirty],
  );

  // Opening an agent banks the draft so Cancel has something to restore; saving the agent
  // simply keeps the edits already applied and returns to the configuration.
  function onEditingAgentChange(agentId: string | null) {
    setAgentSnapshot(agentId ? draft : null);
    setEditingAgentId(agentId);
  }
  function cancelAgent() {
    if (agentSnapshot) setDraft(agentSnapshot);
    setAgentSnapshot(null);
    setEditingAgentId(null);
  }
  // Saving an agent keeps the edits already applied and returns to the configuration —
  // and commits its **type**: what the other types were configured with was scratch
  // space the editor held so that switching type and back lost nothing, and an agent
  // that has been saved carries the configuration of the type it was saved under and no
  // other. Winding it back here is what makes reopening the agent and switching type
  // show that type's defaults, exactly as it would after a reload (the save path writes
  // no capability the agent's type does not read).
  function saveAgent() {
    if (agentError) return;
    setDraft((current) => ({
      ...current,
      agents: current.agents.map((a) =>
        a.id === editingAgentId ? resetCapabilitiesForMode(a) : a,
      ),
    }));
    setAgentSnapshot(null);
    setEditingAgentId(null);
  }

  async function onSave() {
    if (!token || !savable) return;
    const input: GgConfigInput = {
      name: name.trim(),
      description: description.trim(),
      // A saved configuration records its own name as the `preset` facet, so every
      // run launched from it is sliceable by which configuration produced it.
      capabilitySet: capabilitySetFromDraft(draft, name.trim()),
    };
    setBusy(true);
    setError(null);
    try {
      if (editing && configId && backend?.updateGgConfig) {
        await backend.updateGgConfig(configId, input, token);
      } else if (backend?.createGgConfig) {
        await backend.createGgConfig(input, token);
      }
      navigate(routes.accountGgConfigs());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const openAgent = draft.agents.find((a) => a.id === editingAgentId);
  const header = (
    <header className={styles.detailHeader}>
      <div className={styles.detailTitleRow}>
        <BackChevron
          to={routes.accountGgConfigs()}
          label="All gg configurations"
          guard={confirmLeave}
        />
        <h1 className={styles.detailTitle}>
          {openAgent
            ? `${openAgent.name.trim() || "Agent"} — agent`
            : editing
              ? name || "Configuration"
              : "New gg configuration"}
        </h1>
      </div>
    </header>
  );

  if (!token) {
    return (
      <PageLayout>
        {header}
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to edit gg configurations — they are saved to your account.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {header}

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <LoadingState label="Loading…" />
      ) : (
        <>
          {/* The configuration's identity belongs to the configuration: while an agent
              is open these are not what is being edited, so they are not shown. */}
          {!editingAgentId && (
            <div className={exec.fields}>
              <label className={exec.field}>
                <span className={exec.fieldLabel}>Configuration name</span>
                <input
                  className={exec.input}
                  type="text"
                  value={name}
                  placeholder="e.g. no-compaction"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className={exec.field}>
                <span className={exec.fieldLabel}>Description (optional)</span>
                <input
                  className={exec.input}
                  type="text"
                  value={description}
                  placeholder="what this arm is for"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            </div>
          )}

          <GgConfigEditor
            value={draft}
            onChange={setDraft}
            editingAgentId={editingAgentId}
            onEditingAgentChange={onEditingAgentChange}
            models={models}
          />

          <div className={exec.actions}>
            <div className={exec.actionsEnd}>
              {editingAgentId ? (
                <>
                  {agentError && (
                    <span className={exec.muted}>{agentError}</span>
                  )}
                  <button
                    type="button"
                    className={exec.secondary}
                    onClick={cancelAgent}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={exec.primary}
                    onClick={saveAgent}
                    disabled={agentError !== null}
                  >
                    Save agent
                  </button>
                </>
              ) : (
                <>
                  {structuralError && (
                    <span className={exec.muted}>{structuralError}</span>
                  )}
                  <button
                    type="button"
                    className={exec.primary}
                    onClick={onSave}
                    disabled={!savable}
                  >
                    {busy
                      ? "Saving…"
                      : editing
                        ? "Save configuration"
                        : "Create configuration"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
