//! The `snapshot_state` table: the single-row snapshot coalescing state, so a
//! pending refresh survives a restart. Always keyed by `id = 1`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "snapshot_state")]
pub struct Model {
    /// Always `1` — there is exactly one snapshot-state row.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: i32,
    /// Whether a publish has landed since the last successful upload.
    pub dirty: bool,
    /// RFC 3339 of the last successful R2 upload, or `NULL` if never uploaded.
    pub last_uploaded: Option<String>,
    /// Runs in the last uploaded snapshot, or `NULL` if never uploaded.
    pub last_run_count: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
