/**
 * settings-behavior-coverage.ts — the per-key evidence behind the settings
 * behaviour-coverage numerator used by the verification ledger.
 *
 * ## Why this file exists
 *
 * The ledger's "Settings schema and persistence" area reports how many
 * CONFIG_SCHEMA rows have local BEHAVIOUR verification, as opposed to the
 * merely-structural signal (the key exists, has a type, has a default) that
 * every row trivially satisfies. That numerator used to be a single bare
 * integer maintained by hand. Two things were wrong with that:
 *
 *   1. It decayed silently. The denominator is the live CONFIG_SCHEMA length,
 *      so every config key anyone added anywhere lowered the reported
 *      percentage without any coverage having actually changed.
 *   2. It could not be audited. A reader had no way to ask "which settings?"
 *      and no way to tell a defensible number from a padded one. The only
 *      guard was an upper bound (never claim more than the schema holds),
 *      which does not stop someone from raising the number to whatever makes
 *      the gate go green.
 *
 * This file replaces the bare integer with a list you can check. Every entry
 * names one config key and the test that would fail if that setting stopped
 * being honoured. The numerator is the length of that list plus a documented
 * legacy baseline. To raise the number you have to add a row, and a row is
 * only accepted if the test it names exists and actually exercises that key —
 * see settings-behavior-coverage.test.ts, which enforces exactly that.
 *
 * ## The bar an entry has to clear
 *
 * A key belongs in this list only when a test in THIS repository's suite:
 *   - drives the setting to at least two distinct values,
 *   - exercises the real code path that consumes it, and
 *   - asserts an observable difference in outcome between those values.
 *
 * That is: the test fails if the consuming code starts ignoring the setting.
 *
 * These do NOT qualify, and were the specific failure modes this list was
 * created to keep out:
 *   - asserting the key is present in CONFIG_SCHEMA, or has a description,
 *     a type, or a default,
 *   - asserting a value round-trips through ConfigManager set/get (that
 *     verifies ConfigManager, not the setting),
 *   - asserting an options object carries the value through, with nothing
 *     downstream depending on it (wiring is not behaviour),
 *   - snapshots of a config object.
 *
 * ## The legacy baseline
 *
 * SETTINGS_BEHAVIOR_COVERAGE_BASELINE is the 184 established in commit
 * 0ea661ea (2026-06-10, "honest coverage ledger"), where it was recorded as a
 * defensible judgement call over the then-244-row schema — an earlier attempt
 * to pad it to 244 was rejected at certification. It has no per-key list and
 * this file does not invent one for it; enumerating it retroactively is a
 * separate piece of work. It is carried forward unchanged and every later
 * claim has to be itemised.
 *
 * Entries in this list cannot double-count against that baseline: every key
 * below was introduced after it. The schema files that declare them
 * (schema-domain-device.ts, schema-domain-triggers.ts,
 * schema-domain-voice-wake.ts) and the implementation trees behind them
 * (platform/devices, platform/triggers, platform/voice/wake) did not exist at
 * the baseline commit, so no key here can already be inside the 184.
 */

/** One config key, and the test that proves the setting still does something. */
export interface SettingsBehaviorCoverageEntry {
  /** A CONFIG_SCHEMA key. Validated against the live schema by the guard test. */
  readonly key: string;
  /**
   * Repo-relative path of the test file that behaviour-covers this key. The
   * guard test requires the file to exist and to mention the key by name.
   */
  readonly test: string;
  /** What observable difference the test asserts. One line, plain language. */
  readonly asserts: string;
}

/**
 * The un-itemised inherited count. See "The legacy baseline" above. Do not
 * raise this number — new claims go in SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE,
 * where they can be audited one by one.
 */
export const SETTINGS_BEHAVIOR_COVERAGE_BASELINE = 184;

/**
 * Itemised per-key behaviour coverage added after the baseline. Ordered by
 * config key. Add a row only when its test clears the bar documented above.
 */
