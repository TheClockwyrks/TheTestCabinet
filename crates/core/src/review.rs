//! Reviews: a run's hand-written writeup and the quality rating that goes with
//! it.
//!
//! See `docs/results.md` and `docs/site.md`. A review is curatorial — authored
//! by a person after playing a finished build, not emitted by the run — so it is
//! deliberately **not** part of the [run record](crate::run_record) contract. It
//! lives beside a run as `writeup.md`, a Markdown file whose YAML frontmatter
//! carries the [`Rating`] and whose body is the prose shown before the playable
//! build. Publishing requires one (see [`crate::publish`]).
//!
//! The rating tiers here are mirrored as a TypeScript union in
//! `packages/ui/src/ratings.ts`; keep the two in lockstep.
//!
//! Most case types declare one or more scoring [`crate::test_case::Domain`]s; the
//! reviewer rates each independently and the run's **overall** rating is the
//! worst across them (see [`Writeup::overall_rating`]). Each review item carries
//! a point weight, and the run's **score** is the weight earned by passed items
//! over the total declared weight (see [`score`]).
//!
//! A [game jam](crate::test_case::TestType::GameJam) reviews differently: it has
//! no domains, its review items are graded on a five-level scale
//! ([`VerdictStatus::GRADES`], worth 0/1/3/5/10 points) rather than pass/fail, and
//! the reviewer supplies a single whole-game **overall** grade directly (the
//! reserved [`OVERALL_VERDICT_ID`] verdict; see [`aggregate_overall_grade`]) that
//! becomes the run's rating badge in place of a domain rating.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::test_case::{Domain, ReviewItem};

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
    /// Mostly implemented according to spec. Playable, but deviates from the
    /// spec or has bugs that impact playability.
    Scuffed,
    /// Doesn't follow the spec, or has bugs severe enough to render the game
    /// unplayable.
    Broken,
}

impl Rating {
    /// Every rating, ordered best to worst.
    pub const ALL: [Rating; 4] = [
        Rating::Flawless,
        Rating::Great,
        Rating::Scuffed,
        Rating::Broken,
    ];

