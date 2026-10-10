//! The `coverage_plan` table: an account's named declarative coverage plan.
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
//! The remaining columns are how a plan is *filled* rather than what it declares: the
//! order it launches its cells in (`outer_axis`), how many of its own runs may be in
//! flight at once (`in_flight_limit`, over the account default), the fill in progress
//! (`fill_id`), and the claim that serializes launch passes (`launch_claimed_at`,
//! `launch_requested`).

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
    /// The owner-chosen display name (e.g. `Anthropic/E2E`).
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
    /// This plan's override of the account's runs-in-flight limit, or `NULL` to inherit
    /// `coverage_settings.in_flight_limit`. Nullable rather than defaulted because "no
    /// opinion" and "explicitly zero" are different instructions.
    ///
    /// A non-negative value is the bound itself; a **negative** value is the third
    /// instruction, "no bound — launch everything", which the backend reads and writes as
    /// its `InFlightLimit::Unbounded` and which no typed bound can ever collide with. The
    /// same encoding is used by `ladder.in_flight_limit` and
    /// `coverage_settings.in_flight_limit`.
    #[sea_orm(nullable)]
    pub in_flight_limit: Option<i32>,
    /// How many automatic retries each run the plan launches gets: the `retryCount` its
    /// launch passes put on every launch request. `1` unless the owner chose otherwise.
    pub retry_count: i32,
    /// RFC 3339 of when a launch pass claimed this plan, or `NULL` when none is running.
    ///
    /// A pass is started by the owner (All missing, a cell Retry) and by every finished
    /// run of a filling plan, so two can otherwise observe the same shortfall and both
    /// enqueue for it. A pass takes the plan by conditionally updating this column and
    /// clears it when finished; a timestamp rather than a flag, so a pass that dies
    /// midway expires out of the claim instead of wedging the plan.
    #[sea_orm(nullable)]
    pub launch_claimed_at: Option<String>,
    /// Whether another launch pass was asked for while the claim in
    /// [`Self::launch_claimed_at`] was held. The holder runs that pass before it lets go.
    pub launch_requested: bool,
    /// The fill in progress, or `NULL` when the plan is not filling. Set by All missing,
    /// cleared when every launchable cell is filled or the plan is halted. Every job a
    /// fill launches carries it in its origin (`plan:<id>/<fill_id>`), so an automatic
    /// retry of a job whose fill has ended is withheld.
    #[sea_orm(nullable)]
    pub fill_id: Option<String>,
    /// RFC 3339 of when the plan was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
