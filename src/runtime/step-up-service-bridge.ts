/**
 * Bridge to the SDK's relay step-up ceremony service.
 *
 * The repacked goodvibes-sdk makes `stepUpService: StepUpService` a required
 * member of `RuntimeServices`, and the daemon facade dereferences it
 * unconditionally at start (`buildDaemonRelayReachability(..., runtimeServices
 * .stepUpService.createVerifier())` in platform/daemon/facade.ts). The agent
 * composes its runtime services by hand instead of calling the SDK's own
 * `createRuntimeServices`, so it must construct this service itself — exactly as
 * the SDK composition root does (`new StepUpService({ secrets: secretsManager })`).
 *
 * The SDK does not (yet) re-export `StepUpService` through any of its public
 * `exports` subpaths — it is only reachable at `platform/relay/step-up-service`,
 * which the package's `exports` map does not list. This single, isolated module
 * is the ONE place that reaches the built file directly, so the deep-import
 * exception is contained and easy to remove once the SDK publishes a public
 * export (or a factory) for it. Everything else stays on public SDK entry points.
 */

// eslint-disable-next-line no-restricted-imports -- see file header: SDK gap, isolated here.
import { StepUpService } from '../../node_modules/@pellux/goodvibes-sdk/dist/platform/relay/step-up-service.js';

/** Minimal secret-custody surface the ceremony needs; the SecretsManager satisfies it. */
export interface StepUpSecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Construct the real relay step-up ceremony service over the given secret store.
 * Returns the concrete SDK `StepUpService` so it slots straight into the
 * `RuntimeServices.stepUpService` contract with no cast or stub.
 */
export function createStepUpService(secrets: StepUpSecretStore): StepUpService {
  return new StepUpService({ secrets });
}
