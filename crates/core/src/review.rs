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
//! A case declares one or more scoring [`crate::test_case::Domain`]s; the
//! reviewer rates each independently and the run's **overall** rating is the
//! worst across them (see [`Writeup::overall_rating`]). Each review item carries
//! a point weight, and the run's **score** is the weight earned by passed items
//! over the total declared weight (see [`score`]).

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
/// reviewer records one of these per item while judging the build. Ordered by
/// neither severity nor preference — it simply states what the reviewer found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum VerdictStatus {
    /// The item was checked and the build satisfies it. The item earns its
    /// weight toward the run's score.
    Pass,
    /// The item was checked and the build does not satisfy it. The item earns
    /// none of its weight.
    Fail,
}

impl VerdictStatus {
    /// The wire token for this status, matching its frontmatter and serde form.
    pub fn as_str(&self) -> &'static str {
        match self {
            VerdictStatus::Pass => "pass",
            VerdictStatus::Fail => "fail",
        }
    }

    /// Parse a status from its token, accepting surrounding whitespace and any
    /// case. Verdicts are binary — every declared item must be judged `pass` or
    /// `fail` so it counts toward the score one way or the other.
    pub fn parse(token: &str) -> Option<VerdictStatus> {
        match token.trim().to_ascii_lowercase().as_str() {
            "pass" => Some(VerdictStatus::Pass),
            "fail" => Some(VerdictStatus::Fail),
            _ => None,
        }
    }
}

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

/// The ids of declared checklist `items` that `writeup` does not record a verdict
/// for.
///
/// An empty result means every declared item has been addressed — the condition
/// the reviewer UI and the publish gate require so a case's checklist is
/// guaranteed to be worked through before a run is released. Verdicts for ids not
/// among `items` are ignored: a stale entry does not, on its own, make a review
/// incomplete.
pub fn missing_verdicts(items: &[ReviewItem], writeup: &Writeup) -> Vec<String> {
    items
        .iter()
        .filter(|item| !writeup.checklist.iter().any(|v| v.id == item.id))
        .map(|item| item.id.clone())
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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Score {
    /// The weight of the items the reviewer marked `pass`.
    pub earned: u32,
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
    let earned = scores
        .iter()
        .map(|score| f64::from(score.earned))
        .sum::<f64>()
        / scores.len() as f64;
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
pub fn score(items: &[ReviewItem], writeup: &Writeup) -> Score {
    let total = items.iter().map(|item| item.weight).sum();
    let earned = items
        .iter()
        .filter(|item| {
            writeup
                .checklist
                .iter()
                .any(|v| v.id == item.id && v.status == VerdictStatus::Pass)
        })
        .map(|item| item.weight)
        .sum();
    Score { earned, total }
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
    if ratings.is_empty() {
        return Err(Error::Review(
            "writeup frontmatter is missing a `rating.<domain>` entry".to_string(),
        ));
    }

    let checklist = parse_checklist(frontmatter)?;

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
