//! The `coverage_plan` table: a reviewer's named declarative coverage plan.
//!
//! Many rows per account (keyed by the auth-service `user_id`), each with an opaque
//! `id`, a display name, and its own `runs_per_cell` target. A plan is **hybrid**:
//! it references reusable `coverage_group`s by id (`combo_group_ids_json` /
//! `case_group_ids_json`) and may also pin one-off members directly
//! (`combos_json` / `cases_json`). The backend resolves the group references,
//! unions them with the one-off members, and de-dupes before building the coverage
//! matrix. All list fields are JSON text, read and written whole like the other
//! plan/review columns.
//!
//! The remaining columns are how a plan is *fed* rather than what it declares: the
//! order it emits its cells in (`outer_axis`), how much unreviewed work it is
//! willing to leave outstanding (`buffer_target`, over the account default), whether
//! it tops itself up when a review lands (`auto_top_up`), whether it is suspended
//! (`paused`), and the claim marker that stops two callers topping up at once
//! (`topping_up_at`).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "coverage_plan")]
pub struct Model {
    /// The plan's opaque id (a UUID minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owning account's id (from the auth service, via the verified bearer
    /// token).
    pub user_id: String,
    /// The reviewer-chosen display name (e.g. `Anthropic/E2E`).
    pub name: String,
    /// The target number of runs desired for each `case × combination` cell.
    pub runs_per_cell: i32,
    /// The referenced combination groups' ids as a JSON array of strings.
    #[sea_orm(column_type = "Text")]
    pub combo_group_ids_json: String,
    /// The referenced case groups' ids as a JSON array of strings.
    #[sea_orm(column_type = "Text")]
    pub case_group_ids_json: String,
    /// The plan's one-off harness+model combinations as a JSON array of
    /// `{ harness, model, provider? }`.
    #[sea_orm(column_type = "Text")]
    pub combos_json: String,
    /// The plan's one-off version-pinned cases as a JSON array of
    /// `{ slug, version, variant }`.
    #[sea_orm(column_type = "Text")]
    pub cases_json: String,
    /// Which axis the cell loop nests on when the plan emits runs: `"case"` (the
    /// default and the original behaviour — finish one case across every
    /// combination, then move on) or `"combination"` (finish one combination across
    /// every case).
    ///
    /// This is an *ordering* control, not a scheduling one. `job.queue_seq` is
    /// monotonic and the dispatcher claims in ascending order, so the order a plan
    /// emits runs in is the order they execute in; nothing in the dispatcher knows
    /// this column exists.
    pub outer_axis: String,
    /// Whether topping up is suspended for this plan. The mildest of the three
    /// halting controls: it stops new runs being emitted and deliberately leaves
    /// everything already queued alone (`halt` is what additionally cancels).
    pub paused: bool,
    /// Whether submitting a review re-runs this plan's top-up automatically. Off by
    /// default, and never inherited by an existing plan — a plan that quietly
    /// enqueues work whenever the reviewer finishes a review has to be asked for.
    pub auto_top_up: bool,
    /// This plan's override of the account's buffer target, or `NULL` to inherit
    /// `coverage_settings.buffer_target`. Nullable rather than defaulted because
    /// "no opinion" and "explicitly zero" are different instructions.
    #[sea_orm(nullable)]
    pub buffer_target: Option<i32>,
    /// RFC 3339 of when a top-up claimed this plan, or `NULL` when none is running.
    ///
    /// Top-up is an endpoint the console calls rather than a background daemon, so
    /// two tabs — or one fast double review-submit — can otherwise both observe the
    /// same shortfall and both enqueue for it. A caller takes the plan by
    /// conditionally updating this column and clears it when finished. It holds a
    /// timestamp rather than a bare flag so a request that dies mid-top-up expires
    /// out of the claim instead of wedging the plan forever.
    #[sea_orm(nullable)]
    pub topping_up_at: Option<String>,
    /// RFC 3339 of when the plan was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
