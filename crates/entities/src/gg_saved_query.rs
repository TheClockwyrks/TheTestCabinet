//! The `gg_saved_query` table: an operator's named, reusable TCQ query.
//!
//! Many rows per account (keyed by the auth-service `user_id`), each with an opaque
//! `id`, a display name, an optional description, and the query as **source text**.
//! The corpus a query runs over is deployment-wide — a gg run belongs to the
//! deployment, exactly as the run listings already treat runs — but a *view* over it
//! is personal, which is the asymmetry the whole saved-object model rests on.
//!
//! The text, never a compiled query, is the load-bearing choice: a relative
//! `started >= now-30d` stays relative and re-resolves on every run, and a later
//! grammar addition cannot invalidate something already stored. It also means this
//! table holds no query semantics at all — the client parses, the backend evaluates
//! the compiled form, and nothing here has to know what a stage is.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "gg_saved_query")]
pub struct Model {
    /// The query's opaque id (minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owning account's id (from the auth service, via the verified bearer
    /// token).
    pub user_id: String,
    /// The operator-chosen display name (e.g. `overflow by model`).
    pub name: String,
    /// A one-line note on what the query answers. Empty when unset.
    pub description: String,
    /// The query as TCQ **source text**, exactly as it was typed.
    #[sea_orm(column_type = "Text")]
    pub query_text: String,
    /// The id of the time range the query was saved with (a
    /// `TimeRangePicker` token such as `30d`, or `all`). Stored beside the text
    /// rather than inside it because the range is a control, not an edit.
    pub range_id: String,
    /// RFC 3339 of when the query was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
