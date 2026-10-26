//! A stub artifact service on a loopback socket, holding in memory what the backend
//! stores through it and answering the routes [`ArtifactsClient`](super::ArtifactsClient)
//! calls. Every request must present [`TOKEN`] as a bearer, and every request is
//! recorded, so a test can assert on the traffic as well as the result.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::get;

/// The service token the stub requires.
pub(crate) const TOKEN: &str = "artifacts-service-token";

/// What the stub holds and has seen.
#[derive(Default)]
pub(crate) struct Held {
    /// Each stored match replay, by `(tournament id, match id)`.
    pub replays: Mutex<HashMap<(String, String), Vec<u8>>>,
    /// Each run's code-analysis document, served gzip-labelled when it is gzip.
    pub code_analyses: Mutex<HashMap<String, Vec<u8>>>,
    /// Every request, as `METHOD /path`, in arrival order.
    pub requests: Mutex<Vec<String>>,
    /// When set, every authorized request is answered with this status instead.
    pub failing: Mutex<Option<StatusCode>>,
}

impl Held {
    /// The requests seen so far.
    pub fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }

    /// The replay stored for a match, if any.
    pub fn replay(&self, tournament_id: &str, match_id: &str) -> Option<Vec<u8>> {
        self.replays
            .lock()
            .unwrap()
            .get(&(tournament_id.to_string(), match_id.to_string()))
            .cloned()
    }
}

/// A running stub: its base URL and what it holds.
pub(crate) struct Stub {
    /// The base URL to configure as `TCAB_ARTIFACTS_URL`.
    pub url: String,
    /// What the stub holds and has seen.
    pub held: Arc<Held>,
}

/// Spawn a stub artifact service holding nothing.
pub(crate) async fn spawn() -> Stub {
    let held = Arc::new(Held::default());
    let app = Router::new()
        .route(
            "/tournaments/{id}/matches/{match_id}/replay",
            get(get_replay).put(put_replay),
        )
        .route("/runs/{id}/code-analysis", get(code_analysis))
        .layer(axum::middleware::from_fn_with_state(
            Arc::clone(&held),
            gate,
        ))
        .with_state(Arc::clone(&held));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind the stub artifact service");
    let addr = listener.local_addr().expect("stub address");
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    Stub {
        url: format!("http://{addr}"),
        held,
    }
}

/// Record the request, refuse one without the token, and answer the failing status
/// when one is set.
async fn gate(State(held): State<Arc<Held>>, request: Request, next: Next) -> Response {
    held.requests
        .lock()
        .unwrap()
        .push(format!("{} {}", request.method(), request.uri().path()));
    let authorized = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(&format!("Bearer {TOKEN}"));
    if !authorized {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if let Some(status) = *held.failing.lock().unwrap() {
        return status.into_response();
    }
    next.run(request).await
}

async fn put_replay(
    State(held): State<Arc<Held>>,
    Path((id, match_id)): Path<(String, String)>,
    body: Bytes,
) -> StatusCode {
    held.replays
        .lock()
        .unwrap()
        .insert((id, match_id), body.to_vec());
    StatusCode::NO_CONTENT
}

async fn get_replay(
    State(held): State<Arc<Held>>,
    Path((id, match_id)): Path<(String, String)>,
) -> Response {
    match held.replay(&id, &match_id) {
        Some(bytes) => ([(header::CONTENT_TYPE, "application/json")], bytes).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn code_analysis(State(held): State<Arc<Held>>, Path(id): Path<String>) -> Response {
    let Some(bytes) = held.code_analyses.lock().unwrap().get(&id).cloned() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    if bytes.starts_with(&[0x1f, 0x8b]) {
        headers.insert(header::CONTENT_ENCODING, "gzip".parse().unwrap());
    }
    (headers, bytes).into_response()
}
