use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use axum::routing::get;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};

use super::*;

/// A deadline long enough that no test reaches it unless it means to.
const NEVER: Duration = Duration::from_secs(600);
/// How long a test waits for something that should take milliseconds.
const GENEROUS: Duration = Duration::from_secs(30);

/// Send `GET /slow` on a new connection and read the response to its end.
async fn get_slow(addr: std::net::SocketAddr) -> std::io::Result<String> {
    let mut stream = tokio::net::TcpStream::connect(addr).await?;
    stream
        .write_all(b"GET /slow HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n")
        .await?;
    let mut response = String::new();
    stream.read_to_string(&mut response).await?;
    Ok(response)
}

/// Wait until `ready` drains: the stop was taken.
async fn until_draining(ready: &Readiness) {
    tokio::time::timeout(GENEROUS, ready.drained())
        .await
        .expect("the stop was not taken");
}

#[test]
fn a_request_in_flight_past_the_deadline_does_not_hold_the_stop() {
    // The request holds a blocking thread, as an ingest's scan does, that is released
    // only after the runtime has been shut down: neither the server's drain nor the
    // runtime's shutdown may wait for it.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    // Declared after the runtime so a failing test drops the sender first, which
    // releases the blocking thread before the runtime's drop waits on it.
    let (release, released) = std::sync::mpsc::channel::<()>();
    let released = Arc::new(std::sync::Mutex::new(released));
    let stopped = runtime.block_on(async move {
        let (started_tx, mut started) = mpsc::channel::<()>(1);
        let router = axum::Router::new().route(
            "/slow",
            get(move || {
                let started_tx = started_tx.clone();
                let released = Arc::clone(&released);
                async move {
                    started_tx.send(()).await.unwrap();
                    tokio::task::spawn_blocking(move || {
                        let _ = released.lock().unwrap().recv();
                    })
                    .await
                    .unwrap();
                    "finished"
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let ready = Readiness::new(true);
        let (stop_tx, stop_rx) = oneshot::channel();
        let server = tokio::spawn(serve(
            listener,
            router,
            ready,
            async move { stop_rx.await.unwrap() },
            async {},
            Timing {
                drain_delay: Duration::ZERO,
                stop_deadline: Duration::from_millis(200),
            },
        ));
        tokio::spawn(get_slow(addr));
        tokio::time::timeout(GENEROUS, started.recv())
            .await
            .expect("the request never reached its handler");

        stop_tx.send(Stop::Interrupt).unwrap();
        tokio::time::timeout(GENEROUS, server)
            .await
            .expect("the stop waited on the request in flight")
            .unwrap()
            .unwrap()
    });
    assert_eq!(stopped, Stopped::DeadlinePassed);
    // What the binary does next: this returns with the blocking thread still held.
    runtime.shutdown_background();
    release.send(()).unwrap();
}

#[tokio::test]
async fn a_request_in_flight_finishes_before_the_stop() {
    let (started_tx, mut started) = mpsc::channel::<()>(1);
    let (release_tx, release_rx) = oneshot::channel::<()>();
    let release_rx = Arc::new(tokio::sync::Mutex::new(Some(release_rx)));
    let router = axum::Router::new().route(
        "/slow",
        get(move || {
            let started_tx = started_tx.clone();
            let release_rx = Arc::clone(&release_rx);
            async move {
                started_tx.send(()).await.unwrap();
                let release = release_rx.lock().await.take().unwrap();
                release.await.unwrap();
                "finished"
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let ready = Readiness::new(true);
    let finished = Arc::new(AtomicBool::new(false));
    let (stop_tx, stop_rx) = oneshot::channel();
    let server = tokio::spawn(serve(
        listener,
        router,
        ready.clone(),
        async move { stop_rx.await.unwrap() },
        {
            let finished = Arc::clone(&finished);
            async move { finished.store(true, Ordering::Release) }
        },
        Timing {
            drain_delay: Duration::ZERO,
            stop_deadline: NEVER,
        },
    ));
    let client = tokio::spawn(get_slow(addr));
    tokio::time::timeout(GENEROUS, started.recv())
        .await
        .expect("the request never reached its handler");

    stop_tx.send(Stop::Interrupt).unwrap();
    until_draining(&ready).await;
    assert!(!ready.is_ready());
    release_tx.send(()).unwrap();

    let response = tokio::time::timeout(GENEROUS, client)
        .await
        .expect("no response")
        .unwrap()
        .unwrap();
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.ends_with("finished"), "{response}");
    let stopped = tokio::time::timeout(GENEROUS, server)
        .await
        .expect("the server did not stop")
        .unwrap()
        .unwrap();
    assert_eq!(stopped, Stopped::Drained);
    assert!(finished.load(Ordering::Acquire), "finish did not run");
}
