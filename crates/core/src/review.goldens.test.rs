//! The shared scoring goldens, executed against the Rust implementation.
//!
//! Every file under `crates/contracts/fixtures/scoring/` holds the cases one function
//! pair must agree on: a function here (or in [`crate::comparison`] and
//! [`crate::test_case`]) and its mirror in `packages/run-stats/src/scoring.ts`. The
//! TypeScript half, `packages/run-stats/src/scoring.goldens.test.ts`, reads the same
//! files off the crate, so a case added on either side is executed by both suites.
//!
//! The expectations are this implementation's output. Every struct below is
//! `deny_unknown_fields`, and the TypeScript half rejects unknown keys too: a
//! misspelled key would otherwise fall back to its default and leave a case asserting
//! less than it reads as asserting.

use std::collections::HashSet;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::json;

use super::*;
use crate::comparison::{automated_only_score, automated_verdicts, covered_score};
use crate::test_case::{
    Domain, ReviewItem, SubReviewItem, apply_score_exclusions, merge_review_items,
};
use crate::validation::DebugScriptResult;

/// One golden file: a comment saying what it covers, and its cases.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Goldens<I, E> {
    #[serde(rename = "$comment")]
    comment: String,
    cases: Vec<Case<I, E>>,
}

/// One case: what goes in, what must come out, and why the case exists.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case<I, E> {
    name: String,
    why: String,
    input: I,
    expect: E,
}

/// Parse a golden file and run `check` over every case, naming the case on failure.
fn run<I: DeserializeOwned, E: DeserializeOwned>(raw: &str, check: impl Fn(&I, &E, &str)) {
    let goldens: Goldens<I, E> = serde_json::from_str(raw).expect("a well-formed golden file");
    assert!(!goldens.comment.trim().is_empty());
    assert!(!goldens.cases.is_empty());
    let mut names = HashSet::new();
    for case in &goldens.cases {
        assert!(
            names.insert(case.name.as_str()),
            "duplicate case `{}`",
            case.name
        );
        assert!(
            !case.why.trim().is_empty(),
            "case `{}` has no why",
            case.name
        );
        check(&case.input, &case.expect, &case.name);
    }
}

fn yes() -> bool {
    true
}

fn one() -> u32 {
    1
}

/// A checklist item in the shape both scorers read (`WeightedItem` on the TypeScript
/// side). The defaults are the wire defaults, so an expected item and an item read
/// back from [`ReviewItem`] compare with them filled in.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Item {
    id: String,
    weight: u32,
    #[serde(default)]
    graded: bool,
    #[serde(default = "yes")]
    scored: bool,
    #[serde(default)]
    failure_cap: Option<FailureCap>,
    #[serde(default)]
    domains: Vec<String>,
    #[serde(default)]
    sub_items: Vec<Point>,
}

/// A point within a category ([`SubReviewItem`]).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Point {
    id: String,
    #[serde(default = "one")]
    weight: u32,
    #[serde(default = "yes")]
    scored: bool,
    #[serde(default)]
    failure_cap: Option<FailureCap>,
    #[serde(default)]
    domains: Vec<String>,
}

impl Item {
    fn to_review_item(&self) -> ReviewItem {
        ReviewItem {
            id: self.id.clone(),
            title: self.id.clone(),
            text: String::new(),
            reference: None,
            proof: None,
            sequences: Vec::new(),
            frames: Vec::new(),
            weight: self.weight,
            graded: self.graded,
            domain: None,
            sub_items: self
                .sub_items
                .iter()
                .map(|point| SubReviewItem {
                    id: point.id.clone(),
                    title: point.id.clone(),
                    description: None,
                    weight: point.weight,
                    reference: None,
                    proof: None,
                    scored: point.scored,
                    validation: None,
                    failure_cap: point.failure_cap,
                    domains: point.domains.clone(),
                })
                .collect(),
            scored: self.scored,
            validation: None,
            failure_cap: self.failure_cap,
            domains: self.domains.clone(),
        }
    }

    fn of(item: &ReviewItem) -> Item {
        Item {
            id: item.id.clone(),
            weight: item.weight,
            graded: item.graded,
            scored: item.scored,
            failure_cap: item.failure_cap,
            domains: item.domains.clone(),
            sub_items: item
                .sub_items
                .iter()
                .map(|point| Point {
                    id: point.id.clone(),
                    weight: point.weight,
                    scored: point.scored,
                    failure_cap: point.failure_cap,
                    domains: point.domains.clone(),
                })
                .collect(),
        }
    }
}

fn review_items(items: &[Item]) -> Vec<ReviewItem> {
    items.iter().map(Item::to_review_item).collect()
}

/// A reviewer's verdict, without the note no scoring rule reads.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
struct Verdict {
    id: String,
    status: VerdictStatus,
}