    /// The wire token for this rating, matching its frontmatter and serde form.
    pub fn as_str(&self) -> &'static str {
        match self {
            Rating::Flawless => "flawless",
            Rating::Great => "great",
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
    /// Graded 🙁: not great. Worth 1 point.
    Poor,
    /// Graded 😐: neutral. Worth 3 points.
    Neutral,
    /// Graded 😀: great. Worth 5 points.
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

    /// The points one of the five graded tiers is worth (0/1/3/5/10), or `None`
    /// for the binary [`Pass`](VerdictStatus::Pass)/[`Fail`](VerdictStatus::Fail).
    pub fn grade_points(self) -> Option<u32> {
        match self {
            VerdictStatus::Broken => Some(0),
            VerdictStatus::Poor => Some(1),
            VerdictStatus::Neutral => Some(3),
            VerdictStatus::Great => Some(5),
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
/// not a declared [`ReviewItem`]), and becomes the run's rating badge on a jam.
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

/// A parsed review: a per-domain [`Rating`], the writeup prose it accompanies,
/// and the reviewer's verdicts on the case's declared checklist items.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Writeup {
    /// The reviewer's quality rating per scoring domain, in the order they appear
    /// in the writeup's frontmatter. A run is only ready to publish once every
    /// declared domain has a rating here (see [`missing_ratings`]); the run's
    /// overall rating is the worst across them ([`Self::overall_rating`]).
    pub ratings: Vec<DomainRating>,
    /// The writeup body — the Markdown prose shown before the playable build,
    /// with the frontmatter stripped and surrounding whitespace trimmed.
    pub body: String,
    /// The reviewer's verdicts on the case's declared checklist items, in the
    /// order they appear in the writeup's frontmatter. Empty for a case that
    /// declares no items, or a writeup that records none. A run is only ready to
    /// publish once every declared item has a verdict here (see
    /// [`missing_verdicts`]).
    pub checklist: Vec<ReviewVerdict>,
}

impl Writeup {
    /// The run's overall rating: the worst across its domain ratings, or `None`
    /// when it records none. A flawless mode cannot mask a broken one.
    pub fn overall_rating(&self) -> Option<Rating> {
        Rating::worst(self.ratings.iter().map(|domain| domain.rating))
    }

    /// The reviewer's whole-game overall grade, from the reserved
    /// [`OVERALL_VERDICT_ID`] checklist verdict (a [game jam](crate::test_case::TestType::GameJam)
    /// review), or `None` when the review records none.
    pub fn overall_grade(&self) -> Option<VerdictStatus> {
        self.checklist
            .iter()
            .find(|verdict| verdict.id == OVERALL_VERDICT_ID)
            .map(|verdict| verdict.status)
            .filter(|status| status.is_grade())
    }

    /// Render this review to its canonical `writeup.md` file contents: a
    /// per-domain `rating.<domain>` frontmatter block followed by the body.
    ///
    /// Reconstructing the file from the parsed parts normalizes whatever spacing
    /// the author used, so every published writeup has identical framing.
    ///
    /// Checklist verdicts follow the ratings in the frontmatter, one per line as
    /// `review.<id>: <status> [note]`. A note is normalized to a single line so a
    /// stray newline can never break the frontmatter block.
    pub fn to_file_string(&self) -> String {
        let mut frontmatter = String::new();
        for domain in &self.ratings {
            frontmatter.push_str(&format!(
                "rating.{}: {}\n",
                domain.domain,
                domain.rating.as_str()
            ));
        }
        for verdict in &self.checklist {
            frontmatter.push_str(&format!(
                "review.{}: {}",
                verdict.id,
                verdict.status.as_str()
            ));
            if let Some(note) = &verdict.note {
                let note = note.split_whitespace().collect::<Vec<_>>().join(" ");
                if !note.is_empty() {
                    frontmatter.push(' ');
                    frontmatter.push_str(&note);
                }
            }
            frontmatter.push('\n');
        }
        format!("---\n{frontmatter}---\n\n{}\n", self.body)
    }
}

/// The verdict ids the declared checklist `items` require that `writeup` does not
/// record a verdict for. An item graded as a whole contributes its own id; an
/// item with sub-items contributes one composite id per sub-item (see
/// [`ReviewItem::verdict_ids`]), so a review is incomplete until every sub-item
/// has been judged.
///
/// An empty result means every declared item has been addressed — the condition
/// the reviewer UI and the publish gate require so a case's checklist is
/// guaranteed to be worked through before a run is released. Verdicts for ids not
/// required by `items` are ignored: a stale entry does not, on its own, make a
/// review incomplete.
pub fn missing_verdicts(items: &[ReviewItem], writeup: &Writeup) -> Vec<String> {
    items
        .iter()
        .flat_map(|item| item.verdict_ids())
        .filter(|id| !writeup.checklist.iter().any(|v| &v.id == id))
        .collect()
}

/// The ids of declared `domains` that `writeup` does not record a rating for.
///
/// An empty result means every declared domain has been rated — the condition
/// the reviewer UI and the publish gate require so a run carries a rating for
/// every domain before it is released.
pub fn missing_ratings(domains: &[Domain], writeup: &Writeup) -> Vec<String> {
    domains
        .iter()
        .filter(|domain| !writeup.ratings.iter().any(|r| r.domain == domain.id))
        .map(|domain| domain.id.clone())
        .collect()
}

/// A run's numeric score: the point weight it earned over the total available.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Score {
    /// The weight of the items the reviewer marked `pass`. Fractional when a
    /// passed item is only partially credited — an item with sub-items earns the
    /// fraction of its weight whose sub-items passed (see [`score_checklist`]).
    pub earned: f64,
    /// The total weight of every declared item — the points available.
    pub total: u32,
}

/// A run's aggregate score across all of its reviews: the mean point weight
/// earned over the (shared) total available.
///
/// A run can carry more than one review (different people judging the same
/// build). The declared checklist — and therefore the [`Score::total`] — is the
/// same for every review of a run's variant, so the aggregate keeps that total
/// and averages only the weight each reviewer awarded. `earned` is therefore
/// fractional, sitting between the harshest and most generous review.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AggregateScore {
    /// The mean weight earned across the run's reviews.
    pub earned: f64,
    /// The total weight available — identical across the run's reviews.
    pub total: u32,
    /// How many reviews the average is taken over.
    pub reviews: u32,
}

/// The aggregate score across a run's per-review [`Score`]s: the mean weight
/// earned over the shared total. `None` when the run has no reviews — the
/// condition the publish gate forbids, so a published run always aggregates.
///
/// The total is taken as the largest across the reviews; in practice every
/// review of a run's variant scores the same declared checklist, so the totals
/// agree and the `max` is just defensive.
pub fn aggregate_score(scores: &[Score]) -> Option<AggregateScore> {
    if scores.is_empty() {
        return None;
    }
    let total = scores.iter().map(|score| score.total).max().unwrap_or(0);
    let earned = scores.iter().map(|score| score.earned).sum::<f64>() / scores.len() as f64;
    Some(AggregateScore {
        earned,
        total,
        reviews: scores.len() as u32,
    })
}

/// The aggregate overall rating across a run's reviews: the worst (lowest)
/// rating any reviewer gave any domain, or `None` when there are no ratings.
///
/// Each `review` is one reviewer's per-domain ratings. A single review's overall
/// rating is already the worst across its domains ([`Writeup::overall_rating`]);
/// taking the worst across every review's every domain therefore yields the
/// worst across the reviews — one harsh reviewer cannot be masked by a generous
/// one, just as one broken domain cannot be masked by a flawless one.
pub fn aggregate_rating<'a>(
    reviews: impl IntoIterator<Item = &'a [DomainRating]>,
) -> Option<Rating> {
    Rating::worst(
        reviews
            .into_iter()
            .flat_map(|ratings| ratings.iter().map(|domain| domain.rating)),
    )
}

