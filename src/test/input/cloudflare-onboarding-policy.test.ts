import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  handleCloudflareOnboardingActionForHandler,
  maybeProvisionCloudflareOnFinalApplyForHandler,
} from '../../input/handler-onboarding-cloudflare.ts';
import type { InputHandler } from '../../input/handler.ts';

type FakeCloudflareAction = Parameters<typeof handleCloudflareOnboardingActionForHandler>[1];

interface FakeWizard {
  readonly textState: Map<string, string>;
  readonly steps: readonly { readonly id: string }[];
  readonly runtimeSnapshot: {
    readonly config: {
      readonly cloudflare: {
        readonly enabled: boolean;
        readonly apiTokenRef: string;
        readonly accountId: string;
        readonly workerName: string;
      };
      readonly batch: {
        readonly mode: string;
      };
    };
  };
  clearApplyFeedback(): void;
  setApplyFeedback(feedback: unknown): void;
  setStep(index: number): void;
  getStringFieldValue(id: string, fallback: string): string;
  getBooleanFieldValue(id: string, fallback: boolean): boolean;
  isCapabilitySelected(id: string): boolean;
}

function makeHandler(): {
  readonly handler: InputHandler;
  readonly printed: string[];
  readonly render: ReturnType<typeof mock>;
} {
  const printed: string[] = [];
  const render = mock(() => {});
  const wizard: FakeWizard = {
    textState: new Map<string, string>(),
    steps: [{ id: 'intro' }, { id: 'cloudflare' }],
    runtimeSnapshot: {
      config: {
        cloudflare: {
          enabled: true,
          apiTokenRef: '',
          accountId: 'acc-1',
          workerName: 'goodvibes-batch-worker',
        },
        batch: {
          mode: 'explicit',
        },
      },
    },
    clearApplyFeedback: mock(() => {}),
    setApplyFeedback: mock((_feedback: unknown) => {}),
    setStep: mock((_index: number) => {}),
    getStringFieldValue: (id: string, fallback: string) => {
      if (id === 'cloudflare.provision-on-apply') return 'yes';
      return fallback;
    },
    getBooleanFieldValue: (id: string, fallback: boolean) => {
      if (id === 'cloudflare.enabled') return true;
      return fallback;
    },
    isCapabilitySelected: (id: string) => id === 'cloudflare-batch',
  };
  const handler = {
    onboardingApplyPending: false,
    onboardingWizard: wizard,
    requestRender: render,
    commandContext: {
      print: (message: string) => {
        printed.push(message);
      },
    },
  } as unknown as InputHandler;
  return { handler, printed, render };
}

describe('Cloudflare onboarding Agent policy', () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock(async () => Response.json({ ok: true }));

  beforeEach(() => {
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test.each([
    ['cloudflare-create-operational-token', '/cloudflare create-token'],
    ['cloudflare-provision', '/cloudflare provision'],
    ['cloudflare-disable', '/cloudflare disable'],
  ] as const)('blocks wizard mutation action %s and gives explicit command guidance', async (action, command) => {
    const { handler, printed, render } = makeHandler();

    await handleCloudflareOnboardingActionForHandler(handler, action as FakeCloudflareAction);

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(render).toHaveBeenCalled();
    expect(printed.join('\n')).toContain('Cloudflare mutation requires explicit command');
    expect(printed.join('\n')).toContain(`${command}`);
    expect(printed.join('\n')).toContain('--yes');
  });

  test('blocks final-apply Cloudflare provisioning and does not call daemon routes', async () => {
    const { handler } = makeHandler();

    const items = await maybeProvisionCloudflareOnFinalApplyForHandler(handler);

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(items[0]?.status).toBe('warn');
    expect(items[0]?.message).toContain('provisioning was blocked');
    expect(items[0]?.message).toContain('/cloudflare provision [flags] --yes');
  });
});
