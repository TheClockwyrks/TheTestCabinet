//! **Every arm of the wire's dispatch, driven with the arguments its own WIT function declares.**
//!
//! # Why this file exists
//!
//! [The reachability gate](super::tests) next door calls each operation id with **no arguments** and
//! asserts only that the failure is not `is not a call gg has`. That proves a row exists. It proves
//! nothing about what the row *does* — an arm that read argument 1 where the WIT declares argument 0,
//! or called a different host function entirely, passes it — and for a long time its own comment
//! deferred the rest to "its own family's test", which did not exist. Fifty-five arms had eight
//! tests between them.
//!
//! So this file builds each call's arguments **from gg's own WIT**, which is the same file the
//! guest's SDK lowers against and the same file [`bindgen!`](wasmtime::component::bindgen) generates
//! the typed hosts from. For every id the wire dispatches it finds the WIT function of that name,
//! synthesizes one value per declared parameter — in declaration order, of the declared type, down
//! through records, variants, enums, options and lists — and makes the call the way a guest makes
//! it. What it asserts is that the answer is **not a `WireFault`**: a fault is gg saying its own two
//! halves have parted, and a well-formed argument list producing one means this side of the wire
//! disagrees with the WIT about that call.
//!
//! It is generated rather than tabulated on purpose. A hand-written table is a second statement of
//! the same signatures, and the failure it would catch — an arm and a table drifting together — is
//! the failure this is for. An operation added to gg is covered by this the day it is added.
//!
//! # A transposition of two same-typed arguments
//!
//! `edit-file(path, old-string, new-string)` is three strings, and an arm that read them in any
//! order decodes cleanly, so the fault above cannot tell. [The second gate
//! here](markers_land_where_their_parameter_names) can: every string and every integer a call
//! carries is a **distinct** value built for one named parameter, so the JSON the membrane composed
//! for a tool says which parameter each of its fields was read from, and a swap lands a marker under
//! a field named for the other one.
//!
//! That reads **three records**, in order, because gg dispatches a call to three different places.
//! A call that ran a tool is read out of the [tool record](CallLog) — the exact JSON the membrane
//! composed. A call the double answers from its own state runs no tool, so it is read out of the
//! [api record](crate::sandbox::fake::RecordedApiCall::arguments), which the answering method fills
//! under the WIT's own parameter names: the docs family, the view family and the program library,
//! plus `context.archive-thread`, whose tool record carries its ranges as positional pairs that
//! name neither end. A call on the [feedback channel](super::wire::NON_OPERATIONS) is not an
//! operation at all and reaches no api: it is read out of the **membrane state** it landed in —
//! `report-module-error`'s pair in [`module_errors`](MembraneState::module_errors), and
//! `report-error`'s message and location on the captured
//! [`ProgramError`](crate::sandbox::ProgramError). [`UNATTRIBUTED`] is the record of the ids none of
//! the three reaches, and is empty. A `bool` pair is not covered on any call, there being only two
//! values to tell apart with.

use serde_json::Value as JsonValue;
use serde_json::json;

use super::wire_coding::{Value, decode_response};
use super::*;
use crate::sandbox::fake::{ApiLog, CallLog, FakeOperationApi, membrane, membrane_from};
use crate::sandbox::operations::OPERATIONS;

/// gg's own WIT, the same text [the component encoder](crate::sandbox::language::jvm::component)
/// stamps into a JVM module.
const WIT: &str = include_str!("../../../wit/gg-sandbox.wit");

/// The six ids whose **operation key** and **WIT function name** are not one kebab-case rename of
/// each other.
///
/// gg's operation vocabulary and its WIT are deliberately independent — see
/// [the operations table](crate::sandbox::operations)'s own header — and these six are where that
/// independence is visible: an operation is named within its family (`views.open_file`), and a WIT
/// function is named within an interface that also has to read well beside its neighbours
/// (`open-file-view`). Written out rather than inferred, and short on purpose: a seventh appears in
/// this gate's own failure as an id it cannot cover, which is the report a silent skip would not
/// give.
const ALIASES: &[(&str, &str)] = &[
    ("docs.close", "close-doc-view"),
    ("docs.close_all", "close-doc-views"),
    ("views.open_file", "open-file-view"),
    ("views.open_text", "open-text-view"),
    ("views.close", "close-view"),
];

