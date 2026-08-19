//! The `ladder` table: a reviewer's ordered, gated climb through a sequence of test
//! cases.
//!
//! A ladder is a sibling of [`coverage_plan`](crate::coverage_plan), not a mode of
//! it. A plan declares an unordered *set* of cells and fills them; a ladder declares
//! an ordered list of **rungs** ([`ladder_rung`](crate::ladder_rung)) that each
//! harness+model combination climbs one at a time, carrying on past a rung only when
//! that rung's runs clear a quality **gate**. It answers "how far up my difficulty
//! ordering does this model get before it falls over?" without paying for the runs
//! above the wall.
//!
//! Membership works exactly as it does on a plan — `coverage_group` ids
//! (`kind = "combo"`) plus one-off combinations, resolved and de-duped by the
//! backend's shared `resolve_members` — so the same saved group of models can drive
//! both a plan and a ladder.
//!
//! Deliberately absent: any "current rung" pointer. Progress is per combination,
//! stored as [`ladder_outcome`](crate::ladder_outcome) rows, so a model added to a
//! standing ladder later starts at rung 1 while the models already halfway up carry
//! on. Per-combination steering (priority, focus, hold) lives in
//! [`ladder_climber`](crate::ladder_climber).

use sea_orm::entity::prelude::*;

// `Eq` is intentionally omitted: `gate_threshold_value` is `f64`, which is only
// `PartialEq` (matching `run`'s model, which drops `Eq` for the same reason).
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "ladder")]
pub struct Model {
    /// The ladder's opaque id (a UUID minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owning account's id (from the auth service, via the verified bearer
    /// token).
    pub user_id: String,
    /// The reviewer-chosen display name (e.g. `E2E difficulty climb`).
    pub name: String,
    /// Which axis the emission loop nests on: `"rung"` (finish a rung across every
    /// climber before anyone moves up) or `"combination"` (send one climber as far up
    /// as it gets before starting the next).
    ///
    /// An *ordering* control, not a scheduling one: `job.queue_seq` is monotonic and
    /// the dispatcher claims in ascending order, so emission order is execution
    /// order without the dispatcher knowing this column exists.
    pub outer_axis: String,
    /// The default target number of runs for each `rung × combination` cell. A rung
    /// may override it via `ladder_rung.runs_override` when one step needs more
    /// evidence than the rest.
    pub runs_per_cell: i32,
    /// The gate's quality floor as a `Rating` token (`flawless`, `great`,
    /// `passable`, `scuffed`, `broken`) — see `test_cabinet_core::review::Rating`.
    ///
    /// The gate is a single parameterised rule, not a menu of modes: **advance when
    /// `count(my runs on this rung rated <gate_floor> or better) >= <threshold>`**.
    /// The floor must be read from *this account's* `review` row and taken as the
    /// worst domain within that one review — never from `run.rating`, which is the
    /// worst domain across **all** reviewers and would let someone else's harsher
    /// review wall this reviewer's climb.
    pub gate_floor: String,
    /// How [`gate_threshold_value`](Self::gate_threshold_value) is interpreted:
    /// `"count"` (an absolute number of runs) or `"fraction"` (a share of the rung's
    /// completed runs, compared as `count >= fraction * completed`).
    pub gate_threshold_kind: String,
    /// The threshold itself: a whole number for the `count` kind, a `0.0..=1.0` share
    /// for the `fraction` kind. One column because there is only ever one threshold;
    /// `f64` represents the small integers of the `count` form exactly.
    ///
    /// The three phrasings this pairing has to express, at 5 runs per cell:
    /// "stop when over half are broken" is floor `scuffed` with fraction `0.5`;
    /// "stop when all are broken" is floor `scuffed` with count `1`; "pass if any run
    /// is passable or better" is floor `passable` with count `1`.
    pub gate_threshold_value: f64,
    /// Whether a rung may be decided on partial results, cancelling its still-queued
    /// runs. Off by default: the extra runs are evidence the reviewer asked for, and
    /// a rung normally completes all of them even once the outcome is determined.
    pub early_stop: bool,
    /// Whether a run with `loaded == false` counts as `broken` for the gate without
    /// needing a review. On by default, because otherwise a rung full of dead builds
    /// both blocks the climb and occupies buffer slots waiting for reviews that could
    /// only ever say the same thing.
    pub count_unloaded_as_broken: bool,
    /// Whether topping up is suspended. The mildest of the three halting controls:
    /// it stops new runs being emitted and leaves the queue untouched (`halt` is what
    /// additionally cancels).
    pub paused: bool,
    /// Whether submitting a review re-runs this ladder's top-up automatically. Off by
    /// default — a ladder that quietly enqueues work whenever a review lands has to be
    /// asked for.
    pub auto_top_up: bool,
    /// This ladder's override of the account's buffer target, or `NULL` to inherit
    /// `coverage_settings.buffer_target`. Nullable rather than defaulted because "no
    /// opinion" and "explicitly zero" are different instructions.
    #[sea_orm(nullable)]
    pub buffer_target: Option<i32>,
    /// RFC 3339 of when a top-up claimed this ladder, or `NULL` when none is running.
    /// Serializes top-up exactly as `coverage_plan.topping_up_at` does: a timestamp
    /// rather than a flag so a request that dies mid-top-up expires out of the claim
    /// instead of wedging the ladder.
    #[sea_orm(nullable)]
    pub topping_up_at: Option<String>,
    /// The referenced combination groups' ids as a JSON array of strings — the same
    /// `coverage_group` pointers a plan uses, so editing a group reshapes both.
    #[sea_orm(column_type = "Text")]
    pub combo_group_ids_json: String,
    /// The ladder's one-off harness+model combinations as a JSON array of
    /// `{ harness, model, provider? }`, unioned with the referenced groups.
    #[sea_orm(column_type = "Text")]
    pub combos_json: String,
    /// RFC 3339 of when the ladder was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
