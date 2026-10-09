//! The shapes a review is stored, served and published in: the rating scales, the
//! checklist verdicts, the per-domain ratings, and the diff an edit records.
//!
//! See `docs/results.md`. A review is curatorial, authored by a person after
//! playing a finished build, and deliberately not part of the
//! [run record](crate::run_record). The writeup parser and every scoring rule over
//! these shapes live in `test_cabinet_core::review`, which re-exports everything
//! here.
//!
//! The rating tiers here are mirrored as a TypeScript union in
//! `packages/ui/src/ratings.ts`; keep the two in lockstep.

use serde::{Deserialize, Serialize};

/// A reviewer's subjective quality rating for a finished implementation.
///
/// Assigned by hand while playing the build, ordered best to worst. It is a
/// per-run signal shown alongside a run, never an aggregate or a ranking across
/// runs (see `docs/site.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum Rating {
    /// Implemented according to spec with no noticeable bugs.
    Flawless,
    /// Implemented according to spec; may have minor issues that don't impact
    /// playability.
    Great,
    /// Implemented to spec and playable, but with rough edges beyond the minor
    /// issues of a [`Great`](Rating::Great) run — noticeable, though not enough
    /// to deviate from the spec or impair playability.
    Passable,
    /// Mostly implemented according to spec. Playable, but deviates from the
    /// spec or has bugs that impact playability.
    Scuffed,
    /// Doesn't follow the spec, or has bugs severe enough to render the game
    /// unplayable.
    Broken,
}

impl Rating {
    /// Every rating, ordered best to worst.
    pub const ALL: [Rating; 5] = [
        Rating::Flawless,
        Rating::Great,
        Rating::Passable,
        Rating::Scuffed,
        Rating::Broken,
    ];

    /// The wire token for this rating, matching its frontmatter and serde form.
    pub fn as_str(&self) -> &'static str {
        match self {
            Rating::Flawless => "flawless",
            Rating::Great => "great",
            Rating::Passable => "passable",
            Rating::Scuffed => "scuffed",
            Rating::Broken => "broken",
        }
    }

    /// Parse a rating from its lowercase token, accepting surrounding whitespace
    /// and any case.
    pub fn parse(token: &str) -> Option<Rating> {
        match token.trim().to_ascii_lowercase().as_str() {
            "flawless" => Some(Rating::Flawless),
            "great" => Some(Rating::Great),
            "passable" => Some(Rating::Passable),
            "scuffed" => Some(Rating::Scuffed),
            "broken" => Some(Rating::Broken),
            _ => None,
        }
    }

    /// This rating's rank, with `0` the best ([`Rating::Flawless`]) and larger
    /// numbers worse. Lets ratings be compared so the worst across a case's
    /// domains can be picked as the run's overall rating.
    pub fn rank(self) -> usize {
        Self::ALL
            .iter()
            .position(|rating| *rating == self)
            .unwrap_or(0)
    }

    /// The worst (lowest) rating among `ratings`, or `None` when empty. A run's
    /// overall rating is the worst across its domains — a flawless mode cannot
    /// mask a broken one.
    pub fn worst(ratings: impl IntoIterator<Item = Rating>) -> Option<Rating> {
        ratings.into_iter().max_by_key(|rating| rating.rank())
    }
}

/// A reviewer's **aesthetic** rating for a finished implementation — the second
/// rating channel, separate from the functional [`Rating`].
///
/// On a [validator-rated](crate::test_case::TestCaseVersion::validator_rated) run
/// behaviour is decided by the validators, so the reviewer rates how the build
/// looks, sounds, and feels — one tier for the **whole run**, not one per scoring
/// domain. Ordered best to worst. [`Amazing`](Self::Amazing)
/// is the normal maximum; [`Legendary`](Self::Legendary) is exceptional and reserved,
/// and its badge carries a special look so a viewer sees at once that it is rare.
/// A legacy run (one on a case version that is not validator-rated) never carries
/// one. Mirrored as `AESTHETIC_RATINGS` in `packages/run-stats/src/scoring.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum AestheticRating {
    /// Exceptionally beautiful — reserved for the rare build that stands above
    /// every other, not the normal top of the scale.
    Legendary,
    /// Beautiful and polished: the normal maximum.
    Amazing,
    /// Looks and feels good, with minor rough edges.
    Good,
    /// Serviceable but plain or uneven.
    Okay,
    /// Ugly, incoherent, or careless.
    Slop,
}

