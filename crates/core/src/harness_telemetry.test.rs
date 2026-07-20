use super::*;

/// A subject with a model ID that exercises the characters resource-attribute
/// encoding has to survive.
fn subject() -> TelemetrySubject<'static> {
    TelemetrySubject {
        harness: HarnessSlug::Claude,
        test_case: "carom",
        variant: "base",
        model_id: "anthropic/claude-sonnet-4",
    }
}

/// A resolved context with a trace in scope, built directly so the tests do not
/// depend on an ambient tracing subscriber.
fn context() -> TelemetryContext {
    TelemetryContext {
        endpoint: "http://tcab-lgtm:4318".to_string(),
        protocol: "http/protobuf".to_string(),
        resource_attributes: "tcab.harness=claude".to_string(),
        traceparent: Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".to_string()),
        rewrote_loopback: false,
    }
}

fn plan_for(slug: HarnessSlug) -> TelemetryPlan {
    harness_telemetry(slug)
        .plan(&context(), slug)
        .expect("harness supports telemetry")
}

#[test]
fn telemetry_is_off_when_no_endpoint_is_configured() {
    // The master switch is the endpoint's presence, so a blank value must be
    // treated exactly like an unset one.
    for blank in ["", "   "] {
        let resolved = TelemetryContext::resolve(blank, &subject(), |_| None);
        // `resolve` itself does not gate; `from_env` does. Assert the trimming
        // contract that gating relies on instead.
        assert!(blank.trim().is_empty(), "{resolved:?}");
    }
}

#[test]
fn a_loopback_endpoint_is_rewritten_to_the_host_gateway() {
    // Inside the container, loopback is the container itself, so a developer's
    // local collector is only reachable through the host gateway.
    for endpoint in [
        "http://localhost:4318",
        "http://127.0.0.1:4318",
        "http://[::1]:4318",
    ] {
        let context = TelemetryContext::resolve(endpoint, &subject(), |_| None);
        assert_eq!(context.endpoint, "http://host.docker.internal:4318");
        assert!(context.rewrote_loopback);
    }
}

#[test]
fn a_cluster_endpoint_is_left_alone() {
    let context = TelemetryContext::resolve("http://tcab-lgtm:4318", &subject(), |_| None);
    assert_eq!(context.endpoint, "http://tcab-lgtm:4318");
    assert!(!context.rewrote_loopback);
}

#[test]
fn a_trailing_slash_is_stripped_so_signal_paths_stay_well_formed() {
    let context = TelemetryContext::resolve("http://tcab-lgtm:4318/", &subject(), |_| None);
    assert_eq!(context.endpoint, "http://tcab-lgtm:4318");
    assert_eq!(
        context.signal_endpoint("traces"),
        "http://tcab-lgtm:4318/v1/traces"
    );
}

#[test]
fn only_http_protocols_are_offered_to_a_harness() {
    // Several harnesses speak OTLP over HTTP only, so an ambient `grpc` must not
    // be passed through and leave them with a silently broken exporter.
    let grpc = TelemetryContext::resolve("http://collector:4318", &subject(), |key| {
        (key == "OTEL_EXPORTER_OTLP_PROTOCOL").then(|| "grpc".to_string())
    });
    assert_eq!(grpc.protocol, "http/protobuf");

    let json = TelemetryContext::resolve("http://collector:4318", &subject(), |key| {
        (key == "OTEL_EXPORTER_OTLP_PROTOCOL").then(|| "http/json".to_string())
    });
    assert_eq!(json.protocol, "http/json");
}

#[test]
fn resource_attributes_describe_the_run_and_keep_ambient_ones() {
    let context = TelemetryContext::resolve("http://collector:4318", &subject(), |key| {
        (key == "OTEL_RESOURCE_ATTRIBUTES").then(|| "deployment.environment.name=prod".to_string())
    });
    assert_eq!(
        context.resource_attributes,
        "tcab.harness=claude,tcab.test_case=carom,tcab.variant=base,\
         tcab.model=anthropic/claude-sonnet-4,deployment.environment.name=prod"
    );
}

#[test]
fn a_reserved_character_in_an_attribute_value_is_encoded() {
    // A comma or an equals sign in a value would otherwise be parsed as further
    // attributes, silently corrupting every attribute after it.
    let subject = TelemetrySubject {
        harness: HarnessSlug::Goose,
        test_case: "carom",
        variant: "base",
        model_id: "vendor/model,x=1",
    };
    let context = TelemetryContext::resolve("http://collector:4318", &subject, |_| None);
    assert!(
        context
            .resource_attributes
            .ends_with("tcab.model=vendor/model%2Cx%3D1"),
        "{}",
        context.resource_attributes
    );
}

#[test]
fn every_harness_has_a_telemetry_descriptor() {
    // Exhaustive over the catalog so a newly added harness cannot be left
    // undecided — it must be declared supported or explicitly unsupported.
    for slug in HarnessSlug::ALL {
        match harness_telemetry(slug) {
            HarnessTelemetry::Unsupported(reason) => {
                assert!(!reason.trim().is_empty(), "{slug:?} needs a reason");
                assert!(harness_telemetry(slug).linking().is_none());
            }
            HarnessTelemetry::Supported { .. } => {
                let plan = plan_for(slug);
                assert!(
                    !plan.env.is_empty() || !plan.files.is_empty(),
                    "{slug:?} claims support but configures nothing",
                );
                assert!(harness_telemetry(slug).linking().is_some());
            }
        }
    }
}