#[test]
fn every_arm_decodes_the_arguments_its_wit_function_declares() {
    let resolve = resolve();
    let log = CallLog::default();
    let mut state = membrane(&log);

    let mut missing = Vec::new();
    let mut faulted = Vec::new();
    for id in OPERATIONS
        .iter()
        .map(|operation| operation.id.to_string())
        .chain(NON_OPERATIONS.iter().map(|id| (*id).to_string()))
    {
        let Some(call) = declared_call(&resolve, &id) else {
            missing.push(id);
            continue;
        };
        let promised = WireHost::call(&mut state, id.clone(), request(&call.arguments));
        let response = WireHost::take(&mut state);
        assert_eq!(
            response.len(),
            promised as usize,
            "`{id}` promised {promised} bytes and handed over {}",
            response.len()
        );
        let decoded = decode_response(&response)
            .unwrap_or_else(|fault| panic!("`{id}` answered a frame gg cannot read: {fault:?}"));
        // An `api-error` is a fine answer — the fake refuses some calls and fails others, and what
        // is under test is the decoding rather than the outcome. A **fault** is not: it is the wire
        // saying it could not read a request built from the very WIT the guest builds one from.
        if let Err((_, _, message)) = decoded
            && message.contains("defect in gg")
        {
            faulted.push(format!("{id}: {message}"));
        }
    }

    assert!(
        missing.is_empty(),
        "these ids have no function of that name in gg's WIT, so this gate cannot cover them: \
         {missing:?}"
    );
    assert!(
        faulted.is_empty(),
        "these arms could not read an argument list built from their own WIT signature: {faulted:#?}"
    );
}

/// **Every argument reaches the tool field its WIT parameter names**, which is what a transposition
/// of two same-typed arguments breaks and nothing else here can see.
///
/// Each call is built with a distinct value per string and per integer, so a value found again in
/// the JSON the membrane composed for a tool says which parameter it came from. `edit-file(path,
/// old-string, new-string)` sends `the-path`, `the-old-string` and `the-new-string`; an arm that
/// passed them in any other order lands `the-new-string` under `old_string`, and this says so by
/// name. The WIT and the tool argument are compared with their separators and their case removed,
/// because one is kebab-case and the other is what the loop's own api records.
///
/// A marker is attributed from whichever of the three records answered for the call: the tool
/// record, then the api record, then the membrane state. The order matters only where a call left
/// more than one — `context.archive-thread` runs a tool *and* fills an api record, and the tool's
/// positional pair is tried first and attributes neither end, so the named copy beside it is what
/// this reads. [`every_id_the_wire_dispatches_is_attributable`] is the other half of the walk: it
/// asserts there is no id the three records miss.
#[test]
fn markers_land_where_their_parameter_names() {
    let transposed = walk().transposed;
    assert!(
        transposed.is_empty(),
        "these arms read an argument the WIT declares for another parameter: {transposed:#?}"
    );
}

/// **Every id the wire dispatches has its arguments recorded somewhere**, which is what makes the
/// gate above exhaustive rather than a check of whatever happened to reach a tool.
///
/// [`UNATTRIBUTED`] is empty and the assertion is an equality rather than an `is_empty`, so an
/// operation that stops being attributable — a double that answers it from state without recording
/// what it answered, a tool record that collapses two arguments into a positional pair — reappears
/// here by name instead of going quietly uncovered.
#[test]
fn every_id_the_wire_dispatches_is_attributable() {
    assert_eq!(
        walk().unattributed,
        UNATTRIBUTED,
        "the ids whose arguments this gate cannot attribute have changed; \
         `UNATTRIBUTED` is the record of them and is wrong"
    );
}

/// What one walk of every id the wire dispatches found.
struct Walk {
    /// Every marker that landed under a field named for another parameter.
    transposed: Vec<String>,
    /// Every id with two markers or more that none of the three records attributes two of.
    unattributed: Vec<String>,
}

