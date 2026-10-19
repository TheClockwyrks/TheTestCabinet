//! The Blob client against a stub Blob service on a loopback socket: every
//! operation, listing pages, staged uploads, Shared Key verification from the
//! request as received, and workload-identity token caching.
// cspell:disable

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, Method as HttpMethod, StatusCode, Uri};
use axum::response::Response;
use base64::Engine as _;
use bytes::Bytes;

use super::*;
use crate::object::{body_from_bytes, collect_body};

const ACCOUNT: &str = "devstoreaccount1";
const KEY: &str =
    "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const TENANT: &str = "tenant-1";

fn key_bytes() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(KEY)
        .unwrap()
}

/// One stored blob.
#[derive(Clone)]
struct Stored {
    data: Bytes,
    content_type: Option<String>,
    content_encoding: Option<String>,
}

/// How the stub authenticates a request.
#[derive(Clone, Copy, PartialEq)]
enum Auth {
    SharedKey,
    Bearer,
}

/// The stub service's state.
struct Stub {
    auth: Auth,
    containers: HashSet<String>,
    blobs: BTreeMap<(String, String), Stored>,
    staged: HashMap<(String, String, String), Bytes>,
    /// `<METHOD> <comp or kind>` of every authenticated blob request, in order.
    log: Vec<String>,
    /// The listing page size the stub enforces.
    page_size: usize,
    /// Token endpoint: calls made, the lifetime it grants, and the bearer
    /// tokens it will refuse once each.
    token_calls: usize,
    token_lifetime: u64,
    refuse_once: HashSet<String>,
    bearers_seen: Vec<String>,
}

type Shared = Arc<Mutex<Stub>>;

fn decode(text: &str) -> String {
    percent_encoding::percent_decode_str(text)
        .decode_utf8_lossy()
        .into_owned()
}

fn query_pairs(uri: &Uri) -> Vec<(String, String)> {
    uri.query()
        .unwrap_or("")
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode(name), decode(value))
        })
        .collect()
}

fn reply(status: u16, code: &str) -> Response {
    let mut response = Response::new(Body::from(format!("<Error><Code>{code}</Code></Error>")));
    *response.status_mut() = StatusCode::from_u16(status).unwrap();
    if !code.is_empty() {
        response
            .headers_mut()
            .insert("x-ms-error-code", code.parse().unwrap());
    }
    response
}

