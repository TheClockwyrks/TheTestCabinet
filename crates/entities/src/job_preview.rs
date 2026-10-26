//! The `job_preview` table: the latest live preview frame a job's driver sent, per
//! frame index.
//!
//! Written only on PostgreSQL, where a frame is stored before it is acknowledged so
//! a subscriber connected to any replica is sent the current frames. A frame
//! replaces the one before it at the same index, and a job's rows are deleted once
//! the job ends.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "job_preview")]
pub struct Model {
    /// The job the frame belongs to. Half of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub job_id: String,
    /// The frame index (`AssetPreview.frame`). The other half of the composite
    /// primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub frame: i64,
    /// The `AssetPreview`, serialized verbatim.
    #[sea_orm(column_type = "Text")]
    pub preview_json: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