impl AestheticRating {
    /// Every aesthetic rating, ordered best to worst.
    pub const ALL: [AestheticRating; 5] = [
        AestheticRating::Legendary,
        AestheticRating::Amazing,
        AestheticRating::Good,
        AestheticRating::Okay,
        AestheticRating::Slop,
    ];

    /// The wire token for this rating, matching its frontmatter and serde form.
    pub fn as_str(&self) -> &'static str {
        match self {
            AestheticRating::Legendary => "legendary",
            AestheticRating::Amazing => "amazing",
            AestheticRating::Good => "good",
            AestheticRating::Okay => "okay",
            AestheticRating::Slop => "slop",
        }
    }

    /// Parse an aesthetic rating from its lowercase token, accepting surrounding
    /// whitespace and any case.
    pub fn parse(token: &str) -> Option<AestheticRating> {
        match token.trim().to_ascii_lowercase().as_str() {
            "legendary" => Some(AestheticRating::Legendary),
            "amazing" => Some(AestheticRating::Amazing),
            "good" => Some(AestheticRating::Good),
            "okay" => Some(AestheticRating::Okay),
            "slop" => Some(AestheticRating::Slop),
            _ => None,
        }
    }

    /// This rating's rank, with `0` the best ([`AestheticRating::Legendary`]) and
    /// larger numbers worse.
    pub fn rank(self) -> usize {
        Self::ALL
            .iter()
            .position(|rating| *rating == self)
            .unwrap_or(0)
    }

    /// The worst (lowest) aesthetic rating among `ratings`, or `None` when empty.
    /// Like [`Rating::worst`], a run's overall aesthetic rating is the worst
    /// across its reviews' run-wide tiers (see `test_cabinet_core::review::aggregate_aesthetic`).
    pub fn worst(ratings: impl IntoIterator<Item = AestheticRating>) -> Option<AestheticRating> {
        ratings.into_iter().max_by_key(|rating| rating.rank())
    }
}

/// The **failure cap** a review item declares: the highest functional [`Rating`]
/// the item's [domains](crate::test_case::SubReviewItem::domains) may reach while
/// the item's validator fails.
///
/// On a [validator-rated](crate::test_case::TestCaseVersion::validator_rated) case
/// version every graded point declares one (manifest key `failure_cap`), so the
/// functional rating is decided by the validators alone: a domain starts
/// `flawless` and each failing point lowers it to `min(current, cap)`, so the
/// build gets the *lowest* cap among its failures (two failures capped at `great`
/// and `scuffed` → `scuffed`). `flawless` is deliberately not a cap — a failure
/// always costs something. Mirrored as `FAILURE_CAPS` / `FAILURE_CAP_RATING` in
/// `packages/run-stats/src/scoring.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum FailureCap {
    /// The item is gameplay-critical: failing it renders the build `broken`.
    Broken,
    /// Failing it leaves the build playable but noticeably wrong: at most `scuffed`.
    Scuffed,
    /// Failing it is a rough edge within tolerance: at most `passable`.
    Passable,
    /// Failing it is a minor issue that does not impact playability: at most `great`.
    Great,
}

impl FailureCap {
    /// Every cap, from the most to the least severe.
    pub const ALL: [FailureCap; 4] = [
        FailureCap::Broken,
        FailureCap::Scuffed,
        FailureCap::Passable,
        FailureCap::Great,
    ];