/// Score a run by combining the case's declared `items` (which carry the point
/// weights) with the reviewer's `writeup` verdicts: an item earns its weight when
/// marked `pass` and none when marked `fail`. The total is the sum of every
/// item's weight, so the score is `earned / total` points.
///
/// `items` should be the effective checklist for the run's variant (common plus
/// the variant's own; see [`crate::test_case::TestCaseVersion::review_items_for`]).
///
/// A thin wrapper over [`score_checklist`], which does the same over the
/// verdicts directly — use that when you hold the verdicts without a parsed
/// [`Writeup`].
pub fn score(items: &[ReviewItem], writeup: &Writeup) -> Score {
    score_checklist(items, &writeup.checklist)
}

/// Score the case's declared `items` against a reviewer's `checklist` verdicts:
/// an item graded as a whole earns its weight when marked `pass` and none
/// otherwise, while an item with sub-items has its weight split evenly across
/// them and earns the fraction whose sub-items passed (so `earned` can be
/// fractional); the total is the sum of every item's weight.
///
/// The core of [`score`], split out for callers that carry the verdicts on their
/// own (rather than a parsed [`Writeup`]) — the backend scores its stored reviews
/// this way. Mirrors the TypeScript `scoreChecklist` in
/// `packages/ui/src/ratings.ts`.
pub fn score_checklist(items: &[ReviewItem], checklist: &[ReviewVerdict]) -> Score {
    let status = |id: &str| checklist.iter().find(|v| v.id == id).map(|v| v.status);
    let passed = |id: &str| status(id) == Some(VerdictStatus::Pass);
    let mut total = 0u32;
    let mut earned = 0f64;
    for item in items {
        let weight = f64::from(item.weight);
        if item.graded {
            // Graded on the five-level scale (game jams): the item's available
            // points are `MAX_GRADE_POINTS * weight`, and it earns the graded
            // tier's points times its weight. An unjudged item earns nothing.
            total += VerdictStatus::MAX_GRADE_POINTS * item.weight;
            let points = status(&item.id)
                .and_then(|status| status.grade_points())
                .unwrap_or(0);
            earned += f64::from(points) * weight;
        } else if item.sub_items.is_empty() {
            // Binary, graded as a whole: the item earns all its weight or none.
            total += item.weight;
            if passed(&item.id) {
                earned += weight;
            }
        } else {
            // Binary, graded per sub-item: the weight is split evenly, so the item
            // earns the fraction of its sub-items that passed.
            total += item.weight;
            let passed_subs = item
                .sub_items
                .iter()
                .filter(|sub| passed(&ReviewItem::sub_item_verdict_id(&item.id, &sub.id)))
                .count();
            earned += weight * passed_subs as f64 / item.sub_items.len() as f64;
        }
    }
    Score { earned, total }
}

/// A run's overall game grade: the worst overall grade across its `reviews`'
/// [`OVERALL_VERDICT_ID`] marks, or `None` when none carry one (a non-jam run, or
/// a jam run with no reviews). One harsh reviewer cannot be masked by a generous
/// one, mirroring [`aggregate_rating`].
///
/// Each item of `reviews` is one reviewer's checklist verdicts. This is the game-
/// jam analogue of the per-domain [`aggregate_rating`]: a jam has no scoring
/// domains, so the reviewer's whole-game mark is the run's rating badge instead.
pub fn aggregate_overall_grade<'a>(
    reviews: impl IntoIterator<Item = &'a [ReviewVerdict]>,
) -> Option<VerdictStatus> {
    VerdictStatus::worst_grade(reviews.into_iter().filter_map(|checklist| {
        checklist
            .iter()
            .find(|verdict| verdict.id == OVERALL_VERDICT_ID)
            .map(|verdict| verdict.status)
            .filter(|status| status.is_grade())
    }))
}

