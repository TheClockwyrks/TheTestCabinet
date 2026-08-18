import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { GgSavedAgentInput } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { ModelCombobox } from "../../components/ModelCombobox";
import { BackChevron } from "../../components/BackChevron";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import { routes } from "../../routes";
import { familyOf } from "../../data/families";
import { GgAgentEditor } from "../runs/gg/GgAgentEditor";
import { HelpTip } from "../runs/gg/GgCapabilityFields";
import {
  draftFromSavedAgent,
  savedAgentFromDraft,
} from "../runs/gg/ggAgentLibrary";
import {
  blankAgentDraft,
  blankModelSlot,
  blankPrimaryModelSlot,
  draftSaveError,
  referencedModelSlots,
  resetAgentForMode,
  seedAgentParams,
  seededRunLimits,
  type GgConfigDraft,
  type GgModelSlotDraft,
} from "../runs/gg/ggConfigDraft";
import exec from "../runs/RunExec.module.scss";
import gg from "../runs/gg/GgConfigEditor.module.scss";
import styles from "./Coverage.module.scss";

// gg reaches every model through OpenRouter, so a slot's default must name the model's
// OpenRouter slug. Scoping the picker to this family commits the right alias.
const GG_MODEL_FAMILY = familyOf("gg");

/** A blank saved agent: one profile, deferred to a freshly declared `primary` slot. */
function emptyAgentDraft(): GgConfigDraft {
  const slot = blankPrimaryModelSlot();
  // Its `agent` params point at itself, which is the only profile a library entry can
  // name. An importing configuration carries those references onto the name the profile
  // arrives under, so seeding them here is also what keeps a fresh import from reading
  // as a configuration that has already pinned something.
  const blank = { ...blankAgentDraft(), modelSlotId: slot.id };
  const agent = seedAgentParams(blank, blank.id);
  return {
    agents: [agent],
    rootAgentId: agent.id,
    modelSlots: [slot],
    // A saved agent is one profile, so the run-level halves of a configuration — its
    // ceilings and its session hooks — are not its to carry. They stay at their seeded
    // values and are never read back out.
    limits: seededRunLimits(),
    hooks: [],
  };
}

// What the form held when it loaded, as the one string the dirty check compares against.
// Serialized in the form the agent is stored in, so reopening and closing it without
// touching anything never counts as a change.
function snapshotOf(description: string, draft: GgConfigDraft) {
  return JSON.stringify({
    description: description.trim(),
    saved: savedAgentFromDraft(draft),
  });
}