    /// The wire token for this cap, matching its manifest and serde form.
    pub fn as_str(&self) -> &'static str {
        match self {
            FailureCap::Broken => "broken",
            FailureCap::Scuffed => "scuffed",
            FailureCap::Passable => "passable",
            FailureCap::Great => "great",
        }
    }

    /// Parse a cap from its lowercase token, accepting surrounding whitespace and
    /// any case. `flawless` is not a cap and parses as `None`.
    pub fn parse(token: &str) -> Option<FailureCap> {
        match token.trim().to_ascii_lowercase().as_str() {
            "broken" => Some(FailureCap::Broken),
            "scuffed" => Some(FailureCap::Scuffed),
            "passable" => Some(FailureCap::Passable),
            "great" => Some(FailureCap::Great),
            _ => None,
        }
    }

    /// The functional [`Rating`] this cap bounds a domain to while its item fails.
    pub fn rating(self) -> Rating {
        match self {
            FailureCap::Broken => Rating::Broken,
            FailureCap::Scuffed => Rating::Scuffed,
            FailureCap::Passable => Rating::Passable,
            FailureCap::Great => Rating::Great,
        }
    }
}

/// A reviewer's verdict on one declared checklist item.
///
/// A test case declares the checklist (see [`crate::test_case::ReviewItem`]); the
/// reviewer records one of these per item while judging the build.
///
/// Most case types grade an item **binary** — [`Pass`](VerdictStatus::Pass) or
/// [`Fail`](VerdictStatus::Fail) — and the item earns all its weight or none. A
/// [game jam](crate::test_case::TestType::GameJam) instead grades each of its
/// review categories on a five-level **graded** scale worth a fixed number of
/// points ([`Broken`](VerdictStatus::Broken) 0 → [`Incredible`](VerdictStatus::Incredible)
/// 10); the same graded scale carries the reviewer's whole-game
/// [`OVERALL_VERDICT_ID`] mark. Which scale an item uses is declared on the item
/// ([`crate::test_case::ReviewItem::graded`]); the two never mix within a case.
/// Keep the tiers and their point values in lockstep with the TypeScript
/// `VERDICT_META` in `packages/ui/src/ratings.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum VerdictStatus {
    /// Binary: the item was checked and the build satisfies it. The item earns
    /// its weight toward the run's score.
    Pass,
    /// Binary: the item was checked and the build does not satisfy it. The item
    /// earns none of its weight.
    Fail,
    /// Graded 💩: broken. Worth 0 points.
    Broken,
    /// Graded 🙁: not great. Worth 2 points.
    Poor,
    /// Graded 😐: neutral. Worth 5 points.
    Neutral,
    /// Graded 😀: great. Worth 8 points.
    Great,
    /// Graded 💎: incredible. Worth 10 points.
    Incredible,
}

impl VerdictStatus {
    /// The five graded tiers, worst to best. A graded item's earned points, and
    /// the whole-game overall mark, are always one of these.
    pub const GRADES: [VerdictStatus; 5] = [
        VerdictStatus::Broken,
        VerdictStatus::Poor,
        VerdictStatus::Neutral,
        VerdictStatus::Great,
        VerdictStatus::Incredible,
    ];

    /// The maximum points a single graded tier is worth ([`Incredible`](VerdictStatus::Incredible)).
    /// A graded item's available points are this times its weight.
    pub const MAX_GRADE_POINTS: u32 = 10;