/// Drive every id the wire dispatches with the arguments its own WIT function declares, and read
/// each call's markers back out of the three records it could have left.
fn walk() -> Walk {
    let resolve = resolve();
    let log = CallLog::default();
    let api = FakeOperationApi::new(&log);
    let recorded: ApiLog = api.api_log();
    let mut state = membrane_from(api);

    let mut found = Walk {
        transposed: Vec::new(),
        unattributed: Vec::new(),
    };
    for id in OPERATIONS
        .iter()
        .map(|operation| operation.id.to_string())
        .chain(NON_OPERATIONS.iter().map(|id| (*id).to_string()))
    {
        let Some(call) = declared_call(&resolve, &id) else {
            continue;
        };
        let tools = log.calls().len();
        let calls = recorded.calls().len();
        let modules = state.module_errors.len();
        let errored = state.program_error.is_some();
        let _ = WireHost::call(&mut state, id.clone(), request(&call.arguments));
        let _ = WireHost::take(&mut state);

        // Every scalar the membrane composed for a tool, under the JSON key it sits below — a
        // scalar inside a list keeps its list's key, which is where `blocked-by` arrives.
        let mut tool: Vec<(String, JsonValue)> = Vec::new();
        for call in &log.calls()[tools..] {
            scalars_by_key(&call.args, None, &mut tool);
        }
        // Every scalar the double recorded for the operation itself, under the WIT's own parameter
        // names — what a call that runs no tool leaves behind.
        let mut answered: Vec<(String, JsonValue)> = Vec::new();
        for call in &recorded.calls()[calls..] {
            scalars_by_key(&call.arguments, None, &mut answered);
        }
        let captured = captured(&state, modules, errored);

        let sources = [tool, answered, captured];
        let landings: Vec<Vec<Option<&str>>> = sources
            .iter()
            .map(|source| landings(source, &call.markers))
            .collect();

        let mut attributed = 0;
        for (index, marker) in call.markers.iter().enumerate() {
            let Some(key) = landings.iter().find_map(|source| source[index]) else {
                continue;
            };
            attributed += 1;
            let expected = RENAMED
                .iter()
                .find_map(|(operation, parameter, field)| {
                    (*operation == id && *parameter == marker.name).then_some(*field)
                })
                .unwrap_or(&marker.name);
            if flattened(expected) != flattened(key) {
                found.transposed.push(format!(
                    "`{id}` declares `{}` and read it as `{key}`",
                    marker.name
                ));
            }
        }
        if call.markers.len() > 1 && attributed < 2 {
            found.unattributed.push(id);
        }
    }
    found
}

/// What the call just made left in the **membrane state**: the third record, and the only one the
/// [feedback channel](NON_OPERATIONS) leaves anything in.
///
/// `modules` and `errored` are the state as it stood before the call, so a pair reported by an
/// earlier id is not read again as this one's.
fn captured<A: OperationApi>(
    state: &MembraneState<A>,
    modules: usize,
    errored: bool,
) -> Vec<(String, JsonValue)> {
    let mut found = Vec::new();
    for (name, message) in &state.module_errors[modules..] {
        found.push(("name".to_string(), json!(name)));
        found.push(("message".to_string(), json!(message)));
    }
    // The throw's `kind` and `code` cross as enum case names and carry no marker, so the two
    // strings are the whole of what can be attributed here.
    if !errored && let Some(error) = &state.program_error {
        found.push(("message".to_string(), json!(error.message)));
        if let Some(location) = &error.location {
            found.push(("location".to_string(), json!(location)));
        }
    }
    found
}

/// Where each marker landed in `composed`: the key of the one field holding that value, or `None`.
///
/// `None` twice over. A value found under two different keys says nothing — it could have come from
/// either — and a key holding **two** markers is a positional argument rather than a named one (gg
/// composes a `range` as `[start, end]`), so neither of them can be attributed to a parameter by
/// name and the next record along is asked instead.
fn landings<'a>(composed: &'a [(String, JsonValue)], markers: &[Marker]) -> Vec<Option<&'a str>> {
    let found: Vec<Option<&str>> = markers
        .iter()
        .map(|marker| {
            let mut keys = composed
                .iter()
                .filter(|(_, value)| *value == marker.value)
                .map(|(key, _)| key.as_str());
            let first = keys.next();
            keys.next().map_or(first, |_| None)
        })
        .collect();
    found
        .iter()
        .map(|landing| {
            landing.filter(|key| found.iter().filter(|other| **other == Some(*key)).count() == 1)
        })
        .collect()
}

/// A membrane over a fresh double, with both of its records to hand — what a short test below
/// drives one id through.
fn driven() -> (MembraneState<FakeOperationApi>, ApiLog, CallLog) {
    let log = CallLog::default();
    let api = FakeOperationApi::new(&log);
    let recorded = api.api_log();
    (membrane_from(api), recorded, log)
}

