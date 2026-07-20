import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Avatar, DonutChartWidget, Panel } from "@test-cabinet/ui";
import type { DonutSegment } from "@test-cabinet/ui";
import type { ReviewStatSlice, ReviewStats } from "../../../client/types";
import { RATING_META } from "../../../ratings";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import { downscaleToSquare } from "./downscalePicture";
import styles from "./AccountPages.module.scss";

// A categorical palette for the test-case and model rings, whose slices have no
// intrinsic color (unlike ratings, which carry the shared `--tcab-rating-*` tokens).
// Chosen to stay distinct against the console's dark backdrop; slices cycle through
// it and any overflow beyond the top slices folds into a muted "Other".
const CATEGORY_COLORS = [
  "#ff9d2f", // accent orange
  "#a855f7", // violet
  "#22d3ee", // cyan
  "#4ade80", // green
  "#f472b6", // pink
  "#facc15", // amber
  "#60a5fa", // blue
  "#fb7185", // rose
];
const OTHER_COLOR = "var(--tcab-muted)";

// How many named slices a categorical ring shows before the remainder folds into a
// single "Other" slice — enough to be informative without a legend that runs long.
const TOP_SLICES = 8;

// Turn a keyed breakdown (test cases or models) into donut segments: the largest
// `TOP_SLICES` keyed by the palette, with any remainder folded into one muted "Other"
// slice so a long tail doesn't crowd the legend.
function categorySegments(
  slices: readonly ReviewStatSlice[],
  label: (slice: ReviewStatSlice) => string,
): DonutSegment[] {
  const top = slices.slice(0, TOP_SLICES);
  const rest = slices.slice(TOP_SLICES);
  const segments: DonutSegment[] = top.map((slice, i) => ({
    label: label(slice),
    value: slice.count,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] ?? OTHER_COLOR,
  }));
  if (rest.length > 0) {
    const total = rest.reduce((sum, slice) => sum + slice.count, 0);
    segments.push({
      label: `Other (${rest.length})`,
      value: total,
      color: OTHER_COLOR,
    });
  }
  return segments;
}

// The account view's Profile tab (`/account`): the signed-in user's identity card
// (avatar, display name, username, profile-picture controls, sign out) alongside a
// full-width breakdown of their recent review activity — ring charts of the test
// cases and models they've reviewed and the ratings they've given. A console-only
// page; a signed-out visitor is redirected to the sign-in page. Signing out clears the
// stored token and returns to the gallery home.
export function AccountPage() {
  const { account, token, logout, setProfilePicture, removeProfilePicture } =
    useAuth();
  const { active: worker } = useWorkers();
  const { client: backend } = useBackend();
  const testCaseName = useTestCaseName();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Load the account's recent-review breakdowns for the charts. Refetches whenever the
  // signed-in token changes (a sign-out unmounts the page). A transport without the
  // stats call simply leaves the section empty.
  useEffect(() => {
    if (!backend?.getReviewStats || !token) {
      setStatsLoading(false);
      return;
    }
    let active = true;
    setStatsLoading(true);
    setStatsError(null);
    backend
      .getReviewStats(token)
      .then((res) => {
        if (!active) return;
        setStats(res);
        setStatsLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setStatsError(String(e));
        setStatsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [backend, token]);

  if (!account) return <Navigate to={routes.login()} replace />;

  // The active transport can only manage a picture when it implements the auth calls;
  // hide the controls otherwise (rather than offer a button that throws).
  const canManagePicture = !!worker?.client?.setProfilePicture;
  const hasPicture = !!account.pictureUrl;

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const picture = await downscaleToSquare(file);
      await setProfilePicture(picture);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      // Clear the input so re-picking the same file fires `change` again.
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const onRemove = async () => {
    setError(null);
    setBusy(true);
    try {
      await removeProfilePicture();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageLayout>
      <PromptHeader command="--account" comment={<>// your account</>} />
      <AccountTabs active="profile" />
      <div className={styles.profile}>
        <Panel className={styles.identityCard}>
          <div className={styles.identity}>
            <Avatar
              name={account.displayName}
              pictureUrl={account.pictureUrl}
              size={72}
            />
            <div className={styles.identityText}>
              <span className={styles.displayName}>{account.displayName}</span>
              <span className={styles.username}>@{account.username}</span>
              {canManagePicture && (
                <div className={styles.pictureControls}>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className={styles.hiddenInput}
                    onChange={(e) => void onPick(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    {hasPicture ? "Change picture" : "Add picture"}
                  </button>
                  {hasPicture && (
                    <button
                      type="button"
                      className={styles.linkButton}
                      disabled={busy}
                      onClick={() => void onRemove()}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            className={styles.signOut}
            onClick={() => {
              logout();
              navigate(routes.home());
            }}
          >
            Sign out
          </button>
        </Panel>
        {error && <p className={styles.error}>{error}</p>}

        <Panel className={styles.activity}>
          <header className={styles.activityHead}>
            <h2 className={styles.sectionTitle}>Review activity</h2>
            {stats && stats.windowReviews > 0 && (
              <p className={styles.sectionLede}>
                Your {stats.windowReviews} most recent{" "}
                {stats.windowReviews === 1 ? "review" : "reviews"}
                {stats.totalReviews > stats.windowReviews &&
                  ` of ${stats.totalReviews} total`}
                .
              </p>
            )}
          </header>
          {statsError && <p className={styles.error}>{statsError}</p>}
          {renderActivity(stats, statsLoading, testCaseName)}
        </Panel>
      </div>
    </PageLayout>
  );
}

// The activity section body: a loading note, an empty state, or the three ring charts
// once the breakdowns are in. Split out to keep the component's return readable.
function renderActivity(
  stats: ReviewStats | null,
  loading: boolean,
  testCaseName: (slug: string) => string,
) {
  if (loading && !stats) {
    return <p className={styles.muted}>Loading your review activity…</p>;
  }
  if (!stats || stats.windowReviews === 0) {
    return (
      <p className={styles.muted}>
        You haven&rsquo;t reviewed any runs yet. Once you review runs, their
        breakdown appears here.
      </p>
    );
  }

  const ratingSegments: DonutSegment[] = stats.ratings.map((slice) => ({
    label: RATING_META[slice.rating].label,
    value: slice.count,
    color: `var(--tcab-rating-${slice.rating})`,
  }));
  const ratingTotal = stats.ratings.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className={styles.charts}>
      <DonutChartWidget
        framed={false}
        title="Test cases"
        segments={categorySegments(stats.testCases, (s) =>
          testCaseName(s.key),
        )}
        total={stats.windowReviews}
        centerLabel="reviews"
        emptyMessage="No reviewed test cases yet."
      />
      <DonutChartWidget
        framed={false}
        title="Models"
        segments={categorySegments(stats.models, (s) => s.key)}
        total={stats.windowReviews}
        centerLabel="reviews"
        emptyMessage="No reviewed models yet."
      />
      <DonutChartWidget
        framed={false}
        title="Ratings given"
        segments={ratingSegments}
        total={ratingTotal}
        centerLabel="rated"
        emptyMessage="No domain-rated reviews yet — game jams are graded, not rated."
      />
    </div>
  );
}