    /// The wire token for this status, matching its frontmatter and serde form.
    pub fn as_str(&self) -> &'static str {
        match self {
            VerdictStatus::Pass => "pass",
            VerdictStatus::Fail => "fail",
            VerdictStatus::Broken => "broken",
            VerdictStatus::Poor => "poor",
            VerdictStatus::Neutral => "neutral",
            VerdictStatus::Great => "great",
            VerdictStatus::Incredible => "incredible",
        }
    }

    /// Parse a status from its token, accepting surrounding whitespace and any
    /// case. A binary item is judged `pass`/`fail`; a graded item (and the
    /// overall mark) is one of `broken`, `poor`, `neutral`, `great`, `incredible`.
    pub fn parse(token: &str) -> Option<VerdictStatus> {
        match token.trim().to_ascii_lowercase().as_str() {
            "pass" => Some(VerdictStatus::Pass),
            "fail" => Some(VerdictStatus::Fail),
            "broken" => Some(VerdictStatus::Broken),
            "poor" => Some(VerdictStatus::Poor),
            "neutral" => Some(VerdictStatus::Neutral),
            "great" => Some(VerdictStatus::Great),
            "incredible" => Some(VerdictStatus::Incredible),
            _ => None,
        }
    }

    /// The points one of the five graded tiers is worth (0/2/5/8/10), or `None`
    /// for the binary [`Pass`](VerdictStatus::Pass)/[`Fail`](VerdictStatus::Fail).
    ///
    /// The scale is centred: a neutral category earns half its available points
    /// and a great one four fifths, so a jam's percentage reads comparably to a
    /// pass/fail case's earned-over-declared score.
    pub fn grade_points(self) -> Option<u32> {
        match self {
            VerdictStatus::Broken => Some(0),
            VerdictStatus::Poor => Some(2),
            VerdictStatus::Neutral => Some(5),
            VerdictStatus::Great => Some(8),
            VerdictStatus::Incredible => Some(10),
            VerdictStatus::Pass | VerdictStatus::Fail => None,
        }
    }

    /// Whether this is one of the five graded tiers (rather than binary).
    pub fn is_grade(self) -> bool {
        self.grade_points().is_some()
    }

    /// The worst (lowest-point) graded tier among `grades`, or `None` when empty
    /// or none are graded tiers. A run's overall game grade is the worst any
    /// reviewer gave, mirroring how a run's overall rating is the worst domain.
    pub fn worst_grade(grades: impl IntoIterator<Item = VerdictStatus>) -> Option<VerdictStatus> {
        grades
            .into_iter()
            .filter_map(|grade| grade.grade_points().map(|points| (points, grade)))
            .min_by_key(|(points, _)| *points)
            .map(|(_, grade)| grade)
    }
}

/// The reserved checklist id carrying a [game jam](crate::test_case::TestType::GameJam)
/// reviewer's **overall** grade for the game as a whole — a graded
/// [`VerdictStatus`] the reviewer supplies directly (never derived from the
/// category grades). It rides the ordinary [`ReviewVerdict`] checklist under this
/// id rather than needing its own column, is excluded from the point score (it is
/// not a declared [`ReviewItem`](crate::test_case::ReviewItem)), and becomes the run's rating badge on a jam.
/// A jam's declared review categories may not use this id.
pub const OVERALL_VERDICT_ID: &str = "overall";

/// A reviewer's recorded verdict on one declared checklist item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewVerdict {
    /// The declared item's stable id (see [`crate::test_case::ReviewItem::id`]).
    pub id: String,
    /// The reviewer's verdict on the item.
    pub status: VerdictStatus,
    /// An optional one-line note recording what the reviewer observed. `None`
    /// when the reviewer left no note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub note: Option<String>,
}

/// A reviewer's quality [`Rating`] for one of a case's scoring domains.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct DomainRating {
    /// The declared domain's stable id (see [`crate::test_case::Domain::id`]).
    pub domain: String,
    /// The reviewer's rating for this domain.
    pub rating: Rating,
}

/// **Legacy:** a reviewer's [`AestheticRating`] for one of a case's scoring
/// domains, from when the aesthetic channel was rated per domain. The channel is
/// now **run-wide** (see [`Writeup::aesthetic`]); this type survives only so old
/// stored rows (the backend's `review.aesthetics` JSON column and the snapshot's
/// legacy `aesthetics` field) keep deserializing. A legacy review's run-wide tier
/// is the worst across its per-domain entries. Never written by new reviews.
// The text is emitted into the contract; the link names core's item.
#[allow(rustdoc::broken_intra_doc_links)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct DomainAesthetic {
    /// The declared domain's stable id (see [`crate::test_case::Domain::id`]).
    pub domain: String,
    /// The reviewer's aesthetic rating for this domain.
    pub rating: AestheticRating,
}

/// The run-wide aesthetic rating change between two versions of a review (see
/// [`ReviewDiff::aesthetics`]) — the same shape as [`RatingChange`] on the
/// aesthetic channel. A newly rated review has `from = None`; a review whose tier
/// was dropped has `to = None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AestheticChange {
    /// **Legacy:** the scoring domain whose aesthetic rating changed, from when
    /// the channel was rated per domain. `None` on every new diff — the aesthetic
    /// rating is run-wide, so a change is a single domainless entry — and kept
    /// only so old stored revision rows (domain present) still deserialize.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub domain: Option<String>,
    /// The aesthetic rating before the edit, or `None` if the review was newly rated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub from: Option<AestheticRating>,
    /// The aesthetic rating after the edit, or `None` if the rating was removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub to: Option<AestheticRating>,
}