/// Make one call over the wire, the way a guest makes one, and discard the answer.
fn dispatch(state: &mut MembraneState<FakeOperationApi>, id: &str, arguments: &[Value]) {
    let _ = WireHost::call(state, id.to_string(), request(arguments));
    let _ = WireHost::take(state);
}

/// **A range's two ends stay apart.** The tool record carries them as `[start, end]`, which names
/// neither, so the api record carries them again under `from` and `to` — and an arm that read the
/// WIT's `end` into `from` puts `29` where `11` belongs and fails this.
#[test]
fn an_archived_range_keeps_its_ends_apart() {
    let (mut state, recorded, _log) = driven();
    dispatch(
        &mut state,
        "context.archive_thread",
        &[Value::List(vec![Value::Record(vec![
            ("start".to_string(), Value::Int(11)),
            ("end".to_string(), Value::Int(29)),
        ])])],
    );

    let arguments = recorded
        .args("context.archive_thread")
        .expect("the archive was bracketed as an api call");
    assert_eq!(
        arguments["ranges"][0]["from"],
        json!(11),
        "the range's `start` is its `from`: {arguments}"
    );
    assert_eq!(
        arguments["ranges"][0]["to"],
        json!(29),
        "the range's `end` is its `to`: {arguments}"
    );
}

/// **A search's query and its three filters stay apart.** Four strings in a row, which decode
/// cleanly in any order, so nothing but their recorded names can tell a transposition.
#[test]
fn a_docs_search_reads_its_query_and_its_filter_apart() {
    let (mut state, recorded, _log) = driven();
    dispatch(
        &mut state,
        "docs.search",
        &[
            Value::Text("the-words".to_string()),
            Value::List(vec![Value::Text("the-module".to_string())]),
            Value::Text("the-declared-type".to_string()),
            Value::Text("function".to_string()),
            Value::Int(3),
            Value::Int(7),
        ],
    );

    let arguments = recorded
        .args("docs.search")
        .expect("the search was bracketed as an api call");
    assert_eq!(arguments["query"], json!("the-words"), "{arguments}");
    assert_eq!(arguments["modules"], json!(["the-module"]), "{arguments}");
    assert_eq!(arguments["type"], json!("the-declared-type"), "{arguments}");
    assert_eq!(arguments["kind"], json!("function"), "{arguments}");
    assert_eq!(arguments["offset"], json!(3), "{arguments}");
    assert_eq!(arguments["limit"], json!(7), "{arguments}");
}

/// **A text view's label and its body stay apart.** Two strings, and a swap opens a view titled
/// with the value the model wanted shown.
#[test]
fn a_text_view_reads_its_label_and_its_body_apart() {
    let (mut state, recorded, _log) = driven();
    dispatch(
        &mut state,
        "views.open_text",
        &[
            Value::Text("the-label".to_string()),
            Value::Text("the-body".to_string()),
        ],
    );

    let arguments = recorded
        .args("views.open_text")
        .expect("the view was bracketed as an api call");
    assert_eq!(arguments["label"], json!("the-label"), "{arguments}");
    assert_eq!(arguments["body"], json!("the-body"), "{arguments}");
}

/// **A module error's key and its message stay apart.** It is no operation and reaches no api, so
/// the record is the pair the capture host landed in the membrane's own state.
#[test]
fn a_reported_module_error_reads_its_name_and_its_message_apart() {
    let (mut state, _recorded, _log) = driven();
    dispatch(
        &mut state,
        "feedback.report_module_error",
        &[
            Value::Text("the-name".to_string()),
            Value::Text("the-message".to_string()),
        ],
    );

    assert_eq!(
        state.module_errors,
        vec![("the-name".to_string(), "the-message".to_string())],
        "the module's key and its message are the pair, in that order"
    );
}

/// **A program error's message and its location stay apart.** Two strings inside one record, kept
/// in the state's error slot rather than in either log.
#[test]
fn a_reported_program_error_reads_its_message_and_its_location_apart() {
    let (mut state, _recorded, _log) = driven();
    dispatch(
        &mut state,
        "feedback.report_error",
        &[Value::Record(vec![
            ("kind".to_string(), Value::Text("other".to_string())),
            ("code".to_string(), Value::None),
            (
                "message".to_string(),
                Value::Text("the-message".to_string()),
            ),
            (
                "location".to_string(),
                Value::Text("the-location".to_string()),
            ),
        ])],
    );

    let error = state
        .program_error
        .as_ref()
        .expect("the throw was captured in the membrane's state");
    assert_eq!(error.message, "the-message");
    assert_eq!(error.location.as_deref(), Some("the-location"));
}

