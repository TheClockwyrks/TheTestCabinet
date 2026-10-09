//! The canonical TOML emitter.
//!
//! The rules it applies are stated in the [module
//! overview](super#the-canonical-form); this file is how they are carried out.
//! The emitter serializes a model to a [`DocumentMut`] and then rewrites every
//! piece of formatting the document carries, so the bytes depend only on the
//! model and never on how the document was built.

use toml_edit::{Array, DocumentMut, Item, Table, Value};

/// The column budget an array's emitted line is measured against. A line that
/// fits is written inline; one that does not is written one entry per line.
pub const MAX_LINE_COLUMNS: usize = 100;

/// The indentation on each entry of a multi-line array.
const ARRAY_INDENT: &str = "  ";

/// Serialize a model as canonically formatted TOML.
///
/// The output always ends in a newline, and re-parsing it into the same type and
/// serializing again produces the identical bytes.
pub fn to_canonical_toml<T>(value: &T) -> Result<String, toml_edit::ser::Error>
where
    T: serde::Serialize + ?Sized,
{
    let mut document = toml_edit::ser::to_document(value)?;
    canonicalize_document(&mut document);
    Ok(document.to_string())
}

/// Rewrite a whole document into canonical form.
fn canonicalize_document(document: &mut DocumentMut) {
    document.decor_mut().clear();
    document.set_trailing("");
    canonicalize_table(document.as_table_mut());
    // The root table is the document itself and never carries a header.
    document.as_table_mut().set_implicit(false);
}

/// Rewrite one table: its own formatting, then each of its entries.
///
/// A table holding nothing but sub-tables is made implicit so its header
/// disappears and its children are emitted as full dotted headers. A table with
/// values of its own keeps its header, and an empty one keeps it too — an empty
/// table is a statement, not an absence.
fn canonicalize_table(table: &mut Table) {
    table.decor_mut().clear();
    table.set_dotted(false);
    table.set_implicit(!table.is_empty());
    for (mut key, item) in table.iter_mut() {
        key.fmt();
        let rendered_key = key.display_repr().into_owned();
        canonicalize_item(&rendered_key, item);
    }
}

/// Rewrite one entry of a table.
///
/// The item is first pushed into the most table-like shape it can take, so a
/// struct serialized as an inline table becomes a `[table]` and a list of structs
/// becomes repeated `[[tables]]`. Everything that is genuinely a value stays one.
fn canonicalize_item(key: &str, item: &mut Item) {
    make_item(item);
    match item {
        Item::Value(value) => canonicalize_value(key, value),
        Item::Table(table) => canonicalize_table(table),
        Item::ArrayOfTables(tables) => {
            for table in tables.iter_mut() {
                canonicalize_table(table);
            }
        }
        Item::None => {}
    }
}

/// Convert an inline table into a table, and an array of inline tables into an
/// array of tables, leaving anything else alone.
///
/// `toml_edit`'s serializer builds every nested struct as an inline value; this is
/// what turns those into the headers the canonical form emits. The library's own
/// equivalent is crate-private, so it is spelled out here over the public casts.
fn make_item(item: &mut Item) {
    let taken = std::mem::replace(item, Item::None);
    let taken = match taken.into_table() {
        Ok(table) => Item::Table(table),
        Err(unchanged) => unchanged,
    };
    let taken = match taken.into_array_of_tables() {
        Ok(tables) => Item::ArrayOfTables(tables),
        Err(unchanged) => unchanged,
    };
    *item = taken;
}

/// Rewrite one value: put a string into its basic-quoted form, lay out an array,
/// and strip the surrounding whitespace either way.
fn canonicalize_value(key: &str, value: &mut Value) {
    match value {
        Value::String(string) => {
            if let Some(quoted) = basic_quoted(string.value()) {
                *value = quoted;
            }
        }
        Value::Array(array) => {
            for entry in array.iter_mut() {
                canonicalize_value(key, entry);
            }
            layout_array(key, array);
        }
        _ => {}
    }
    value.decor_mut().clear();
}

/// The value `text`, carrying a basic-quoted representation of itself.
///
/// A string is not always rendered basic-quoted by default: `toml_edit` reaches
/// for a multi-line literal string when the value carries a newline, which is a
/// second spelling of the same value and therefore not canonical. The
/// representation a value carries can only be set by parsing one, so the escaped
/// literal is built here and read straight back. `None` is unreachable — the
/// literal is escaped to be parseable — and leaves the default representation in
/// place rather than losing the value.
fn basic_quoted(text: &str) -> Option<Value> {
    let document = format!("v = {}", basic_string(text))
        .parse::<DocumentMut>()
        .ok()?;
    let mut value = document.get("v")?.as_value()?.clone();
    value.decor_mut().clear();
    Some(value)
}

/// `text` as a TOML basic string, escaping only what TOML requires: the quote,
/// the backslash, and the control characters — by their short escape where one
/// exists and by `\uXXXX` otherwise.
fn basic_string(text: &str) -> String {
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('"');
    for character in text.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\u{8}' => quoted.push_str("\\b"),
            '\t' => quoted.push_str("\\t"),
            '\n' => quoted.push_str("\\n"),
            '\u{c}' => quoted.push_str("\\f"),
            '\r' => quoted.push_str("\\r"),
            control if control.is_control() => {
                quoted.push_str(&format!("\\u{:04X}", control as u32));
            }
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted
}

/// Choose an array's layout from the width of the line it would occupy.
///
/// The array is measured as it would be written inline, key included, because the
/// budget is a budget on the emitted line rather than on the array alone.
fn layout_array(key: &str, array: &mut Array) {
    array.set_trailing("");
    array.set_trailing_comma(false);
    let inline_width =
        key.chars().count() + " = ".chars().count() + array.to_string().chars().count();
    if inline_width <= MAX_LINE_COLUMNS {
        return;
    }
    for entry in array.iter_mut() {
        entry.decor_mut().set_prefix(format!("\n{ARRAY_INDENT}"));
        entry.decor_mut().set_suffix("");
    }
    array.set_trailing_comma(true);
    array.set_trailing("\n");
}

#[cfg(test)]
#[path = "canonical.test.rs"]
mod tests;