fn header(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

/// Check the request's credential against what the stub expects, from the
/// request exactly as it arrived: the refusal, or `None` to proceed.
fn authenticate(
    stub: &mut Stub,
    method: &HttpMethod,
    uri: &Uri,
    headers: &HeaderMap,
) -> Option<Response> {
    let authorization = header(headers, "authorization").unwrap_or_default();
    match stub.auth {
        Auth::SharedKey => {
            let received: Vec<(String, String)> = headers
                .iter()
                .map(|(name, value)| {
                    (
                        name.as_str().to_string(),
                        value.to_str().unwrap_or("").to_string(),
                    )
                })
                .collect();
            let query = query_pairs(uri);
            let string_to_sign = sign::string_to_sign(&sign::SignedRequest {
                method: method.as_str(),
                headers: &received,
                account: ACCOUNT,
                path: uri.path(),
                query: &query,
            });
            let expected = format!(
                "SharedKey {ACCOUNT}:{}",
                sign::signature(&key_bytes(), &string_to_sign)
            );
            if authorization != expected {
                return Some(reply(403, "AuthenticationFailed"));
            }
        }
        Auth::Bearer => {
            let Some(token) = authorization.strip_prefix("Bearer ") else {
                return Some(reply(401, "NoAuthenticationInformation"));
            };
            stub.bearers_seen.push(token.to_string());
            if stub.refuse_once.remove(token) {
                return Some(reply(401, "InvalidAuthenticationInfo"));
            }
            if !token.starts_with("token-") {
                return Some(reply(401, "InvalidAuthenticationInfo"));
            }
        }
    }
    // Every header the client signs is sent once.
    if headers
        .keys()
        .any(|name| headers.get_all(name).iter().count() > 1)
    {
        return Some(reply(400, "InvalidHeaderValue"));
    }
    if header(headers, "x-ms-version").as_deref() != Some(API_VERSION) {
        return Some(reply(400, "InvalidHeaderValue"));
    }
    None
}

fn blob_response(stored: &Stored, body: Option<Bytes>, status: u16) -> Response {
    let length = body.as_ref().map_or(stored.data.len(), Bytes::len);
    let mut response = Response::new(body.map(Body::from).unwrap_or_else(Body::empty));
    *response.status_mut() = StatusCode::from_u16(status).unwrap();
    let headers = response.headers_mut();
    headers.insert("content-length", length.to_string().parse().unwrap());
    if let Some(content_type) = &stored.content_type {
        headers.insert("content-type", content_type.parse().unwrap());
    }
    if let Some(encoding) = &stored.content_encoding {
        headers.insert("content-encoding", encoding.parse().unwrap());
    }
    headers.insert(
        "last-modified",
        "Mon, 19 Oct 2026 12:03:04 GMT".parse().unwrap(),
    );
    headers.insert("etag", "\"0x1\"".parse().unwrap());
    response
}

fn list_xml(stub: &Stub, container: &str, query: &HashMap<String, String>) -> String {
    let prefix = query.get("prefix").cloned().unwrap_or_default();
    let delimiter = query.get("delimiter").cloned();
    let marker = query.get("marker").cloned().unwrap_or_default();
    let page = query
        .get("maxresults")
        .and_then(|value| value.parse().ok())
        .unwrap_or(usize::MAX)
        .min(stub.page_size);
    // Entries in name order: a blob, or a rolled-up virtual directory.
    let mut entries: BTreeMap<String, Option<usize>> = BTreeMap::new();
    for ((owner, name), stored) in &stub.blobs {
        if owner != container || !name.starts_with(&prefix) {
            continue;
        }
        let rest = &name[prefix.len()..];
        match delimiter
            .as_deref()
            .and_then(|d| rest.find(d).map(|at| (d, at)))
        {
            Some((d, at)) => {
                entries.insert(format!("{prefix}{}", &rest[..at + d.len()]), None);
            }
            None => {
                entries.insert(name.clone(), Some(stored.data.len()));
            }
        }
    }
    let mut xml = String::from("<?xml version=\"1.0\"?><EnumerationResults><Blobs>");
    let mut remaining = entries.range(marker..);
    for (name, size) in remaining.by_ref().take(page) {
        match size {
            Some(size) => xml.push_str(&format!(
                "<Blob><Name>{name}</Name><Properties><Last-Modified>Mon, 19 Oct 2026 12:03:04 GMT</Last-Modified><Content-Length>{size}</Content-Length></Properties></Blob>"
            )),
            None => xml.push_str(&format!("<BlobPrefix><Name>{name}</Name></BlobPrefix>")),
        }
    }
    xml.push_str("</Blobs>");
    match remaining.next() {
        Some((next, _)) => xml.push_str(&format!("<NextMarker>{next}</NextMarker>")),
        None => xml.push_str("<NextMarker />"),
    }
    xml.push_str("</EnumerationResults>");
    xml
}

async fn handle(
    State(stub): State<Shared>,
    method: HttpMethod,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let mut stub = stub.lock().unwrap();
    let path = uri.path().to_string();

    if path == format!("/{TENANT}/oauth2/v2.0/token") {
        let form = String::from_utf8_lossy(&body).to_string();
        assert!(
            form.contains("client_assertion=projected-sa-token"),
            "{form}"
        );
        assert!(
            form.contains("scope=https%3A%2F%2Fstorage.azure.com%2F.default"),
            "{form}"
        );
        stub.token_calls += 1;
        let token = format!(
            r#"{{"access_token":"token-{}","expires_in":{}}}"#,
            stub.token_calls, stub.token_lifetime
        );
        return Response::new(Body::from(token));
    }

    if let Some(response) = authenticate(&mut stub, &method, &uri, &headers) {
        return response;
    }
    let Some(rest) = path.strip_prefix(&format!("/{ACCOUNT}/")) else {
        return reply(400, "InvalidUri");
    };
    let (container, name) = match rest.split_once('/') {
        Some((container, name)) => (decode(container), Some(decode(name))),
        None => (decode(rest), None),
    };
    let query: HashMap<String, String> = query_pairs(&uri).into_iter().collect();
    let comp = query.get("comp").cloned().unwrap_or_default();
    stub.log
        .push(format!("{method} {comp}").trim_end().to_string());

    if name.is_none() && query.get("restype").map(String::as_str) == Some("container") {
        if method == HttpMethod::PUT {
            return if stub.containers.insert(container) {
                reply(201, "")
            } else {
                reply(409, "ContainerAlreadyExists")
            };
        }
        if method == HttpMethod::GET && comp == "list" {
            if !stub.containers.contains(&container) {
                return reply(404, "ContainerNotFound");
            }
            return Response::new(Body::from(list_xml(&stub, &container, &query)));
        }
        return reply(400, "Unsupported");
    }
    let Some(name) = name else {
        return reply(400, "Unsupported");
    };
    if !stub.containers.contains(&container) {
        return reply(404, "ContainerNotFound");
    }
    let id = (container.clone(), name.clone());
    match (method.clone(), comp.as_str()) {
        (HttpMethod::PUT, "block") => {
            let block = query.get("blockid").cloned().unwrap_or_default();
            if header(&headers, "content-length") != Some(body.len().to_string()) {
                return reply(400, "MissingContentLengthHeader");
            }
            stub.staged.insert((container, name, block), body);
            reply(201, "")
        }
        (HttpMethod::PUT, "blocklist") => {
            let list = String::from_utf8_lossy(&body).to_string();
            let mut data = Vec::new();
            for part in list.split("<Latest>").skip(1) {
                let block = part.split("</Latest>").next().unwrap_or("").to_string();
                match stub.staged.get(&(container.clone(), name.clone(), block)) {
                    Some(bytes) => data.extend_from_slice(bytes),
                    None => return reply(400, "InvalidBlockList"),
                }
            }
            stub.staged
                .retain(|(c, n, _), _| !(c == &container && n == &name));
            stub.blobs.insert(
                id,
                Stored {
                    data: Bytes::from(data),
                    content_type: header(&headers, "x-ms-blob-content-type"),
                    content_encoding: header(&headers, "x-ms-blob-content-encoding"),
                },
            );
            reply(201, "")
        }
        (HttpMethod::PUT, "") => {
            if header(&headers, "x-ms-blob-type").as_deref() != Some("BlockBlob") {
                return reply(400, "MissingRequiredHeader");
            }
            stub.blobs.insert(
                id,
                Stored {
                    data: body,
                    content_type: header(&headers, "x-ms-blob-content-type"),
                    content_encoding: header(&headers, "x-ms-blob-content-encoding"),
                },
            );
            reply(201, "")
        }
        (HttpMethod::GET, "") => match stub.blobs.get(&id) {
            None => reply(404, "BlobNotFound"),
            Some(stored) => match header(&headers, "x-ms-range") {
                None => blob_response(stored, Some(stored.data.clone()), 200),
                Some(range) => {
                    let range = range.trim_start_matches("bytes=");
                    let (start, end) = range.split_once('-').unwrap();
                    let start: usize = start.parse().unwrap();
                    let end = end
                        .parse::<usize>()
                        .map_or(stored.data.len(), |end| (end + 1).min(stored.data.len()));
                    blob_response(stored, Some(stored.data.slice(start..end)), 206)
                }
            },
        },
        (HttpMethod::HEAD, "") => match stub.blobs.get(&id) {
            None => reply(404, "BlobNotFound"),
            Some(stored) => blob_response(stored, None, 200),
        },
        (HttpMethod::DELETE, "") => {
            if header(&headers, "x-ms-delete-snapshots").as_deref() != Some("include") {
                return reply(400, "MissingRequiredHeader");
            }
            match stub.blobs.remove(&id) {
                Some(_) => reply(202, ""),
                None => reply(404, "BlobNotFound"),
            }
        }
        _ => reply(400, "Unsupported"),
    }
}

/// Serve a stub on a loopback port, answering its endpoint and state.
async fn serve(auth: Auth) -> (String, Shared) {
    let stub = Arc::new(Mutex::new(Stub {
        auth,
        containers: HashSet::new(),
        blobs: BTreeMap::new(),
        staged: HashMap::new(),
        log: Vec::new(),
        page_size: 5000,
        token_calls: 0,
        token_lifetime: 3600,
        refuse_once: HashSet::new(),
        bearers_seen: Vec::new(),
    }));
    let app = axum::Router::new()
        .fallback(handle)
        .with_state(Arc::clone(&stub))
        .layer(axum::extract::DefaultBodyLimit::disable());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}"), stub)
}

