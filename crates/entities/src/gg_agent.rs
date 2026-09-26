//! The `gg_agent` table: an operator's named, reusable **agent profile**, saved
//! independently of any one gg configuration.
//!
//! Many rows per account (keyed by the auth-service `user_id`), each with an opaque
//! `id`, the profile's name, an optional description, and the whole core `GgAgentConfig`
//! as JSON text. The model slots the profile's bindings defer to are part of that
//! profile, so they are stored with it.
//!
//! Data only: a saved agent is a way to author one agent once and import it into several
//! configurations, and it owns no run-time resources of its own. Memories, skills and
//! every other per-agent store stay scoped to the run that created them, exactly as they
//! were — two configurations importing the same agent share nothing at run time.
//!
//! The JSON column is read and written whole, like the capability set on `gg_config`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "gg_agent")]
pub struct Model {
    /// The saved agent's opaque id (minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owning account's id (from the auth service, via the verified bearer
    /// token).
    pub user_id: String,
    /// The profile's name — the same name the agent config carries, lifted out so the
    /// per-account list can order by it.
    pub name: String,
    /// A one-line note on what the agent is for. Empty when unset. The library's own
    /// note, not the caller-scoped description a roster entry carries.
    pub description: String,
    /// The whole agent profile as JSON (its type, capabilities, allowlist, prompt bits,
    /// roster and hooks).
    #[sea_orm(column_type = "Text")]
    pub agent_json: String,
    /// RFC 3339 of when the agent was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
