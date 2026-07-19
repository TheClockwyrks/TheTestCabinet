//! The `review` table: a run's quality reviews. A run may carry many, one per
//! reviewing account; the run's overall rating is the worst across them and its
//! score the average.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "review")]
pub struct Model {
    /// The review's own id (a UUID); the primary key. A run has many reviews, so
    /// the run id can no longer be the key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The run this review belongs to (FK to `run.id`). Indexed and non-unique;
    /// `(run_id, reviewer_user_id)` is unique, so an account reviews a run once.
    pub run_id: String,
    /// The reviewing account's id (from the auth service, via the verified bearer
    /// token). Reviews are attributed to an account, not anonymous.
    pub reviewer_user_id: String,
    /// The reviewer's username, denormalized at submission so the public snapshot
    /// is self-contained (accounts live in the auth service's separate database).
    pub reviewer_username: String,
    /// The reviewer's display name, denormalized at submission for the same reason.
    pub reviewer_display_name: String,
    /// The reviewer's per-domain ratings as a JSON array of `{domain, rating}`.
    #[sea_orm(column_type = "Text")]
    pub ratings: String,
    #[sea_orm(column_type = "Text")]
    pub writeup: String,
    /// The reviewer's checklist verdicts as a JSON array.
    #[sea_orm(column_type = "Text")]
    pub checklist: String,
    /// RFC 3339 of when the review was **first** submitted. Unlike before edit
    /// history existed, a later edit no longer overwrites this — it stamps
    /// [`edited_at`](Self::edited_at) instead, so this always means "first reviewed".
    pub reviewed_at: String,
    /// RFC 3339 of when the review was last edited, or `None` if it has never been
    /// edited since it was first submitted. Set on every edit; the newest
    /// `review_revision` row carries the same timestamp.
    pub edited_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::run::Entity",
        from = "Column::RunId",
        to = "super::run::Column::Id",
        on_delete = "Cascade"
    )]
    Run,
    #[sea_orm(has_many = "super::review_revision::Entity")]
    ReviewRevision,
}

impl Related<super::review_revision::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ReviewRevision.def()
    }
}

impl Related<super::run::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Run.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