// The saved-agent editor (`/account/gg/agents/new` and
// `/account/gg/agents/:agentId/edit`): one agent profile authored on its own.
//
// It is the same per-agent form a configuration opens, over a draft holding this agent
// alone. Two things sit around it that a configuration would otherwise own: the
// library's one-line note, and the model slots this agent's bindings defer to — a slot
// is named by the configuration that runs the agent, so a saved agent declares the names
// it expects and an importing configuration declares any it does not already have.
//
// Console-only; gated on a signed-in account.
export function GgAgentEditPage() {
  const { agentId } = useParams();
  const editing = Boolean(agentId);
  const [params] = useSearchParams();
  // `?from=<id>` seeds a new agent from an existing one — the list page's Duplicate.
  const from = params.get("from");
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<GgConfigDraft>(() => emptyAgentDraft());
  const [saved, setSaved] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const seed = (nextDescription: string, nextDraft: GgConfigDraft) => {
      setDescription(nextDescription);
      setDraft(nextDraft);
      setSaved(snapshotOf(nextDescription, nextDraft));
    };
    if (!editing && !from) {
      seed("", emptyAgentDraft());
      setLoading(false);
    } else {
      Promise.resolve(backend.listGgAgents?.(token) ?? [])
        .then((agents) => {
          if (!active) return;
          const found = agents.find((a) => a.id === (editing ? agentId : from));
          if (!found) {
            setError("That agent no longer exists.");
          } else {
            const next = draftFromSavedAgent(found);
            if (!editing) {
              // A duplicate opens under a name of its own: names are unique within an
              // account, and two library entries called the same thing are two imports
              // an operator cannot tell apart.
              const taken = new Set(agents.map((a) => a.name));
              let copy = `${found.name} copy`;
              for (let n = 2; taken.has(copy); n += 1) {
                copy = `${found.name} copy ${n}`;
              }
              next.agents = next.agents.map((a) => ({ ...a, name: copy }));
            }
            seed(found.description, next);
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
        // The model catalog is optional; the pickers stay free-text.
      });
    return () => {
      active = false;
    };
  }, [backend, token, editing, agentId, from]);

  const agent = draft.agents[0];
  const structuralError = draftSaveError(draft);
  const savable = structuralError === null && !busy;

  const dirty = useMemo(
    () => saved !== null && snapshotOf(description, draft) !== saved,
    [saved, description, draft],
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function updateModelSlot(slotId: string, patch: Partial<GgModelSlotDraft>) {
    setDraft((current) => ({
      ...current,
      modelSlots: current.modelSlots.map((s) =>
        s.id === slotId ? { ...s, ...patch } : s,
      ),
    }));
  }
  function addModelSlot() {
    setDraft((current) => ({
      ...current,
      modelSlots: [...current.modelSlots, blankModelSlot()],
    }));
  }
  function removeModelSlot(slotId: string) {
    setDraft((current) => ({
      ...current,
      modelSlots: current.modelSlots.filter((s) => s.id !== slotId),
      agents: current.agents.map((a) =>
        a.modelSlotId === slotId ? { ...a, modelSlotId: "" } : a,
      ),
    }));
  }

  async function onSave() {
    if (!token || !savable) return;
    // Committing winds back what the types this agent was not saved under were
    // configured with, exactly as saving an agent onto a configuration does.
    const committed: GgConfigDraft = {
      ...draft,
      agents: draft.agents.map(resetAgentForMode),
    };
    const body = savedAgentFromDraft(committed);
    if (!body) return;
    const input: GgSavedAgentInput = {
      description: description.trim(),
      agent: body.agent,
      modelSlots: body.modelSlots,
    };
    setBusy(true);
    setError(null);
    try {
      if (editing && agentId && backend?.updateGgAgent) {
        await backend.updateGgAgent(agentId, input, token);
      } else if (backend?.createGgAgent) {
        await backend.createGgAgent(input, token);
      }
      navigate(routes.accountGgAgents());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const headerActions =
    !token || loading ? null : (
      <div className={styles.detailActions}>
        {structuralError && (
          <span className={exec.muted}>{structuralError}</span>
        )}
        <button
          type="button"
          className={exec.primary}
          onClick={onSave}
          disabled={!savable}
        >
          {busy ? "Saving…" : editing ? "Save agent" : "Create agent"}
        </button>
      </div>
    );

  const header = (
    <header className={styles.detailHeader}>
      <div className={styles.detailTitleRow}>
        <BackChevron
          label="All gg agents"
          onBack={() => {
            if (dirty) setLeaving(true);
            else navigate(routes.accountGgAgents());
          }}
        />
        <h1 className={styles.detailTitle}>
          {editing ? agent?.name.trim() || "Agent" : "New gg agent"}
        </h1>
      </div>
      {headerActions}
    </header>
  );

  if (!token) {
    return (
      <PageLayout>
        {header}
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to author gg agents — they are saved to your account.
        </p>
      </PageLayout>
    );
  }

  const referenced = referencedModelSlots(draft);

  return (
    <PageLayout>
      {header}

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <LoadingState label="Loading…" />
      ) : agent ? (
        <>
          <div className={exec.fields}>
            <label className={exec.field}>
              <span className={exec.fieldLabel}>Description (optional)</span>
              <input
                className={exec.input}
                type="text"
                value={description}
                placeholder="what this agent is for"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>

          {/* The slots this agent's bindings defer to. Named here rather than pinned,
              because which model runs an agent is settled by the configuration that
              imports it and the launch that fills its slot. */}
          <section className={gg.limitsWidget}>
            <p className={exec.sectionLabel}>
              Model slots
              <HelpTip text="The launch-time model parameters this agent's bindings defer to. A configuration importing this agent declares any of these it does not already have, taking the default given here." />
            </p>
            <div className={gg.slotList}>
              {draft.modelSlots.map((slot) => (
                <div key={slot.id} className={gg.slotBlock}>
                  <div className={gg.slotFields}>
                    <label className={`${exec.field} ${gg.slotNameField}`}>
                      <span className={exec.fieldLabel}>Slot name</span>
                      <input
                        className={exec.input}
                        type="text"
                        value={slot.name}
                        placeholder="e.g. primary"
                        onChange={(e) =>
                          updateModelSlot(slot.id, { name: e.target.value })
                        }
                      />
                    </label>
                    <label className={`${exec.field} ${gg.slotModelField}`}>
                      <span className={exec.fieldLabel}>
                        Default model (optional)
                      </span>
                      <ModelCombobox
                        value={slot.defaultModelId}
                        onChange={(v) =>
                          updateModelSlot(slot.id, { defaultModelId: v })
                        }
                        models={models}
                        harnessFamily={GG_MODEL_FAMILY}
                        inputClassName={exec.input}
                        placeholder="left to the launcher"
                      />
                    </label>
                    <button
                      type="button"
                      className={gg.slotRemove}
                      onClick={() => removeModelSlot(slot.id)}
                      aria-label={`Remove the ${slot.name || "unnamed"} model slot`}
                    >
                      ✕
                    </button>
                  </div>
                  {!referenced.has(slot.id) && (
                    <p className={gg.fieldError}>
                      This agent binds nothing to this slot, so it is dropped
                      when the agent is saved.
                    </p>
                  )}
                </div>
              ))}
              <button
                type="button"
                className={exec.secondary}
                onClick={addModelSlot}
              >
                + Add model slot
              </button>
            </div>
          </section>

          <GgAgentEditor
            config={draft}
            agent={agent}
            onPatch={(patch) =>
              setDraft((current) => ({
                ...current,
                agents: current.agents.map((a) =>
                  a.id === agent.id ? { ...a, ...patch } : a,
                ),
              }))
            }
            models={models}
            readOnly={false}
          />

          {leaving && (
            <UnsavedChangesDialog
              title="Unsaved changes to this agent"
              body="Going back to the list of agents will leave it as it was last saved."
              saveLabel={editing ? "Save agent" : "Create agent"}
              saveDisabled={!savable}
              saveBlockedReason={structuralError}
              onSave={() => {
                setLeaving(false);
                void onSave();
              }}
              onDiscard={() => navigate(routes.accountGgAgents())}
              onCancel={() => setLeaving(false)}
            />
          )}
        </>
      ) : null}
    </PageLayout>
  );
}
