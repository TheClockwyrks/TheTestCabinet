//! The `ladder` table: an ordered, gated climb through a sequence of test cases — the
//! **configuration** only.
//!
//! A ladder is a sibling of [`coverage_plan`](crate::coverage_plan), not a mode of it. A
//! plan declares an unordered *set* of cells and fills them; a ladder declares an ordered
//! list of **rungs** ([`ladder_rung`](crate::ladder_rung)) that each harness+model
//! combination climbs one at a time, carrying on past a rung only when that rung's runs
//! clear a quality **gate**. It answers "how far up this difficulty ordering does this
//! model get before it fails a rung?" without paying for the runs above the rung it
//! failed.
//!
//! Membership works exactly as it does on a plan — `coverage_group` ids
//! (`kind = "combo"`) plus one-off combinations, resolved and de-duped by the backend's
//! shared `resolve_members` — so the same saved group of models can drive both a plan and
//! a ladder.
//!
//! This row launches nothing by itself. Running the ladder creates a
//! [`ladder_dispatch`](crate::ladder_dispatch): a snapshot of this configuration that owns
//! its runs and its standing. Editing the configuration never touches a dispatch in
//! progress; the next Run uses the edit.

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
    /// The owner-chosen display name (e.g. `E2E difficulty climb`).
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
    /// The gate is a single parameterised rule, not a menu of modes: **pass when
    /// `count(runs on this rung rated <gate_floor> or better) >= <threshold>`**.
    /// The rating read is each run's validator rating (`run.validator_rating`), never
    /// `run.rating`, which folds in reviewers' checklist overrides.
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
    /// runs. Off by default: the extra runs are evidence the owner asked for, and a rung
    /// normally completes all of them even once the outcome is determined.
    pub early_stop: bool,
    /// Whether a run with `loaded == false` counts as `broken` for the gate whatever its
    /// validator rating says. On by default.
    pub count_unloaded_as_broken: bool,
    /// This ladder's override of the account's runs-in-flight limit, or `NULL` to inherit
    /// `coverage_settings.in_flight_limit`. Nullable rather than defaulted because "no
    /// opinion" and "explicitly zero" are different instructions. Encoded exactly as
    /// `coverage_plan.in_flight_limit` is: a non-negative bound, or a negative value for
    /// "no bound — launch everything". A dispatch resolves it once, at Run.
    #[sea_orm(nullable)]
    pub in_flight_limit: Option<i32>,
    /// RFC 3339 of when a launch pass claimed this ladder, or `NULL` when none is running.
    /// A timestamp rather than a flag so a pass that dies midway expires out of the claim
    /// instead of wedging the ladder.
    #[sea_orm(nullable)]
    pub launch_claimed_at: Option<String>,
    /// Whether another launch pass was asked for while the claim in
    /// [`Self::launch_claimed_at`] was held. The holder runs that pass before it lets go,
    /// so a run that lands mid-pass is never left unseen.
    pub launch_requested: bool,
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
