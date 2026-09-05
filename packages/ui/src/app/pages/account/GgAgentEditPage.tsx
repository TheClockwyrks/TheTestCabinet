import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { GgSavedAgentInput } from "@clockwyrks/run-record/gg";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { BackChevron } from "../../components/BackChevron";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import { routes } from "../../routes";
import { GgAgentEditor } from "../runs/gg/GgAgentEditor";
import {
  draftFromSavedAgent,
  savedAgentFromDraft,
} from "../runs/gg/ggAgentLibrary";
import {
  blankAgentDraft,
  draftSaveError,
  renameAgentSlug,
  resetAgentForMode,
  seedAgentParams,
  seededRunLimits,
  type GgConfigDraft,
} from "../runs/gg/ggConfigDraft";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

/**
 * A blank saved agent: one profile declaring and deferring to its own passthrough
 * `primary` slot.
 */
function emptyAgentDraft(): GgConfigDraft {
  // Its `agent` params point at itself, which is the only profile a library entry can
  // name. An importing configuration mints the profile an internal id of its own and
  // carries those references onto it, so seeding them here is also what keeps a fresh
  // import from reading as a configuration that has already pinned something.
  const blank = blankAgentDraft();
  const agent = seedAgentParams(blank, blank.id);
  return {
    agents: [agent],
    rootAgentId: agent.id,
    // A saved agent declares no configuration slots: what it carries are the agent slots
    // its own bindings defer to, and the configuration that imports it decides how each
    // one reaches the launch form.
    modelSlots: [],
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
      agent: body,
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
          Sign in to author gg agents. They are saved to your account.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {header}

      <SubmitNotice message={error} />

      {loading ? (
        <LoadingState label="Loading…" />
      ) : agent ? (
        <>
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
            onRenameSlug={(slug) =>
              // The one profile a library entry holds, which keeps the internal id it was
              // authored under — a saved agent is a single profile, so the id names it
              // whatever the operator types into the slug beside it.
              setDraft((current) => renameAgentSlug(current, agent.id, slug))
            }
            models={models}
            readOnly={false}
            description={description}
            onDescriptionChange={setDescription}
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