export const SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE: readonly SettingsBehaviorCoverageEntry[] = [
  // --- Paired-device capabilities (device.*) -------------------------------
  // Covered by src/test/tools/device-settings-behavior.test.ts, which drives the
  // agent's real consumer (createPhoneDeviceService) with a real ConfigManager over
  // a temp home and the real SDK DeviceCapabilityService / DeviceGrantStore /
  // DeviceCaptureArtifactStore / DeviceHousekeeper. Only the peer transport and the
  // approval bridge are stubbed, so what the assertions observe is refusal codes,
  // how authority was established, what reached the transport, and what survives on
  // disk after a sweep. Each key was mutation-checked by removing its config.set()
  // so the consumer falls back to the schema default: every covered key's tests
  // failed, which is what "would fail if the setting stopped being honoured" means.
  {
    key: 'device.capabilities.mode',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: "off refuses every capability with disabled-by-config and nothing reaches the phone or the person; ask-every-time re-asks even with a live grant while honor-grants uses it",
  },
  {
    key: 'device.capabilities.allowAlwaysOffer',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'every-capability stores a durable grant for an elevated capability; standard-only refuses to store one for it yet still grants a standard-sensitivity capability',
  },
  {
    key: 'device.capabilities.requestTimeoutSeconds',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'the configured seconds are the exact deadline on the dispatch, on the wire payload, and on the confirmation prompt',
  },
  {
    key: 'device.location.precision',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'coarse-only refuses precise location while approximate location still runs; ask-precise keeps it working but stores no durable grant',
  },
  {
    key: 'device.clipboard.readMode',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'off refuses clipboard reads while clipboard writes still work; ask-only keeps reads working but stores no durable grant',
  },
  {
    key: 'device.capture.retentionHours',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'a capture artifact survives inside the configured window and is deleted from disk once the clock passes it',
  },
  {
    key: 'device.capture.maxArtifacts',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'the count cap decides exactly how many capture artifacts survive a sweep, with count-cap given as the removal reason',
  },
  {
    key: 'device.capture.sweepIntervalMinutes',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'the configured minutes are the period handed to the platform timer, and firing that callback past the TTL really reaps (see caveat: period is observed at the timer, not by waiting out wall-clock)',
  },
  {
    key: 'device.grants.expiryDays',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'a stored grant stops being honoured once the configured days pass and the next request falls back to asking',
  },
  {
    key: 'device.grants.maxPerNode',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'the per-node cap decides exactly how many grants survive a sweep, with per-node-cap given as the removal reason',
  },
  {
    key: 'device.grants.auditRetentionDays',
    test: 'src/test/tools/device-settings-behavior.test.ts',
    asserts: 'the audit ledger drops records older than the configured days at the next sweep and keeps the newer ones',
  },
  // --- Watcher triggers (watchers.triggers.*) -----------------------------
  // Covered by src/test/watchers/trigger-settings-behavior.test.ts, which drives the
  // real SDK supervisor (TriggerManager and friends) with injected effects: a scripted
  // probe, a modelled process host, a scripted stream host, a mutable virtual clock,
  // and mkdtemp stores. Mutation-tested by copying the SDK source to a scratch tree and
  // applying 22 mutants that make the consuming code ignore one setting: 21 killed. The
  // 22nd (deleting the enabled-guard from supervisionTick) is behaviourally equivalent
  // to the original because pollProcesses() and tick() each carry their own identical
  // guard, both killed by other tests — defence-in-depth in the SDK, not a test hole.
  {
    key: 'watchers.triggers.enabled',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'false refuses to create a trigger and true creates and fires one; flipping it off mid-run stops the supervisor; every supervisor entry point no-ops while off, not just the outer tick',
  },
  {
    key: 'watchers.triggers.backoffLadderMs',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'the retry delay after a failure follows the configured ladder, and a malformed ladder falls back rather than throwing',
  },
  {
    key: 'watchers.triggers.breakerStrikes',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'the breaker opens after exactly the configured number of consecutive failures, not sooner or later',
  },
  {
    key: 'watchers.triggers.defaultCheckIntervalMs',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'it sets when a condition trigger next becomes due, and a per-trigger override beats it',
  },
  {
    key: 'watchers.triggers.probeTimeoutMs',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'a probe slower than the configured budget fails the check instead of producing an observation',
  },
  {
    key: 'watchers.triggers.maxConcurrentChecks',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'no more than the configured number of condition checks are ever in flight at once',
  },
  {
    key: 'watchers.triggers.observationRingSize',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'it caps the observation ring and thereby bounds what a windowed rule can see',
  },
  {
    key: 'watchers.triggers.runHistoryLimit',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'run history is capped at the configured number of records with the newest kept',
  },
  {
    key: 'watchers.triggers.runHistoryTtlHours',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'run records older than the configured TTL are reaped even when the count cap would have kept them',
  },
  {
    key: 'watchers.triggers.eventLogLimit',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'a fire evicted by the configured cap becomes invisible to a correlation rule',
  },
  {
    key: 'watchers.triggers.eventLogTtlHours',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'a fire older than the configured TTL drops out of the correlation window',
  },
  {
    key: 'watchers.triggers.sweepIntervalMs',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'the housekeeping sweep is scheduled at the configured cadence and the captured callback really sweeps (verified at the scheduling seam, not end to end — see the weaker-evidence note below)',
  },
  {
    key: 'watchers.triggers.supervisionTickMs',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'the supervision tick is scheduled at the configured cadence and the captured callback really supervises (verified at the scheduling seam, not end to end — see the weaker-evidence note below)',
  },
  {
    key: 'watchers.triggers.streamQueueLimit',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'matched lines beyond the configured bound are dropped and counted rather than queued without limit',
  },
  {
    key: 'watchers.triggers.streamBatchLines',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'an agent turn starts once the configured number of matched lines has accumulated',
  },
  {
    key: 'watchers.triggers.streamBatchIntervalMs',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'a partial batch is flushed once it has waited the configured interval',
  },
  {
    key: 'watchers.triggers.onExitMaxDurationMs',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'a child past the configured ceiling fires with an explicit timed-out termination, and a per-trigger override beats it',
  },
  {
    key: 'watchers.triggers.onExitStdin',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'the configured stdin mode changes how a child that reads stdin terminates (child behaviour is modelled by the injected host, the setting-to-termination chain is real)',
  },
  {
    key: 'watchers.triggers.outputTailBytes',
    test: 'src/test/watchers/trigger-settings-behavior.test.ts',
    asserts: 'the termination payload carries exactly the configured amount of trailing output',
  },

  // --- Wake word (voice.wake.*) -------------------------------------------
  // Covered by src/test/voice/wake-settings-behavior.test.ts. Only 8 of the 25
  // voice.wake.* rows are here, and that is the honest number: the other 17 have no
  // consuming code in either repo. The SDK says so itself — the wake-word-detection
  // registry entry carries notOperable, which makes the feature gate refuse the
  // feature and gives settings surfaces a written reason to render "instead of a
  // switch that lies". The detector and the supervisor ARE built and tested, which is
  // exactly the 8 below; audio capture, surface routing, activation sound, indicator,
  // post-wake capture and retention are not built yet. See the tail of the uncovered
  // list in the round report. Mutation-tested against a scratch copy of the SDK: nine
  // mutations to the consuming code, each killed its own key's tests.
  {
    key: 'voice.wake.threshold',
    test: 'src/test/voice/wake-settings-behavior.test.ts',
    asserts: 'the same score fires or does not fire depending only on the configured threshold, both in the detector and end to end through the engine',
  },
  {
    key: 'voice.wake.patienceFrames',
    test: 'src/test/voice/wake-settings-behavior.test.ts',
    asserts: 'the wake fires on exactly the configured number of consecutive above-threshold frames and no sooner; one below-threshold frame restarts the run',
  },
  {
    key: 'voice.wake.cooldownMs',
    test: 'src/test/voice/wake-settings-behavior.test.ts',
    asserts: 'a second wake inside the configured cooldown is suppressed and fires again the moment it lapses; 0 lets consecutive confirmed frames fire',
  },
  {
    key: 'voice.wake.preRollMs',
    test: 'src/test/voice/wake-settings-behavior.test.ts',
    asserts: 'a detection carries exactly the configured milliseconds of audio from before it fired, and 0 carries none',
  },
  {
    key: 'voice.wake.models',
    test: 'src/test/voice/wake-settings-behavior.test.ts',
    asserts: 'every id in the configured list is scored on every frame with its own detector, an empty list scores nothing, and a per-model threshold overrides the global one for that model alone',
  },
  {
    key: 'voice.wake.maxRestarts',
    test: 'src/test/voice/wake-settings-behavior.test.ts',
    asserts: 'the supervisor allows exactly the configured number of restarts and then latches off; clearing the latch restores the configured budget',
  },
  {
    key: 'voice.wake.restartBackoffMs',
    test: 'src/test/voice/wake-settings-behavior.test.ts',
    asserts: 'the restart delay is the configured base multiplied by the attempt number',
  },
  {
    key: 'voice.wake.crashWindowSeconds',
    test: 'src/test/voice/wake-settings-behavior.test.ts',
    asserts: 'crashes older than the configured window stop counting toward the restart budget, so identical timestamps latch under a long window and restart under a short one',
  },

  // --- Chat-surface credentials (surfaces.*.botToken) ----------------------
  // Covered by src/test/config/credential-daemon-scope.test.ts. Each key is
  // driven to two distinct values — a token, then cleared/reset — through the
  // real writing path (the settings modal's secret write, the harness setting
  // path, and the shared secret-backed config write) against a real
  // ConfigManager and a real SecretsManager over a temp home. The observable
  // difference is read back by a SECOND SecretsManager built with a different
  // surface root and a different project root, standing in for the daemon with
  // this program closed: the credential resolves after the write and is gone
  // after the clear. Nothing about the writing surface's own directories is
  // visible to that reader, so the assertion fails the moment the setting stops
  // being honoured in the tier the daemon actually reads.
  {
    key: 'surfaces.slack.botToken',
    test: 'src/test/config/credential-daemon-scope.test.ts',
    asserts: 'a token typed into the settings modal resolves from a store that shares no surface directory with this program; clearing the setting removes it from that store rather than only from this surface',
  },
  {
    key: 'surfaces.discord.botToken',
    test: 'src/test/config/credential-daemon-scope.test.ts',
    asserts: 'the harness set path files the token where a differently-rooted store resolves it, and reset removes it from there rather than reporting a reset while the live credential stays',
  },
  {
    key: 'surfaces.telegram.botToken',
    test: 'src/test/config/credential-daemon-scope.test.ts',
    asserts: 'setting it writes a goodvibes:// reference into config and the value into a store a differently-rooted reader resolves; setting it to empty writes an empty config value and that store returns null',
  },

  // --- Payments (payments.*, daemon.timezone) -----------------------------
  // Covered by src/test/input/settings-modal-payments.test.ts and
  // src/test/renderer/settings-modal-payments.test.ts, driven through the real
  // SettingsModal edit/commit/render path (settings-modal.ts,
  // settings-modal-behavior.ts, payments-money-format.ts), and
  // src/test/input/daemon-settings-actions.test.ts for the timezone picker's
  // own selection-handling code.
  {
    key: 'payments.budget.dailyItemCents',
    test: 'src/test/input/settings-modal-payments.test.ts',
    asserts: 'typing "0.1"/"0.29"/"19.99"/"1234.56" into the edit buffer stores exactly 10/29/1999/123456 cents (not a float-rounding-adjacent value), and re-opening the field shows the same major-units string back; a negative entry is refused rather than coerced',
  },
  {
    key: 'payments.budget.dailyOverageCents',
    test: 'src/test/input/settings-modal-payments.test.ts',
    asserts: 'typing "0.29" against this specific key stores exactly 29 cents through the real money edit/commit path',
  },
  {
    key: 'payments.budget.perPurchaseCeilingCents',
    test: 'src/test/input/settings-modal-payments.test.ts',
    asserts: 'typing "19.99" against this specific key stores exactly 1999 cents through the real money edit/commit path',
  },
  {
    key: 'payments.budget.overageToleranceDailyAllowanceCents',
    test: 'src/test/input/settings-modal-payments.test.ts',
    asserts: 'typing "1234.56" against this specific key stores exactly 123456 cents through the real money edit/commit path',
  },
  {
    key: 'payments.defaultCardId',
    test: 'src/test/renderer/settings-modal-payments.test.ts',
    asserts: 'renders as a plain visible id both empty and set — never routed through the secret-masking path a real credential key goes through, which matters because this key names a card without ever holding its number, expiry or CVV',
  },
  {
    key: 'payments.currency',
    test: 'src/test/input/settings-modal-payments.test.ts',
    asserts: 'changing it to JPY changes the money edit buffer for a Cents field from a two-decimal major-units string to a whole-number one with no decimal point, proving the conversion is genuinely currency-aware rather than hardcoded to USD',
  },
  {
    key: 'payments.cvvHandling',
    test: 'src/test/input/settings-modal-payments.test.ts',
    asserts: "cycling from 'stored' to 'prompt' surfaces the SDK's exact CVV_PROMPT_TRADEOFF_WARNING string as the setting-effect message and in the rendered context panel; cycling back to 'stored' clears it and the description text remains the only place the topic is mentioned",
  },
  {
    key: 'daemon.timezone',
    test: 'src/test/input/daemon-settings-actions.test.ts',
    asserts: "selecting a real IANA zone from the picker writes that exact zone name; selecting the explicit UTC (unset) row writes '' rather than leaving free text entry as an option",
  },

  // --- Payments addresses (payments.{billing,shipping}Address.*) -----------
  // The fourteen address keys entered this repo's settings denominator when the
  // SDK grew them AND this repo grew a consumer for them — the guided
  // `/payments address` flow in commands/payment-card-intake.ts. They are
  // covered by driving that real flow, not the schema: each key is taken to two
  // distinct values in turn and the outcome is asserted per key in both the
  // stored config and the rendered `/payments status` view, so a consumer that
  // started ignoring one field would fail on that field by name.
  {
    key: 'payments.billingAddress.name',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'the guided flow writes this specific field, a second run replaces it with a different name, and the /payments status rendering shows the new value and no longer the old one',
  },
  {
    key: 'payments.billingAddress.line1',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own typed street line and is replaced independently on a second run; the previous value disappears from the status rendering rather than being appended to it',
  },
  {
    key: 'payments.billingAddress.line2',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own second address line, and a whitespace-only answer keeps whatever was there instead of clearing the field',
  },
  {
    key: 'payments.billingAddress.city',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own city value and changes independently of the other six fields when the flow is run a second time',
  },
  {
    key: 'payments.billingAddress.region',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own state/region value and changes independently on a second run through the real guided flow',
  },
  {
    key: 'payments.billingAddress.postalCode',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own postal code and changes independently on a second run; it is entered in the clear and is not routed through the masked card path',
  },
  {
    key: 'payments.billingAddress.country',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own country value and changes independently on a second run through the real guided flow',
  },
  {
    key: 'payments.shippingAddress.name',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'the shipping flow writes this field separately from the billing one, and a second run replaces it with a different name',
  },
  {
    key: 'payments.shippingAddress.line1',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own street line, lands in the daemon-owned config tier a purchase reads from, and is replaced independently on a second run',
  },
  {
    key: 'payments.shippingAddress.line2',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own second line, and a whitespace-only answer keeps the existing value rather than clearing it',
  },
  {
    key: 'payments.shippingAddress.city',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own city value and changes independently of the other shipping fields on a second run',
  },
  {
    key: 'payments.shippingAddress.region',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own state/region value and changes independently on a second run through the real guided flow',
  },
  {
    key: 'payments.shippingAddress.postalCode',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own postal code and changes independently on a second run through the real guided flow',
  },
  {
    key: 'payments.shippingAddress.country',
    test: 'src/test/security/payments-card-containment.test.ts',
    asserts: 'stores its own country value and changes independently on a second run through the real guided flow',
  },

  // NOT COVERED, deliberately: device.nodes.maxPaired. The key is declared in
  // schema-domain-device.ts and associated with the paired-device feature in
  // flag-config-map.ts, but nothing reads it — no pairing path bounds the number of
  // device nodes. Verified by searching both this repo and the SDK source. It is a
  // setting the product offers and does not yet enforce; a test would be asserting a
  // behaviour that does not exist, so it earns no point here.
];

/**
 * The numerator the ledger reports: the inherited baseline plus one for each
 * itemised, test-backed key. Derived, never typed in by hand.
 */
export const SETTINGS_BEHAVIOR_COVERAGE_COUNT =
  SETTINGS_BEHAVIOR_COVERAGE_BASELINE + SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE.length;
