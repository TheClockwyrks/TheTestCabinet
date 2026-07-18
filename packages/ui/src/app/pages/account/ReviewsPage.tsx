import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { Pagination } from "@test-cabinet/ui";
import type { MyReview } from "../../../client/types";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { ReviewLog } from "../../components/ReviewLog";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import styles from "./ReviewsPage.module.scss";

// How many reviews to show per page before the numbered pager kicks in.
const PAGE_SIZE = 20;

// The account view's Reviews tab (`/account/reviews`): a paginated table of every
// review the signed-in account has submitted, newest first (by when they reviewed),
// each row linking to that review's own page. Renders the shared run-log table
// (see {@link ReviewLog}) so it's the same dense, column-adjustable listing the
// runs page uses. Console-only and gated on a signed-in account; a signed-out
// visitor is redirected to sign in.
export function ReviewsPage() {
  const { account, token } = useAuth();
  const { client: backend } = useBackend();

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
          <ReviewLog reviews={reviews} loading={loading} />
        )}
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
      </div>
    </PageLayout>
  );
}
