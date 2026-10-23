//! The `coverage_group` table: a reviewer's named, reusable set of harness+model
//! combinations or version-pinned cases.
//!
//! Many rows per account (keyed by the owner's identity in `user_id`), each with an opaque
//! `id` so coverage plans can reference it as a pointer. `kind` is `"combo"` or
//! `"case"`; `members_json` holds that kind's members as a JSON array
//! (`{ harness, model, provider? }` for a combo group, `{ slug, version, variant }`
//! for a case group) — stored whole like the other plan/review JSON columns, since
//! a group is small and read/written entire.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "coverage_group")]
pub struct Model {
    /// The group's opaque id (a UUID minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owner's identity: the Access assertion's email. A row made before the
    /// edge asserted the identity holds the retired auth service's account id.
    pub user_id: String,
    /// The member kind: `"combo"` (harness+model combinations) or `"case"`
    /// (version-pinned test cases).
    pub kind: String,
    /// The reviewer-chosen display name (e.g. `Anthropic models`).
    pub name: String,
    /// The group's members as a JSON array whose element shape depends on `kind`.
    #[sea_orm(column_type = "Text")]
    pub members_json: String,
    /// RFC 3339 of when the group was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