/// Parse a `writeup.md` file: its per-domain `rating.<domain>` frontmatter and
/// its prose body.
///
/// The file must open with a `---` fenced YAML frontmatter block containing at
/// least one `rating.<domain>` key set to one of the [`Rating`] tiers, and must
/// have a non-empty body after the frontmatter. Anything else is an
/// [`Error::Review`] explaining what was missing — this is what the publish gate
/// reports.
pub fn parse_writeup(raw: &str) -> Result<Writeup> {
    let (frontmatter, body) = split_frontmatter(raw)?;

    let ratings = parse_ratings(frontmatter)?;
    let checklist = parse_checklist(frontmatter)?;
    // A domain-scored case rates at least one `rating.<domain>`; a game jam rates
    // none but records its graded categories and overall mark as `review.<id>`
    // verdicts. A writeup carrying neither is empty of judgement and rejected.
    if ratings.is_empty() && checklist.is_empty() {
        return Err(Error::Review(
            "writeup frontmatter is missing a `rating.<domain>` entry or a `review.<id>` verdict"
                .to_string(),
        ));
    }

    let body = body.trim();
    if body.is_empty() {
        return Err(Error::Review(
            "writeup has no body — add the report prose after the frontmatter".to_string(),
        ));
    }

    Ok(Writeup {
        ratings,
        body: body.to_string(),
        checklist,
    })
}

/// Parse the per-domain ratings from a frontmatter block: every `rating.<domain>`
/// line, in order. The value must be one of the [`Rating`] tiers. An empty domain
/// id or an unrecognized tier is an [`Error::Review`] so a malformed rating is
/// reported rather than silently dropped.
fn parse_ratings(frontmatter: &str) -> Result<Vec<DomainRating>> {
    let mut ratings = Vec::new();
    for line in frontmatter.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let Some(domain) = name.trim().strip_prefix("rating.") else {
            continue;
        };
        let domain = domain.trim();
        if domain.is_empty() {
            return Err(Error::Review(
                "writeup has a `rating.` line with an empty domain id".to_string(),
            ));
        }
        let rating = Rating::parse(value).ok_or_else(|| {
            Error::Review(format!(
                "writeup `rating.{domain}` must be one of flawless, great, scuffed, broken \
                 (got `{}`)",
                value.trim()
            ))
        })?;
        ratings.push(DomainRating {
            domain: domain.to_string(),
            rating,
        });
    }
    Ok(ratings)
}

/// Parse the checklist verdicts from a frontmatter block: every `review.<id>`
/// line, in order. The value's first whitespace-delimited token is the status
/// (`pass` or `fail`) and the remainder, if any, is the reviewer's note. An empty
/// id or an unrecognized status is an [`Error::Review`] so a malformed verdict is
/// reported rather than silently dropped.
fn parse_checklist(frontmatter: &str) -> Result<Vec<ReviewVerdict>> {
    let mut verdicts = Vec::new();
    for line in frontmatter.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let Some(id) = name.trim().strip_prefix("review.") else {
            continue;
        };
        let id = id.trim();
        if id.is_empty() {
            return Err(Error::Review(
                "writeup has a `review.` checklist line with an empty item id".to_string(),
            ));
        }
        let value = value.trim();
        let (status_token, note) = match value.split_once(char::is_whitespace) {
            Some((status, rest)) => (status, rest.trim()),
            None => (value, ""),
        };
        let status = VerdictStatus::parse(status_token).ok_or_else(|| {
            Error::Review(format!(
                "writeup checklist item `{id}` has status `{status_token}`; \
                 expected pass or fail"
            ))
        })?;
        verdicts.push(ReviewVerdict {
            id: id.to_string(),
            status,
            note: (!note.is_empty()).then(|| note.to_string()),
        });
    }
    Ok(verdicts)
}

/// Split a Markdown document into its leading `---` frontmatter block and the
/// body that follows. Returns an [`Error::Review`] when no frontmatter is found.
fn split_frontmatter(raw: &str) -> Result<(&str, &str)> {
    // Tolerate a UTF-8 BOM and leading blank lines before the opening fence.
    let trimmed = raw.trim_start_matches('\u{feff}').trim_start();
    let after_open = trimmed
        .strip_prefix("---\n")
        .or_else(|| trimmed.strip_prefix("---\r\n"))
        .ok_or_else(|| {
            Error::Review(
                "writeup is missing its `---` frontmatter block with a `rating`".to_string(),
            )
        })?;

    // The closing fence is a line that is exactly `---`. Walk the lines tracking
    // each one's byte offset so the body can be split off after the fence.
    let mut offset = 0;
    for line in after_open.split_inclusive('\n') {
        if line.trim_end_matches('\n').trim_end_matches('\r') == "---" {
            let frontmatter = &after_open[..offset];
            let body = &after_open[offset + line.len()..];
            return Ok((frontmatter, body));
        }
        offset += line.len();
    }

    Err(Error::Review(
        "writeup frontmatter is not closed with a `---` line".to_string(),
    ))
}

#[cfg(test)]
#[path = "review.test.rs"]
mod tests;