impl Verdict {
    fn to_review_verdict(&self) -> ReviewVerdict {
        ReviewVerdict {
            id: self.id.clone(),
            status: self.status,
            note: None,
        }
    }

    fn of(verdict: &ReviewVerdict) -> Verdict {
        Verdict {
            id: verdict.id.clone(),
            status: verdict.status,
        }
    }
}

fn review_verdicts(verdicts: &[Verdict]) -> Vec<ReviewVerdict> {
    verdicts.iter().map(Verdict::to_review_verdict).collect()
}

/// One domain's rating.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
struct Rated {
    domain: String,
    rating: Rating,
}

impl Rated {
    fn of(rated: &DomainRating) -> Rated {
        Rated {
            domain: rated.domain.clone(),
            rating: rated.rating,
        }
    }
}

/// A debug-script result, reduced to the fields the scoring rules read.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Script {
    item_id: String,
    #[serde(default)]
    sub_item_id: Option<String>,
    #[serde(default = "yes")]
    ran: bool,
    #[serde(default)]
    precondition_unmet: bool,
    #[serde(default)]
    verdicts: Vec<Decided>,
}

/// One verdict a script decided.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Decided {
    id: String,
    pass: bool,
}

fn debug_scripts(scripts: &[Script]) -> Vec<DebugScriptResult> {
    scripts
        .iter()
        .map(|script| {
            let verdicts: Vec<_> = script
                .verdicts
                .iter()
                .map(|v| json!({ "id": v.id, "pass": v.pass }))
                .collect();
            serde_json::from_value(json!({
                "itemId": script.item_id,
                "subItemId": script.sub_item_id,
                "title": "",
                "script": "",
                "ran": script.ran,
                "preconditionUnmet": script.precondition_unmet,
                "verdicts": verdicts,
            }))
            .expect("a debug-script result")
        })
        .collect()
}

/// A [`Score`].
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ScoreOf {
    earned: f64,
    total: u32,
}

impl ScoreOf {
    fn of(score: Score) -> ScoreOf {
        ScoreOf {
            earned: score.earned,
            total: score.total,
        }
    }

    fn to_score(self) -> Score {
        Score {
            earned: self.earned,
            total: self.total,
        }
    }
}

/// An [`AggregateScore`].
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
struct AggregateOf {
    earned: f64,
    total: u32,
    reviews: u32,
}

impl AggregateOf {
    fn of(score: AggregateScore) -> AggregateOf {
        AggregateOf {
            earned: score.earned,
            total: score.total,
            reviews: score.reviews,
        }
    }

    fn to_aggregate(self) -> AggregateScore {
        AggregateScore {
            earned: self.earned,
            total: self.total,
            reviews: self.reviews,
        }
    }
}

