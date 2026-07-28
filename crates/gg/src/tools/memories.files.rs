//! The **file-shaped** memory tools: `create_memory`, `read_memory`, `edit_memory` and
//! `search_memories` — the surface the [markdown](crate::memories::MemoryStrategy::Markdown) and
//! [keyword-search](crate::memories::MemoryStrategy::KeywordSearch) strategies offer in place of
//! the [scratchpad](super)'s always-in-context notes.
//!
//! The four are one family because they share one premise: a memory's **body is not in the
//! window**. That is what makes them worth having (a run may hold far more memory than it could
//! afford to carry) and it is also what shapes each call:
//!
//! * `create_memory` writes the whole body at once, since the model has it in hand.
//! * `read_memory` is how a body gets into context *at all* — under markdown from a slug the
//!   pinned index showed, under keyword-search from a slug a search returned.
//! * `edit_memory` revises by **search/replace** rather than by rewriting: the model would
//!   otherwise have to hold the whole memory in the reply just to change a line of it, and a
//!   quoted search string is a check that it is editing the text it thinks it is.
//! * `search_memories` exists only where there is no index to read.
//!
//! Only one strategy's tools are ever offered, so `create_memory` can read the store to decide
//! whether it needs a `description` (the index entry) or merely accepts one.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::super::{
    MemoryHitData, Tool, ToolContext, ToolData, ToolOutcome, optional_str, required_str,
    required_str_array, saturating_u32,
};
use super::{
    CREATE_MEMORY_TOOL, EDIT_MEMORY_TOOL, READ_MEMORY_TOOL, SEARCH_MEMORIES_TOOL, bounds_note,
    failure_for, usage_data, usage_note,
};
use crate::memories::{MemoryChange, MemoryHit, MemoryStore};
use crate::model::ToolDefinition;

// ---------------------------------------------------------------------------
// create_memory
// ---------------------------------------------------------------------------

/// Creates a memory file: a slug, a description, and the initial contents.
pub struct CreateMemoryTool {
    store: Arc<Mutex<MemoryStore>>,
}

