import { Navigate, useParams } from "react-router";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { hasPlayableBuild } from "../../../data/runState";
import { routes } from "../../../routes";
import { PlayableSection } from "../PlayableSection";
import { ShowcaseSection } from "./ShowcaseSection";

// The Play tab, which is the run's landing tab (`/runs/:runId`): the model's
// implementation exactly as it was written. The build never auto-loads —
// PlayableSection gates it behind an explicit launch, showing a generic caveat
// first. The reviewer's verdict lives on the Verdict tab.
//
// A run whose record carries a showcase — the model's own store-page pitch for
// the game — renders it around that same gated launch panel (see
// ShowcaseSection). One without (every run recorded before showcases existed,
// and any whose tree held no readable one) renders the plain PlayableSection
// alone, exactly as before.
//
// A run with no playable build — an asset-generation, adversarial, or
// performance run, or one whose state produced nothing to host — has no Play
// tab (RunDetailLayout omits it), so the bare run URL redirects to the Verdict
// tab where its result is shown rather than rendering an empty player.
// `hasPlayableBuild` is the same gate the layout's tab strip uses, so the
// redirect and the missing tab can never disagree.
export function RunPlayPage() {
  return (
    <RunDetailLayout tab="play">
      {({ run }) =>
        !hasPlayableBuild(run) ? (
          <Navigate to={routes.runVerdict(run.id)} replace />
        ) : run.showcase ? (
          <ShowcaseSection run={run} showcase={run.showcase} />
        ) : (
          <PlayableSection run={run} />
        )
      }
    </RunDetailLayout>
  );
}

// The legacy `/runs/:runId/play` route: Play moved to the bare run URL, and this
// only redirects there so old deep links keep working. A run with nothing to
// play chains through the index's own redirect to the Verdict tab.
export function RunPlayRedirect() {
  const { runId } = useParams<{ runId: string }>();
  return <Navigate to={routes.runDetail(runId ?? "")} replace />;
}