fn shared_key_client(origin: &str, container: &str) -> BlobClient {
    BlobClient::new(
        &BlobConfig {
            account: ACCOUNT.to_string(),
            container: container.to_string(),
            endpoint: format!("{origin}/{ACCOUNT}/"),
            auth: BlobAuth::SharedKey(key_bytes()),
        },
        reqwest::Client::new(),
    )
    .unwrap()
}

#[tokio::test]
async fn every_operation_round_trips_under_shared_key() {
    let (origin, stub) = serve(Auth::SharedKey).await;
    let client = shared_key_client(&origin, "runs");

    assert!(client.create_container().await.unwrap());
    assert!(!client.create_container().await.unwrap());

    client
        .put(
            "run-1/g/a/replay.json.gz",
            Bytes::from_static(b"0123456789"),
            "application/json",
            Some("gzip"),
        )
        .await
        .unwrap();
    // A key with a space and a reserved character is encoded and signed alike.
    client
        .put(
            "run-1/g/a/name with space!.txt",
            Bytes::from_static(b"x"),
            "text/plain",
            None,
        )
        .await
        .unwrap();
    // An empty blob is a valid object.
    client
        .put("run-1/current", Bytes::new(), "text/plain", None)
        .await
        .unwrap();

    let read = client
        .get("run-1/g/a/replay.json.gz", None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        read.properties.content_type.as_deref(),
        Some("application/json")
    );
    assert_eq!(read.properties.content_encoding.as_deref(), Some("gzip"));
    assert_eq!(read.properties.content_length, 10);
    assert!(read.properties.last_modified.is_some());
    assert_eq!(collect_body(read.body).await.unwrap(), b"0123456789");

    let ranged = client
        .get(
            "run-1/g/a/replay.json.gz",
            Some(ByteRange {
                start: 2,
                end: Some(4),
            }),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(collect_body(ranged.body).await.unwrap(), b"234");

    let spaced = client
        .get("run-1/g/a/name with space!.txt", None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(collect_body(spaced.body).await.unwrap(), b"x");

    let properties = client
        .properties("run-1/g/a/replay.json.gz")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(properties.content_length, 10);
    assert_eq!(properties.etag.as_deref(), Some("\"0x1\""));

    assert!(client.get("run-1/missing", None).await.unwrap().is_none());
    assert!(client.properties("run-1/missing").await.unwrap().is_none());

    assert!(client.delete("run-1/current").await.unwrap());
    assert!(!client.delete("run-1/current").await.unwrap());
    assert!(client.get("run-1/current", None).await.unwrap().is_none());

    assert!(stub.lock().unwrap().staged.is_empty());
}

#[tokio::test]
async fn listing_follows_every_page_and_rolls_up_directories() {
    let (origin, stub) = serve(Auth::SharedKey).await;
    let client = shared_key_client(&origin, "runs");
    client.create_container().await.unwrap();
    for name in [
        "a/current",
        "a/g/1/x",
        "a/g/1/y",
        "a/g/2/x",
        "b/current",
        "b/g/1/x",
        "c/current",
    ] {
        client
            .put(name, Bytes::from_static(b"."), "text/plain", None)
            .await
            .unwrap();
    }
    stub.lock().unwrap().page_size = 2;

    let all = client.list("", None).await.unwrap();
    let names: Vec<&str> = all.blobs.iter().map(|blob| blob.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "a/current",
            "a/g/1/x",
            "a/g/1/y",
            "a/g/2/x",
            "b/current",
            "b/g/1/x",
            "c/current"
        ]
    );
    assert!(
        all.blobs
            .iter()
            .all(|blob| blob.properties.content_length == 1)
    );
    // Seven blobs in pages of two.
    let lists = stub
        .lock()
        .unwrap()
        .log
        .iter()
        .filter(|entry| *entry == "GET list")
        .count();
    assert_eq!(lists, 4);

    let under_a = client.list("a/", Some("/")).await.unwrap();
    assert_eq!(
        under_a
            .blobs
            .iter()
            .map(|b| b.name.as_str())
            .collect::<Vec<_>>(),
        ["a/current"]
    );
    assert_eq!(under_a.prefixes, ["a/g/"]);

    let first = client.list_page("", None, None, Some(1)).await.unwrap();
    assert_eq!(first.blobs.len(), 1);
    assert_eq!(first.next_marker.as_deref(), Some("a/g/1/x"));
}

#[tokio::test]
async fn a_body_over_one_piece_is_staged_in_blocks() {
    let (origin, stub) = serve(Auth::SharedKey).await;
    let client = shared_key_client(&origin, "runs");
    client.create_container().await.unwrap();

    let data: Vec<u8> = (0..(2 * PIECE_SIZE + 5)).map(|i| (i % 251) as u8).collect();
    // Delivered in uneven chunks, as a request body arrives.
    let chunks: Vec<std::io::Result<Bytes>> = data
        .chunks(1_000_003)
        .map(|chunk| Ok(Bytes::copy_from_slice(chunk)))
        .collect();
    let written = client
        .upload(
            "run-1/big.bin",
            Box::pin(futures_util::stream::iter(chunks)),
            "application/octet-stream",
            None,
        )
        .await
        .unwrap();
    assert_eq!(written, data.len() as u64);

    let log = stub.lock().unwrap().log.clone();
    assert_eq!(
        log,
        [
            "PUT",
            "PUT block",
            "PUT block",
            "PUT block",
            "PUT blocklist"
        ]
    );
    let read = client.get("run-1/big.bin", None).await.unwrap().unwrap();
    assert_eq!(
        read.properties.content_type.as_deref(),
        Some("application/octet-stream")
    );
    assert_eq!(collect_body(read.body).await.unwrap(), data);
}

#[tokio::test]
async fn a_body_of_one_piece_is_one_put_blob() {
    let (origin, stub) = serve(Auth::SharedKey).await;
    let client = shared_key_client(&origin, "runs");
    client.create_container().await.unwrap();
    let written = client
        .upload(
            "run-1/small",
            body_from_bytes(&b"tiny"[..]),
            "text/plain",
            None,
        )
        .await
        .unwrap();
    assert_eq!(written, 4);
    assert_eq!(stub.lock().unwrap().log, ["PUT", "PUT"]);
}

#[tokio::test]
async fn a_wrong_key_is_refused_with_the_store_error() {
    let (origin, _stub) = serve(Auth::SharedKey).await;
    let client = BlobClient::with_credential(
        ACCOUNT,
        &format!("{origin}/{ACCOUNT}"),
        "runs",
        Credential::SharedKey(Arc::new(b"not the key".to_vec())),
        reqwest::Client::new(),
    );
    match client.create_container().await {
        Err(BlobError::Status { status, code, .. }) => {
            assert_eq!(status, 403);
            assert_eq!(code, "AuthenticationFailed");
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test]
async fn another_container_shares_the_account() {
    let (origin, _stub) = serve(Auth::SharedKey).await;
    let runs = shared_key_client(&origin, "runs");
    let public = runs.for_container("public");
    assert_eq!(public.container(), "public");
    assert!(runs.create_container().await.unwrap());
    assert!(public.create_container().await.unwrap());
    public
        .put(
            "index.json",
            Bytes::from_static(b"{}"),
            "application/json",
            None,
        )
        .await
        .unwrap();
    assert!(runs.get("index.json", None).await.unwrap().is_none());
    assert!(public.get("index.json", None).await.unwrap().is_some());
}

/// A workload-identity client of the stub, with a projected token file.
fn identity_client(origin: &str, dir: &std::path::Path) -> (BlobClient, Arc<WorkloadIdentity>) {
    let token_file = dir.join("token");
    std::fs::write(&token_file, "projected-sa-token\n").unwrap();
    let vars: HashMap<&str, String> = HashMap::from([
        ("AZURE_CLIENT_ID", "client-1".to_string()),
        ("AZURE_TENANT_ID", TENANT.to_string()),
        (
            "AZURE_FEDERATED_TOKEN_FILE",
            token_file.display().to_string(),
        ),
        ("AZURE_AUTHORITY_HOST", format!("{origin}/")),
    ]);
    let identity = Arc::new(
        WorkloadIdentity::from_lookup(|key| vars.get(key).cloned(), reqwest::Client::new())
            .unwrap(),
    );
    let client = BlobClient::with_credential(
        ACCOUNT,
        &format!("{origin}/{ACCOUNT}"),
        "runs",
        Credential::WorkloadIdentity(Arc::clone(&identity)),
        reqwest::Client::new(),
    );
    (client, identity)
}

#[tokio::test]
async fn a_token_is_minted_once_and_reused_while_fresh() {
    let (origin, stub) = serve(Auth::Bearer).await;
    let dir = tempfile::tempdir().unwrap();
    let (client, _identity) = identity_client(&origin, dir.path());
    client.create_container().await.unwrap();
    client
        .put("k", Bytes::from_static(b"v"), "text/plain", None)
        .await
        .unwrap();
    assert!(client.get("k", None).await.unwrap().is_some());
    let stub = stub.lock().unwrap();
    assert_eq!(stub.token_calls, 1);
    assert_eq!(stub.bearers_seen, ["token-1", "token-1", "token-1"]);
}

#[tokio::test]
async fn an_expiring_token_is_replaced_before_the_next_request() {
    let (origin, stub) = serve(Auth::Bearer).await;
    // A token with no life left is due for replacement immediately.
    stub.lock().unwrap().token_lifetime = 0;
    let dir = tempfile::tempdir().unwrap();
    let (client, _identity) = identity_client(&origin, dir.path());
    client.create_container().await.unwrap();
    assert!(client.get("k", None).await.unwrap().is_none());
    let stub = stub.lock().unwrap();
    assert_eq!(stub.token_calls, 2);
    assert_eq!(stub.bearers_seen, ["token-1", "token-2"]);
}

#[tokio::test]
async fn a_refused_token_is_not_reused() {
    let (origin, stub) = serve(Auth::Bearer).await;
    stub.lock()
        .unwrap()
        .refuse_once
        .insert("token-1".to_string());
    let dir = tempfile::tempdir().unwrap();
    let (client, _identity) = identity_client(&origin, dir.path());
    match client.create_container().await {
        Err(BlobError::Status { status: 401, .. }) => {}
        other => panic!("expected the refusal, got {other:?}"),
    }
    assert!(client.create_container().await.unwrap());
    let stub = stub.lock().unwrap();
    assert_eq!(stub.bearers_seen, ["token-1", "token-2"]);
}

#[test]
fn workload_identity_needs_its_projected_variables() {
    let vars: HashMap<&str, &str> = HashMap::from([("AZURE_CLIENT_ID", "c")]);
    match WorkloadIdentity::from_lookup(
        |key| vars.get(key).map(|v| (*v).to_string()),
        reqwest::Client::new(),
    ) {
        Err(BlobError::MissingEnv(name)) => assert_eq!(name, "AZURE_TENANT_ID"),
        other => panic!("expected a missing variable, got {other:?}"),
    }
}

#[test]
fn block_ids_share_one_length() {
    assert_eq!(block_id(0).len(), block_id(49_999).len());
    assert_ne!(block_id(1), block_id(2));
}

#[test]
fn a_shared_key_is_never_printed() {
    let config = BlobConfig {
        account: ACCOUNT.to_string(),
        container: "runs".to_string(),
        endpoint: "http://azurite:10000/devstoreaccount1".to_string(),
        auth: BlobAuth::SharedKey(key_bytes()),
    };
    assert!(!format!("{config:?}").contains(&format!("{:?}", key_bytes())));
    assert!(format!("{config:?}").contains("redacted"));
}

#[tokio::test]
async fn a_container_serves_as_the_public_store() {
    use crate::public::PublicStore;

    let (origin, _stub) = serve(Auth::SharedKey).await;
    let store = shared_key_client(&origin, "public");
    store.create_container().await.unwrap();
    let written = PublicStore::put(
        &store,
        "media/runs/r/proof/a.png",
        body_from_bytes(&b"png"[..]),
        "image/png",
        None,
    )
    .await
    .unwrap();
    assert_eq!(written, 3);
    let head = PublicStore::head(&store, "media/runs/r/proof/a.png")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(head.content_type.as_deref(), Some("image/png"));
    let read = PublicStore::get(&store, "media/runs/r/proof/a.png", None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(collect_body(read.body).await.unwrap(), b"png");
    assert_eq!(
        PublicStore::list_keys(&store, "media/runs/r/")
            .await
            .unwrap(),
        ["media/runs/r/proof/a.png"]
    );
    assert!(
        PublicStore::head(&store, "missing")
            .await
            .unwrap()
            .is_none()
    );
}