macro_rules! golden {
    ($file:literal) => {
        include_str!(concat!("../../contracts/fixtures/scoring/", $file, ".json"))
    };
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChecklistInput {
    items: Vec<Item>,
    checklist: Vec<Verdict>,
}

#[test]
fn score_checklist_matches_the_goldens() {
    run(
        golden!("score_checklist"),
        |input: &ChecklistInput, expect: &ScoreOf, name| {
            let got = score_checklist(
                &review_items(&input.items),
                &review_verdicts(&input.checklist),
            );
            assert_eq!(ScoreOf::of(got), *expect, "case `{name}`");
        },
    );
}

/// The three figures the gate and the aggregations produce.
#[derive(Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Figures {
    rating: Option<Rating>,
    score: Option<AggregateOf>,
    overall_grade: Option<VerdictStatus>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GatedInput {
    gated: bool,
    reviewed: Figures,
}

#[test]
fn the_gate_matches_the_goldens() {
    run(
        golden!("gated"),
        |input: &GatedInput, expect: &Figures, name| {
            let reviewed = &input.reviewed;
            let got = Figures {
                rating: gated_rating(input.gated, reviewed.rating),
                score: gated_score(input.gated, reviewed.score.map(AggregateOf::to_aggregate))
                    .map(AggregateOf::of),
                overall_grade: gated_overall_grade(input.gated, reviewed.overall_grade),
            };
            assert_eq!(got, *expect, "case `{name}`");
        },
    );
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AggregateInput {
    scores: Vec<ScoreOf>,
    ratings: Vec<Vec<Rated>>,
    checklists: Vec<Vec<Verdict>>,
}

#[test]
fn the_aggregations_match_the_goldens() {
    run(
        golden!("aggregate"),
        |input: &AggregateInput, expect: &Figures, name| {
            let scores: Vec<Score> = input.scores.iter().map(|s| s.to_score()).collect();
            let ratings: Vec<Vec<DomainRating>> = input
                .ratings
                .iter()
                .map(|review| {
                    review
                        .iter()
                        .map(|r| DomainRating {
                            domain: r.domain.clone(),
                            rating: r.rating,
                        })
                        .collect()
                })
                .collect();
            let checklists: Vec<Vec<ReviewVerdict>> = input
                .checklists
                .iter()
                .map(|c| review_verdicts(c))
                .collect();
            let got = Figures {
                rating: aggregate_rating(ratings.iter().map(Vec::as_slice)),
                score: aggregate_score(&scores).map(AggregateOf::of),
                overall_grade: aggregate_overall_grade(checklists.iter().map(Vec::as_slice)),
            };
            assert_eq!(got, *expect, "case `{name}`");
        },
    );
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ValidatorDomainInput {
    domains: Vec<String>,
    items: Vec<Item>,
    debug_scripts: Vec<Script>,
}

#[test]
fn validator_domain_ratings_match_the_goldens() {
    run(
        golden!("validator_domain"),
        |input: &ValidatorDomainInput, expect: &Vec<Rated>, name| {
            let domains: Vec<Domain> = input
                .domains
                .iter()
                .map(|id| Domain {
                    id: id.clone(),
                    name: id.clone(),
                    description: String::new(),
                })
                .collect();
            let got = validator_domain_ratings(
                &domains,
                &review_items(&input.items),
                &debug_scripts(&input.debug_scripts),
            );
            let got: Vec<Rated> = got.iter().map(Rated::of).collect();
            assert_eq!(got, *expect, "case `{name}`");
        },
    );
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MergeInput {
    common: Vec<Item>,
    variant: Vec<Item>,
}

#[test]
fn merge_review_items_matches_the_goldens() {
    run(
        golden!("merge_review_items"),
        |input: &MergeInput, expect: &Vec<Item>, name| {
            let merged =
                merge_review_items(&review_items(&input.common), &review_items(&input.variant));
            let got: Vec<Item> = merged.iter().map(Item::of).collect();
            assert_eq!(got, *expect, "case `{name}`");
        },
    );
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExclusionsInput {
    items: Vec<Item>,
    excluded: Vec<String>,
}

#[test]
fn apply_score_exclusions_matches_the_goldens() {
    run(
        golden!("score_exclusions"),
        |input: &ExclusionsInput, expect: &Vec<Item>, name| {
            let mut items = review_items(&input.items);
            let excluded: HashSet<String> = input.excluded.iter().cloned().collect();
            apply_score_exclusions(&mut items, &excluded);
            let got: Vec<Item> = items.iter().map(Item::of).collect();
            assert_eq!(got, *expect, "case `{name}`");
        },
    );
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AutomatedInput {
    items: Vec<Item>,
    debug_scripts: Vec<Script>,
    verdicts: Vec<Verdict>,
}

#[derive(Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AutomatedExpect {
    automated_verdicts: Vec<Verdict>,
    automated_only_score: ScoreOf,
    covered_score: ScoreOf,
}

#[test]
fn the_automated_scores_match_the_goldens() {
    run(
        golden!("automated"),
        |input: &AutomatedInput, expect: &AutomatedExpect, name| {
            let items = review_items(&input.items);
            let scripts = debug_scripts(&input.debug_scripts);
            let got = AutomatedExpect {
                automated_verdicts: automated_verdicts(&scripts)
                    .iter()
                    .map(Verdict::of)
                    .collect(),
                automated_only_score: ScoreOf::of(automated_only_score(&items, &scripts)),
                covered_score: ScoreOf::of(covered_score(
                    &items,
                    &review_verdicts(&input.verdicts),
                )),
            };
            assert_eq!(got, *expect, "case `{name}`");
        },
    );
}

/// Every file in the goldens directory is one a test above executes, and every file a
/// test names is in it: a golden file added there and wired to no test here fails
/// this rather than going unasserted. The names are read off this file's `golden!`
/// calls, so the list cannot drift from the tests.
#[test]
fn every_golden_file_is_executed() {
    let source = include_str!("review.goldens.test.rs");
    let marker = "golden!(\"";
    let executed: std::collections::BTreeSet<String> = source
        .match_indices(marker)
        .map(|(at, _)| {
            let rest = &source[at + marker.len()..];
            rest[..rest.find('"').expect("a closed golden name")].to_owned()
        })
        .collect();
    let dir =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/scoring");
    let present: std::collections::BTreeSet<String> = std::fs::read_dir(&dir)
        .expect("the goldens directory")
        .map(|entry| entry.expect("a directory entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .map(|path| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .expect("a UTF-8 golden name")
                .to_owned()
        })
        .collect();
    assert!(!executed.is_empty());
    assert_eq!(
        executed,
        present,
        "the golden files the tests execute and the files in {}",
        dir.display()
    );
}