/// The ids this gate cannot check the argument order of.
///
/// Empty, and asserted for equality rather than emptiness by
/// [`every_id_the_wire_dispatches_is_attributable`]: an id with two or more same-shaped arguments
/// that none of the three records attributes two of lands here, and the gate reports it by name.
const UNATTRIBUTED: &[&str] = &[];

/// The parameters whose WIT name and whose tool-argument name are not one renaming of each other.
///
/// gg's WIT and the JSON the loop's own api records are independent vocabularies, exactly as the
/// operation ids and the WIT function names are, and these are where that is visible. Short on
/// purpose: one more appears in this gate's own failure as an argument read under the wrong name,
/// which is the report a wildcard would not give.
const RENAMED: &[(&str, &str, &str)] = &[
    // A `turn-range` is `start`/`end` in the WIT only because `from` is a WIT keyword; every SDK
    // spells it `from`/`to`, as the model writes it, and so does the api the double records.
    ("context.archive_thread", "start", "from"),
    ("context.archive_thread", "end", "to"),
    ("memories.create_memory", "body", "contents"),
    ("memories.edit_memory", "search", "old_string"),
    ("memories.edit_memory", "replace", "new_string"),
    ("board.wait_for_issue", "id", "issueId"),
];

/// A name with its word separators and its case removed, so `completion-criteria` and
/// `completionCriteria` are the same name and `old-string` and `new-string` are not.
fn flattened(name: &str) -> String {
    name.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

/// Every scalar in `args`, paired with the JSON key it sits below.
///
/// A list keeps its key for the values inside it, because a one-element list of strings is how gg
/// carries `blocked-by` and the key is still what names it.
fn scalars_by_key(args: &JsonValue, key: Option<&str>, found: &mut Vec<(String, JsonValue)>) {
    match args {
        JsonValue::Object(fields) => {
            for (name, value) in fields {
                scalars_by_key(value, Some(name), found);
            }
        }
        JsonValue::Array(values) => {
            for value in values {
                scalars_by_key(value, key, found);
            }
        }
        JsonValue::String(_) | JsonValue::Number(_) => {
            found.push((key.unwrap_or_default().to_string(), args.clone()));
        }
        _ => {}
    }
}

/// gg's WIT, parsed.
fn resolve() -> wit_parser::Resolve {
    let mut resolve = wit_parser::Resolve::default();
    resolve
        .push_str("gg-sandbox.wit", WIT)
        .expect("gg's own WIT parses");
    resolve
}

/// One call for `id`, built from the parameters its WIT function declares.
///
/// `None` when no interface in gg's WIT has a function of that name, which is a gate that cannot see
/// the call rather than a call that is wrong — and is reported as such.
fn declared_call(resolve: &wit_parser::Resolve, id: &str) -> Option<Call> {
    let (namespace, key) = id.split_once('.')?;
    let name = ALIASES
        .iter()
        .find_map(|(operation, function)| (*operation == id).then(|| (*function).to_string()))
        .unwrap_or_else(|| key.replace('_', "-"));
    // The operation's own family first, then anywhere, so an operation stays resolvable even if
    // its function were declared on a different interface than the family gg files it under.
    let function = interface_function(resolve, namespace, &name).or_else(|| {
        resolve
            .interfaces
            .iter()
            .find_map(|(_, interface)| interface.functions.get(&name))
    })?;
    let mut call = Call::default();
    for param in &function.params {
        let value = value_of(resolve, &param.ty, &param.name, &mut call);
        call.arguments.push(value);
    }
    Some(call)
}

/// One call built from a WIT signature: the arguments a guest would encode, and where each
/// distinguishable one of them came from.
#[derive(Default)]
struct Call {
    /// The arguments, in declaration order.
    arguments: Vec<Value>,
    /// Every argument whose value is distinct enough to be recognised again on the far side, with
    /// the parameter or field name it was built for. See
    /// [`markers_land_where_their_parameter_names`].
    markers: Vec<Marker>,
    /// How many numeric markers have been minted, so the next one differs from all of them.
    numbers: i64,
}

/// One value a call carried, and the name of the thing it was the value of.
struct Marker {
    /// The WIT parameter or record field this value was built for.
    name: String,
    /// The value, as the membrane's own JSON holds it.
    value: JsonValue,
}

/// The function named `name` on the interface named `namespace`, when there is one.
fn interface_function<'a>(
    resolve: &'a wit_parser::Resolve,
    namespace: &str,
    name: &str,
) -> Option<&'a wit_parser::Function> {
    resolve
        .interfaces
        .iter()
        .find(|(_, interface)| interface.name.as_deref() == Some(namespace))
        .and_then(|(_, interface)| interface.functions.get(name))
}

