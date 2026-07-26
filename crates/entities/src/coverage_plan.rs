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
    /// RFC 3339 of when the plan was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
