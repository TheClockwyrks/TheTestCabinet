import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { RunsTabs } from "../runs/RunsTabs";
import { useAuth } from "../../../client/auth";
import { useGalleryData } from "../../data/galleryContext";
import { routes } from "../../routes";
import { ComparisonsList } from "./ComparisonsList";
import exec from "../runs/RunExec.module.scss";

// The Runs section's **Comparisons** tab (`/runs/comparisons`): the harness
// comparisons list, beside the default **Tests** tab. Rendered on every host —
// the console shows the signed-in account's comparisons with a "New comparison"
// action, the read-only static site shows the published set off the snapshot
// (mutations gate on `canExecute`). Mirrors `RunsPage`/`UnreviewedPage`: the
// PageLayout + prompt header + shared `RunsTabs`, then the list body.
export function ComparisonsIndexPage() {
  const { canExecute } = useGalleryData();
  const { token } = useAuth();

  return (
    <PageLayout>
      <PromptHeader
        command="--runs/comparisons"
        comment={
          <>// the same benchmark under several harnesses, side by side</>
        }
      />

      <RunsTabs active="comparisons" />

      {/* Creating a comparison is console-only (it is saved to an account); the
          static site renders the published list read-only, so the action hides
          there. */}
      {canExecute && token && (
        <Link className={exec.primary} to={routes.comparisonNew()}>
          New comparison
        </Link>
      )}

      <ComparisonsList />
    </PageLayout>
  );
}