/// One value of WIT type `kind`, for a parameter or field called `field`.
///
/// A **present** option rather than an absent one, and a one-element list rather than an empty one,
/// because the point is to make the decoder do its work: an absent option and an empty list are the
/// two shapes an arm that read nothing at all would also survive.
///
/// Every string and every integer is **distinct**, and `call` keeps what each one was built for, so
/// a value found again in the JSON the membrane composed says which parameter it came from. That is
/// the whole mechanism behind [`markers_land_where_their_parameter_names`]: two arguments of one
/// type are told apart by their values rather than by their positions.
fn value_of(
    resolve: &wit_parser::Resolve,
    kind: &wit_parser::Type,
    field: &str,
    call: &mut Call,
) -> Value {
    use wit_parser::{Type, TypeDefKind};
    match kind {
        Type::Bool => Value::Bool(true),
        Type::U8
        | Type::U16
        | Type::U32
        | Type::U64
        | Type::S8
        | Type::S16
        | Type::S32
        | Type::S64 => {
            // Distinct, and far enough from the numbers gg's own JSON carries — a count, an index,
            // a `0` an arm defaulted — that a marker found in a response is this argument rather
            // than a coincidence.
            call.numbers += 1;
            let number = 1_000 + call.numbers;
            call.markers.push(Marker {
                name: field.to_string(),
                value: JsonValue::from(number),
            });
            Value::Int(number)
        }
        Type::F32 | Type::F64 => Value::Float(1.5),
        Type::Char => Value::Text("c".to_string()),
        // A distinctive string per parameter, so a failure names which one the arm choked on rather
        // than showing the same word three times.
        Type::String => {
            call.markers.push(Marker {
                name: field.to_string(),
                value: JsonValue::from(format!("the-{field}")),
            });
            Value::Text(format!("the-{field}"))
        }
        Type::ErrorContext => Value::Text("context".to_string()),
        Type::Id(id) => match &resolve.types[*id].kind {
            TypeDefKind::Type(inner) => value_of(resolve, inner, field, call),
            TypeDefKind::Option(inner) => value_of(resolve, inner, field, call),
            TypeDefKind::List(inner) => Value::List(vec![value_of(resolve, inner, field, call)]),
            TypeDefKind::Record(record) => Value::Record(
                record
                    .fields
                    .iter()
                    .map(|it| (it.name.clone(), value_of(resolve, &it.ty, &it.name, call)))
                    .collect(),
            ),
            // An enum crosses as its case name; a variant as the two-field record the coding
            // declares. The first case in both, because a decoder that knows the type knows all of
            // them and one is enough to prove it is reading a case name rather than an index.
            TypeDefKind::Enum(kind) => Value::Text(kind.cases[0].name.clone()),
            TypeDefKind::Variant(kind) => {
                let case = &kind.cases[0];
                Value::Record(vec![
                    (
                        super::wire_coding::VARIANT_CASE.to_string(),
                        Value::Text(case.name.clone()),
                    ),
                    (
                        super::wire_coding::VARIANT_VALUE.to_string(),
                        case.ty
                            .map_or(Value::None, |ty| value_of(resolve, &ty, &case.name, call)),
                    ),
                ])
            }
            other => panic!(
                "gg's WIT grew a {other:?} in an argument, and this gate does not know how to \
                 build one"
            ),
        },
    }
}

/// An argument list, encoded the way a guest encodes one.
fn request(arguments: &[Value]) -> Vec<u8> {
    super::wire_coding::encode_ok(&Value::List(arguments.to_vec()))[1..].to_vec()
}
