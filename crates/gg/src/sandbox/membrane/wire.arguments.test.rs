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
//! # What it does not prove, said plainly rather than deferred
//!
//! **A transposition of two same-typed arguments.** `edit-file(path, old, new)` is three strings; an
//! arm that read them in any order decodes cleanly and this cannot tell. What it does catch is every
//! *shape* mistake: the wrong arity, an argument read at the wrong index where the types differ, a
//! record field named wrongly, an option read as a value, a list read as a scalar, an enum case gg
//! does not have. Where a same-typed pair matters enough to pin down,
//! [the wire's own tests](super::tests) drive the call end to end and assert on what reached the
//! loop.

use super::wire_coding::{Value, decode_response};
use super::*;
use crate::sandbox::fake::{CallLog, membrane};
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
    ("views.current", "current-views"),
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
        let Some(arguments) = declared_arguments(&resolve, &id) else {
            missing.push(id);
            continue;
        };
        let promised = WireHost::call(&mut state, id.clone(), request(&arguments));
        let response = WireHost::take(&mut state);
        assert_eq!(
            response.len(),
            promised as usize,
            "`{id}` promised {promised} bytes and handed over {}",
            response.len()
        );
        let decoded = decode_response(&response)
            .unwrap_or_else(|fault| panic!("`{id}` answered a frame gg cannot read: {fault:?}"));
        // A `tool-error` is a fine answer — the fake refuses some calls and fails others, and what
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

/// gg's WIT, parsed.
fn resolve() -> wit_parser::Resolve {
    let mut resolve = wit_parser::Resolve::default();
    resolve
        .push_str("gg-sandbox.wit", WIT)
        .expect("gg's own WIT parses");
    resolve
}

/// One argument list for `id`, built from the parameters its WIT function declares.
///
/// `None` when no interface in gg's WIT has a function of that name, which is a gate that cannot see
/// the call rather than a call that is wrong — and is reported as such.
fn declared_arguments(resolve: &wit_parser::Resolve, id: &str) -> Option<Vec<Value>> {
    let (namespace, key) = id.split_once('.')?;
    let name = ALIASES
        .iter()
        .find_map(|(operation, function)| (*operation == id).then(|| (*function).to_string()))
        .unwrap_or_else(|| key.replace('_', "-"));
    // The operation's own family first, then anywhere: three operations gg files under `files` are
    // declared on `helpers`, which is the interface for the convenience wrappers built on a tool
    // without being one.
    let function = interface_function(resolve, namespace, &name).or_else(|| {
        resolve
            .interfaces
            .iter()
            .find_map(|(_, interface)| interface.functions.get(&name))
    })?;
    Some(
        function
            .params
            .iter()
            .map(|param| value_of(resolve, &param.ty, &param.name))
            .collect(),
    )
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
fn value_of(resolve: &wit_parser::Resolve, kind: &wit_parser::Type, field: &str) -> Value {
    use wit_parser::{Type, TypeDefKind};
    match kind {
        Type::Bool => Value::Bool(true),
        Type::U8 | Type::U16 | Type::U32 | Type::U64 => Value::Int(1),
        Type::S8 | Type::S16 | Type::S32 | Type::S64 => Value::Int(1),
        Type::F32 | Type::F64 => Value::Float(1.5),
        Type::Char => Value::Text("c".to_string()),
        // A distinctive string per parameter, so a failure names which one the arm choked on rather
        // than showing the same word three times.
        Type::String => Value::Text(format!("the-{field}")),
        Type::ErrorContext => Value::Text("context".to_string()),
        Type::Id(id) => match &resolve.types[*id].kind {
            TypeDefKind::Type(inner) => value_of(resolve, inner, field),
            TypeDefKind::Option(inner) => value_of(resolve, inner, field),
            TypeDefKind::List(inner) => Value::List(vec![value_of(resolve, inner, field)]),
            TypeDefKind::Record(record) => Value::Record(
                record
                    .fields
                    .iter()
                    .map(|it| (it.name.clone(), value_of(resolve, &it.ty, &it.name)))
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
                            .map_or(Value::None, |ty| value_of(resolve, &ty, &case.name)),
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
