import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router";
import { GradeBadge, Pagination, RatingBadge } from "@test-cabinet/ui";
import type { MyReview } from "../../../client/types";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { overallGradeOf, worstRating } from "../../data/ratings";
import { useTestCaseName } from "../../data/useTestCaseName";
import { formatSlug } from "../../format";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { formatReviewedAt } from "../runs/[runId]/ReviewList";
import { AccountTabs } from "./AccountTabs";
import styles from "./ReviewsPage.module.scss";

// How many reviews to show per page before the numbered pager kicks in.
const PAGE_SIZE = 20;

// The account view's Reviews tab (`/account/reviews`): a paginated table of every
// review the signed-in account has submitted, newest first (by when they reviewed),
// each row linking to that review's own page. Mirrors the runs listing's dense,
// clickable-row table. Console-only and gated on a signed-in account; a signed-out
// visitor is redirected to sign in.
export function ReviewsPage() {
  const { account, token } = useAuth();
  const { client: backend } = useBackend();
  const testCaseName = useTestCaseName();

  const [page, setPage] = useState(0);
  const [reviews, setReviews] = useState<MyReview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch one page whenever the page changes. Prior rows stay on screen until the
  // new page resolves (no empty flash).
  useEffect(() => {
    if (!backend?.listMyReviews || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    backend
      .listMyReviews({ offset: page * PAGE_SIZE, limit: PAGE_SIZE }, token)
      .then((res) => {
        if (!active) return;
        setReviews(res.reviews);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [backend, token, page]);

  if (!account) return <Navigate to={routes.login()} replace />;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageLayout>
      <PromptHeader
        command="--account reviews"
        comment={<>// your reviews</>}
      />
      <AccountTabs active="reviews" />
      <div className={styles.page}>
        {error && <p className={styles.error}>{error}</p>}
        {!loading && reviews.length === 0 && !error ? (
          <p className={styles.empty}>
            You haven&rsquo;t submitted any reviews yet.
          </p>
        ) : (
          <div className={styles.table} data-loading={loading ? "" : undefined}>
            <div className={`${styles.row} ${styles.head}`}>
              <span>Test case</span>
              <span>Model</span>
              <span>Harness</span>
              <span>Variant</span>
              <span>Rating</span>
              <span>Reviewed</span>
            </div>
            {reviews.map(({ run, review }) => (
              <ReviewRow
                key={run.id}
                run={run}
                review={review}
                caseName={testCaseName(run.subject.testCaseSlug)}
              />
            ))}
          </div>
        )}
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
      </div>
    </PageLayout>
  );
}

// One review row: the reviewed run's identity, the account's own rating (or a game
// jam's overall grade), and when they reviewed — the whole row linking to that
// review's page.
function ReviewRow({
  run,
  review,
  caseName,
}: {
  run: MyReview["run"];
  review: MyReview["review"];
  caseName: string;
}) {
  // This account's own verdict: the worst rating across the domains it scored, or —
  // for a game jam, which scores no domains — its whole-game overall grade.
  const rated = review.ratings.length > 0;
  const overall = rated
    ? worstRating(review.ratings.map((r) => r.rating))
    : null;
  const grade = rated ? null : overallGradeOf(review.checklist);

  return (
    <Link
      to={routes.runReview(run.id, review.reviewerId)}
      className={styles.row}
    >
      <span className={styles.cell} title={caseName}>
        {caseName}
      </span>
      <span className={styles.cell} title={run.subject.modelId}>
        {run.subject.modelId}
      </span>
      <span className={styles.cell}>{formatSlug(run.subject.harnessSlug)}</span>
      <span className={styles.cell}>{formatSlug(run.subject.variant)}</span>
      <span className={styles.cell}>
        {grade ? (
          <GradeBadge status={grade} />
        ) : overall ? (
          <RatingBadge rating={overall} />
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </span>
      <span className={styles.cell}>
        {review.reviewedAt ? formatReviewedAt(review.reviewedAt) : "—"}
      </span>
    </Link>
  );
}
