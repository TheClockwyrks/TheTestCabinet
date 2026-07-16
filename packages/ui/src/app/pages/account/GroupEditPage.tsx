import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type {
  CoverageGroupInput,
  CoverageGroupKind,
  ReviewPlanCase,
  ReviewPlanCombo,
} from "@test-cabinet/run-record/coverage";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import { ComboPicker, CasePicker } from "./coveragePickers";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The coverage group editor (`/account/groups/new` and `/account/groups/:groupId/
// edit`): a group's name, kind (model combinations or cases — fixed once created),
// and members. Save creates or updates and returns to the Groups tab. Console-only;
// gated on a signed-in account.
export function GroupEditPage() {
  const { groupId } = useParams();
  const editing = Boolean(groupId);
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<CoverageGroupKind>("combo");
  const [combos, setCombos] = useState<ReviewPlanCombo[]>([]);
  const [cases, setCases] = useState<ReviewPlanCase[]>([]);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.resolve(
      editing ? (backend.listCoverageGroups?.(token) ?? []) : [],
    )
      .then((groups) => {
        if (!active) return;
        if (editing) {
          const group = groups.find((g) => g.id === groupId);
          if (!group) {
            setError("That group no longer exists.");
          } else {
            setName(group.name);
            setKind(group.kind);
            setCombos(group.combos);
            setCases(group.cases);
          }
        }
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    backend
      .listModels()
      .then((ms) => active && setModels(ms))
      .catch(() => {
        /* optional; the model field stays free-text */
      });
    return () => {
      active = false;
    };
  }, [backend, token, editing, groupId]);

  // A group needs a name and at least one member of its kind.
  const savable =
    name.trim().length > 0 &&
    (kind === "combo" ? combos.length > 0 : cases.length > 0);

  async function onSave() {
    if (!token || !savable) return;
    const input: CoverageGroupInput = {
      name: name.trim(),
      kind,
      // The server keeps only the kind's members, but send the right array anyway.
      combos: kind === "combo" ? combos : [],
      cases: kind === "case" ? cases : [],
    };
    setBusy(true);
    setError(null);
    try {
      if (editing && groupId && backend?.updateCoverageGroup) {
        await backend.updateCoverageGroup(groupId, input, token);
      } else if (backend?.createCoverageGroup) {
        await backend.createCoverageGroup(input, token);
      }
      navigate(routes.accountGroups());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <PageLayout>
        <AccountTabs active="groups" />
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to edit coverage groups — they are saved to your account.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <AccountTabs active="groups" />
      <PromptHeader
        command={editing ? "--account/groups/edit" : "--account/groups/new"}
        comment={<>// name the group and add its members</>}
      />

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : (
        <section className={styles.editor}>
          <label className={styles.nameField}>
            <span className={exec.fieldLabel}>Group name</span>
            <input
              className={exec.input}
              type="text"
              value={name}
              placeholder={
                kind === "combo" ? "e.g. Anthropic models" : "e.g. E2E cases"
              }
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <p className={exec.sectionLabel}>Kind</p>
          <div className={styles.kindRow}>
            <button
              type="button"
              className={`${styles.groupPick} ${
                kind === "combo" ? styles.groupPickOn : ""
              }`}
              aria-pressed={kind === "combo"}
              // A group's kind is fixed once it exists (its stored members are of
              // that kind), so the toggle is disabled while editing.
              disabled={editing}
              onClick={() => setKind("combo")}
            >
              Model combinations
            </button>
            <button
              type="button"
              className={`${styles.groupPick} ${
                kind === "case" ? styles.groupPickOn : ""
              }`}
              aria-pressed={kind === "case"}
              disabled={editing}
              onClick={() => setKind("case")}
            >
              Test cases
            </button>
          </div>

          <p className={exec.sectionLabel}>Members</p>
          {kind === "combo" ? (
            <ComboPicker combos={combos} onChange={setCombos} models={models} />
          ) : (
            <CasePicker cases={cases} onChange={setCases} />
          )}

          <div className={styles.editorActions}>
            <button
              type="button"
              className={exec.primary}
              disabled={busy || !savable}
              onClick={onSave}
            >
              {busy ? "Saving…" : editing ? "Save group" : "Create group"}
            </button>
            <button
              type="button"
              className={exec.secondary}
              disabled={busy}
              onClick={() => navigate(routes.accountGroups())}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </PageLayout>
  );
}
