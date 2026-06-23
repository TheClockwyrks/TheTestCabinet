/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default backend URL the console points at on first load (optional). */
  readonly VITE_BACKEND_URL?: string;
  /**
   * Standalone auth service URL the console registers/logs in against (optional).
   * The backend no longer proxies auth, so the console reaches the auth service
   * directly. Defaults to the backend URL when unset (a single-box dev setup where
   * the backend also fronts auth).
   */
  readonly VITE_AUTH_URL?: string;
  /**
   * OTLP/HTTP endpoint browser telemetry exports to (optional; opt-in). Unset
   * disables browser telemetry. From the host this is the local Grafana LGTM
   * stack at http://localhost:4318.
   */
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  /** OTel `service.name` reported for browser telemetry (default: tcab-web). */
  readonly VITE_OTEL_SERVICE_NAME?: string;
  /** `deployment.environment.name` resource attribute (default: local). */
  readonly VITE_TCAB_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
