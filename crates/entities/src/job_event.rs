//! The `job_event` table: one normalized event a job's driver delivered, keyed by the
//! job and the event's sequence.
//!
//! A job's rows, in sequence order, are its recorded stream. They are written as each
//! batch arrives, and removed only with the job row itself (`ON DELETE CASCADE`).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "job_event")]
pub struct Model {
    /// The job the event belongs to (FK to `job.id`). Half of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub job_id: String,
    /// The event's sequence within the job: `0` for its first event, rising by one per
    /// event. The other half of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub sequence: i64,
    /// The `HarnessEvent`, serialized verbatim.
    pub event_json: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::job::Entity",
        from = "Column::JobId",
        to = "super::job::Column::Id",
        on_delete = "Cascade"
    )]
    Job,
}

impl Related<super::job::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Job.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