impl CreateMemoryTool {
    /// A tool creating memories in `store`.
    pub fn new(store: Arc<Mutex<MemoryStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for CreateMemoryTool {
    fn name(&self) -> &str {
        CREATE_MEMORY_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        let store = self.store.lock().expect("memory store lock");
        let caps = store.caps();
        let indexed = store.strategy().has_index();
        drop(store);

        let purpose = if indexed {
            "Record a new memory. gg adds it to your memory index — the list of slugs and \
             descriptions you can see above, which stays in your context — and keeps the \
             contents themselves outside your context until you `read_memory` them. Write the \
             `description` for a future you scanning that index and deciding whether this is the \
             memory it needs."
        } else {
            "Record a new memory. Its contents are kept outside your context window; you find it \
             again with `search_memories` and pull it back with `read_memory`, so write the words \
             you would search for into it. A `description` is optional and is shown alongside \
             search results."
        };
        ToolDefinition::new(
            CREATE_MEMORY_TOOL,
            format!(
                "{purpose} Memories persist for the session and survive context compaction{}.",
                bounds_note(&[
                    (caps.max_count, "memories"),
                    (caps.max_len_per_memory, "characters of contents each"),
                    (caps.max_len_index, "characters of index"),
                    (caps.max_len_description, "characters of description each"),
                ])
            ),
            json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "A short slug naming the memory (letters, digits, `-`, `_`, `.`), the handle every other memory call takes."
                    },
                    "description": {
                        "type": "string",
                        "description": if indexed {
                            "A one-line summary of what the memory holds, shown in your memory index."
                        } else {
                            "An optional one-line summary of what the memory holds, shown with search results."
                        }
                    },
                    "contents": {
                        "type": "string",
                        "description": "The memory's initial contents, as markdown."
                    }
                },
                "required": if indexed { json!(["name", "description", "contents"]) } else { json!(["name", "contents"]) },
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let name = match required_str(&args, "name", CREATE_MEMORY_TOOL) {
            Ok(name) => name,
            Err(error) => return error.into(),
        };
        let description = match optional_str(&args, "description", CREATE_MEMORY_TOOL) {
            Ok(description) => description.unwrap_or_default(),
            Err(error) => return error.into(),
        };
        let contents = match required_str(&args, "contents", CREATE_MEMORY_TOOL) {
            Ok(contents) => contents,
            Err(error) => return error.into(),
        };
        self.create(name, description, contents)
    }
}

impl CreateMemoryTool {
    /// Create a memory — the **standard, typed** `create_memory` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn create(
        &self,
        name: String,
        description: String,
        contents: String,
    ) -> ToolOutcome {
        let mut store = self.store.lock().expect("memory store lock");
        match store.create(&name, &description, &contents) {
            Ok(MemoryChange::Written) => ToolOutcome::ok(
                format!("Created memory `{name}`. {}", usage_note(&store)),
                format!("created memory `{name}`"),
            )
            .with_data(usage_data(&store)),
            Ok(_) => unreachable!("create yields Written"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("create_memory: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// read_memory
// ---------------------------------------------------------------------------

/// Reads one memory's contents back into the model's context.
pub struct ReadMemoryTool {
    store: Arc<Mutex<MemoryStore>>,
}

impl ReadMemoryTool {
    /// A tool reading memories from `store`.
    pub fn new(store: Arc<Mutex<MemoryStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for ReadMemoryTool {
    fn name(&self) -> &str {
        READ_MEMORY_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        let indexed = self
            .store
            .lock()
            .expect("memory store lock")
            .strategy()
            .has_index();
        ToolDefinition::new(
            READ_MEMORY_TOOL,
            if indexed {
                "Read one memory's full contents, by the slug your memory index lists it under. \
                 The index is always in front of you; the contents are not, so read a memory when \
                 the work you are doing is the work it is about."
            } else {
                "Read one memory's full contents, by the slug `search_memories` returned. Nothing \
                 about your memories is in your context until you read one."
            },
            json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The slug of the memory to read."
                    }
                },
                "required": ["name"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let name = match required_str(&args, "name", READ_MEMORY_TOOL) {
            Ok(name) => name,
            Err(error) => return error.into(),
        };
        self.read(name)
    }
}

impl ReadMemoryTool {
    /// Read a memory — the **standard, typed** `read_memory` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    ///
    /// The contents *are* the result, exactly as a skill's body is: there is nothing to say about
    /// a memory that the memory does not already say, and a wrapper around it would be prose a
    /// program has to strip back off.
    pub(crate) fn read(&self, name: String) -> ToolOutcome {
        let store = self.store.lock().expect("memory store lock");
        match store.read(&name) {
            Ok(memory) => {
                ToolOutcome::ok(memory.body().to_string(), format!("read memory `{name}`"))
            }
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("read_memory: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// edit_memory
// ---------------------------------------------------------------------------

/// Revises a memory by replacing one exact occurrence of a string.
pub struct EditMemoryTool {
    store: Arc<Mutex<MemoryStore>>,
}

impl EditMemoryTool {
    /// A tool editing memories in `store`.
    pub fn new(store: Arc<Mutex<MemoryStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for EditMemoryTool {
    fn name(&self) -> &str {
        EDIT_MEMORY_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        let caps = self.store.lock().expect("memory store lock").caps();
        ToolDefinition::new(
            EDIT_MEMORY_TOOL,
            format!(
                "Revise a memory in place by replacing the one exact occurrence of `old_string` \
                 with `new_string` — the same edit `edit_file` makes, on a memory instead of a \
                 file. Append to a memory by quoting its last line and replacing it with itself \
                 plus what you are adding. Fails if the text is missing or appears more than \
                 once{}, or if the edit would leave the memory empty — delete it instead when you \
                 no longer need it.",
                match caps.max_len_per_memory {
                    Some(cap) => format!(", or if the result would exceed {cap} characters"),
                    None => String::new(),
                }
            ),
            json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The slug of the memory to revise."
                    },
                    "old_string": {
                        "type": "string",
                        "description": "The exact text to replace, which must appear exactly once in the memory."
                    },
                    "new_string": {
                        "type": "string",
                        "description": "The text to put in its place. May be empty to cut the old text out."
                    }
                },
                "required": ["name", "old_string", "new_string"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let name = match required_str(&args, "name", EDIT_MEMORY_TOOL) {
            Ok(name) => name,
            Err(error) => return error.into(),
        };
        let old_string = match required_str(&args, "old_string", EDIT_MEMORY_TOOL) {
            Ok(old) => old,
            Err(error) => return error.into(),
        };
        // The replacement may legitimately be empty — that is how text is cut out — so it is read
        // as an optional string rather than a required one and defaults to "".
        let new_string = match optional_str(&args, "new_string", EDIT_MEMORY_TOOL) {
            Ok(new) => new.unwrap_or_default(),
            Err(error) => return error.into(),
        };
        self.edit(name, old_string, new_string)
    }
}

impl EditMemoryTool {
    /// Revise a memory — the **standard, typed** `edit_memory` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn edit(&self, name: String, old_string: String, new_string: String) -> ToolOutcome {
        let mut store = self.store.lock().expect("memory store lock");
        match store.edit(&name, &old_string, &new_string) {
            Ok(MemoryChange::Updated) => ToolOutcome::ok(
                format!("Edited memory `{name}`. {}", usage_note(&store)),
                format!("edited memory `{name}`"),
            )
            .with_data(usage_data(&store)),
            Ok(_) => unreachable!("edit yields Updated"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("edit_memory: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// search_memories
// ---------------------------------------------------------------------------

/// Finds the memories that mention a set of keywords, best first.
pub struct SearchMemoriesTool {
    store: Arc<Mutex<MemoryStore>>,
}

impl SearchMemoriesTool {
    /// A tool searching `store`.
    pub fn new(store: Arc<Mutex<MemoryStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for SearchMemoriesTool {
    fn name(&self) -> &str {
        SEARCH_MEMORIES_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        let caps = self.store.lock().expect("memory store lock").caps();
        ToolDefinition::new(
            SEARCH_MEMORIES_TOOL,
            format!(
                "Find the memories that mention any of `keywords`, best first. Matching is plain \
                 case-insensitive substring matching over each memory's slug, description and \
                 contents, ranked by how many of your keywords a memory mentions and then by how \
                 often — so pass several specific words rather than one sentence. Each result \
                 carries a short excerpt; `read_memory` the ones worth having in full.{}",
                match caps.max_results {
                    Some(cap) => format!(" At most {cap} results come back."),
                    None => String::new(),
                }
            ),
            json!({
                "type": "object",
                "properties": {
                    "keywords": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "The words to look for. At least one must be non-empty."
                    }
                },
                "required": ["keywords"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let keywords = match required_str_array(&args, "keywords", SEARCH_MEMORIES_TOOL) {
            Ok(keywords) => keywords,
            Err(error) => return error.into(),
        };
        self.search(keywords)
    }
}

impl SearchMemoriesTool {
    /// Search the memories — the **standard, typed** `search_memories` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn search(&self, keywords: Vec<String>) -> ToolOutcome {
        let store = self.store.lock().expect("memory store lock");
        let hits = match store.search(&keywords) {
            Ok(hits) => hits,
            Err(err) => {
                return ToolOutcome::failed(failure_for(&err), format!("search_memories: {err}"));
            }
        };
        // The store's lock is released before the results are rendered: the hits are owned, and
        // holding a mutex across a page of string formatting is a habit worth not having.
        let held = store.count();
        drop(store);

        if hits.is_empty() {
            // An empty *store* and a search that matched nothing are different situations with
            // different next moves — create the memory, or search for other words — so they read
            // differently rather than sharing one "no results" line.
            let output = if held == 0 {
                "You have no memories yet.".to_string()
            } else {
                format!("No memory matches those keywords ({held} in total).")
            };
            return ToolOutcome::ok(output, "searched memories (no matches)")
                .with_data(ToolData::MemoryHits(Vec::new()));
        }

        let output = hits
            .iter()
            .map(render_hit)
            .collect::<Vec<_>>()
            .join("\n")
            .to_string();
        ToolOutcome::ok(
            format!(
                "{} of {held} memories match, best first:\n\n{output}",
                hits.len()
            ),
            format!("searched memories ({} matches)", hits.len()),
        )
        .with_data(ToolData::MemoryHits(
            hits.iter().map(hit_data).collect::<Vec<_>>(),
        ))
    }
}

/// One search hit as the prose result renders it: the slug and description to decide on, the
/// numbers it was ranked by, and the excerpt that shows why it matched.
fn render_hit(hit: &MemoryHit) -> String {
    let described = if hit.description.is_empty() {
        format!("- `{}`", hit.name)
    } else {
        format!("- `{}` — {}", hit.name, hit.description)
    };
    format!(
        "{described} ({} keyword{}, {} occurrence{})\n  {}",
        hit.matched,
        if hit.matched == 1 { "" } else { "s" },
        hit.occurrences,
        if hit.occurrences == 1 { "" } else { "s" },
        hit.excerpt
    )
}

/// The structured form of one hit, for a program that ranks or filters the results itself.
fn hit_data(hit: &MemoryHit) -> MemoryHitData {
    MemoryHitData {
        name: hit.name.clone(),
        description: hit.description.clone(),
        matched: saturating_u32(hit.matched),
        occurrences: saturating_u32(hit.occurrences),
        excerpt: hit.excerpt.clone(),
    }
}

#[cfg(test)]
#[path = "memories.files.test.rs"]
mod tests;