/// One per-domain rating change between two versions of a review (see
/// [`ReviewDiff`]). A newly rated domain has `from = None`; a domain whose rating
/// was dropped has `to = None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RatingChange {
    /// The scoring domain whose rating changed.
    pub domain: String,
    /// The rating before the edit, or `None` if the domain was newly rated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub from: Option<Rating>,
    /// The rating after the edit, or `None` if the domain's rating was removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub to: Option<Rating>,
}

/// One checklist verdict change between two versions of a review (see
/// [`ReviewDiff`]). A newly recorded verdict has `from = None`; a verdict that was
/// withdrawn has `to = None`. [`note_changed`](Self::note_changed) flags a change to
/// the verdict's own note text even when its pass/fail/grade status held.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct VerdictChange {
    /// The declared item's verdict id (an item id or a composite `<item>.<sub>`).
    pub id: String,
    /// The status before the edit, or `None` if the verdict was newly recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub from: Option<VerdictStatus>,
    /// The status after the edit, or `None` if the verdict was withdrawn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub to: Option<VerdictStatus>,
    /// Whether the verdict's note text changed (independently of its status).
    pub note_changed: bool,
}

/// The writeup body change between two versions of a review, present in a
/// [`ReviewDiff`] only when the prose actually changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct WriteupChange {
    /// The writeup body before the edit.
    pub from: String,
    /// The writeup body after the edit.
    pub to: String,
}

/// The autogenerated, structured difference between two versions of a review: which
/// per-domain functional and aesthetic ratings changed, which checklist verdicts
/// flipped, and whether the writeup prose changed. Computed by [`diff_reviews`] when a reviewer edits their
/// review and stored on the resulting [`ReviewRevision`], so the edit history can
/// show *what* changed alongside the reviewer's note on *why*.
// The text is emitted into the contract; the link names core's item.
#[allow(rustdoc::broken_intra_doc_links)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewDiff {
    /// The per-domain rating changes, in the new review's domain order followed by
    /// any domains whose rating was removed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ratings: Vec<RatingChange>,
    /// The run-wide **aesthetic** rating change: at most one (domainless) entry
    /// on a new diff, kept as a `Vec` so old stored diffs — written when the
    /// channel was rated per domain — still deserialize. Empty on a legacy run's
    /// review, which carries no aesthetic channel, and when the tier held.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aesthetics: Vec<AestheticChange>,
    /// The checklist verdict changes, in the new review's verdict order followed by
    /// any verdicts that were withdrawn.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verdicts: Vec<VerdictChange>,
    /// The writeup change, or `None` when the prose was untouched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub writeup: Option<WriteupChange>,
}

impl ReviewDiff {
    /// Whether this diff records no change at all — no rating (functional or
    /// aesthetic) flipped, no verdict changed, and the writeup prose held. A
    /// re-submission with an empty diff is a no-op edit that need not be recorded
    /// as a revision.
    pub fn is_empty(&self) -> bool {
        self.ratings.is_empty()
            && self.aesthetics.is_empty()
            && self.verdicts.is_empty()
            && self.writeup.is_none()
    }
}

/// One superseded version of a review, recorded when the reviewer edits it: the note
/// the reviewer wrote explaining the change, when the edit was made, and the
/// autogenerated [`ReviewDiff`] from the prior content to the new. A review's
/// revisions are newest-last, so replaying their diffs from the original walks the
/// review forward to its current state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewRevision {
    /// RFC 3339 of when this edit was made.
    pub edited_at: String,
    /// The reviewer's note explaining what changed and why. Required on every edit.
    pub note: String,
    /// The autogenerated diff from the content before this edit to the content after.
    pub diff: ReviewDiff,
}