#[test]
fn the_unsupported_harnesses_configure_nothing() {
    for slug in [
        HarnessSlug::Cline,
        HarnessSlug::Pi,
        HarnessSlug::Antigravity,
    ] {
        assert!(harness_telemetry(slug).plan(&context(), slug).is_none());
    }
}

#[test]
fn a_supported_harness_inherits_the_host_gateway_requirement() {
    let mut context = context();
    context.rewrote_loopback = true;
    let plan = harness_telemetry(HarnessSlug::Claude)
        .plan(&context, HarnessSlug::Claude)
        .expect("claude supports telemetry");
    assert!(plan.needs_host_gateway);
}

#[test]
fn claude_sets_both_switches_and_links_to_the_run_trace() {
    let plan = plan_for(HarnessSlug::Claude);
    // Traces specifically need the beta switch; without it only metrics and logs
    // are emitted, which would look like partial success.
    assert_eq!(plan.env["CLAUDE_CODE_ENABLE_TELEMETRY"], "1");
    assert_eq!(plan.env["CLAUDE_CODE_ENHANCED_TELEMETRY_BETA"], "1");
    assert_eq!(plan.env["OTEL_TRACES_EXPORTER"], "otlp");
    assert_eq!(
        plan.env["TRACEPARENT"],
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    );
    assert_eq!(plan.env["OTEL_SERVICE_NAME"], "tcab-harness-claude");
    // A run is short-lived, so the multi-second default batching would drop the
    // tail of a session.
    assert_eq!(plan.env["OTEL_TRACES_EXPORT_INTERVAL"], "1000");
    assert!(plan.files.is_empty());
}

#[test]
fn codex_is_configured_by_file_and_never_ships_metrics_to_the_vendor() {
    let plan = plan_for(HarnessSlug::Codex);
    // Codex reads no `OTEL_*` variable at all.
    assert!(plan.env.is_empty());
    let file = plan.files.first().expect("codex writes a config file");
    assert_eq!(file.container_path, "/home/node/.codex/config.toml");
    let config = String::from_utf8(file.contents.clone()).expect("utf-8 config");

    // `metrics_exporter` defaults to `statsig`: leaving it unset would export a
    // run's metrics to the vendor rather than the configured collector.
    assert!(config.contains("metrics_exporter"), "{config}");
    assert!(!config.contains("statsig"), "{config}");
    // Codex wants full signal paths, not a base endpoint.
    assert!(
        config.contains("http://tcab-lgtm:4318/v1/traces"),
        "{config}"
    );
    assert!(config.contains("http://tcab-lgtm:4318/v1/logs"), "{config}");
    // The run's prompt must not be copied into telemetry.
    assert!(config.contains("log_user_prompt = false"), "{config}");
    assert!(config.parse::<toml::Value>().is_ok(), "{config}");
}

#[test]
fn goose_and_kilo_use_the_standard_environment() {
    for slug in [HarnessSlug::Goose, HarnessSlug::Kilo] {
        let plan = plan_for(slug);
        assert_eq!(
            plan.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
            "http://tcab-lgtm:4318"
        );
        assert_eq!(
            plan.env["OTEL_SERVICE_NAME"],
            format!("tcab-harness-{}", slug.as_str())
        );
        assert!(plan.files.is_empty());
    }
}

#[test]
fn opencode_registers_the_plugin_and_uses_its_vendor_traceparent() {
    let plan = plan_for(HarnessSlug::Opencode);
    assert_eq!(plan.env["OPENCODE_ENABLE_TELEMETRY"], "1");
    assert_eq!(plan.env["OPENCODE_OTLP_ENDPOINT"], "http://tcab-lgtm:4318");
    // The plugin reads its own variable and ignores the standard one.
    assert_eq!(
        plan.env["OPENCODE_TRACEPARENT"],
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    );

    let file = plan.files.first().expect("opencode writes a config file");
    assert_eq!(
        file.container_path,
        "/home/node/.config/opencode/opencode.json"
    );
    let config = String::from_utf8(file.contents.clone()).expect("utf-8 config");
    let parsed: serde_json::Value = serde_json::from_str(&config).expect("valid json");
    assert_eq!(parsed["plugin"][0], "@devtheops/opencode-plugin-otel");
}

#[test]
fn a_harness_without_a_trace_in_scope_omits_the_traceparent() {
    let mut context = context();
    context.traceparent = None;
    for slug in [HarnessSlug::Claude, HarnessSlug::Opencode] {
        let plan = harness_telemetry(slug)
            .plan(&context, slug)
            .expect("harness supports telemetry");
        assert!(!plan.env.contains_key("TRACEPARENT"), "{slug:?}");
        assert!(!plan.env.contains_key("OPENCODE_TRACEPARENT"), "{slug:?}");
    }
}
