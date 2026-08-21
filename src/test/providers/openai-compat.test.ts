import { describe, expect, mock, spyOn, test } from 'bun:test';
import { OpenAICompatProvider } from '@pellux/goodvibes-sdk/platform/providers';
import { ProviderError } from '@pellux/goodvibes-sdk/platform/types';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';

function makeProvider(): OpenAICompatProvider {
  return new OpenAICompatProvider({
    name: 'inceptionlabs',
    baseURL: 'https://api.inceptionlabs.ai/v1',
    apiKey: 'test-key',
    defaultModel: 'mercury-2',
    models: ['mercury-2'],
    reasoningFormat: 'mercury',
  });
}

// The provider calls `(await this.client()).chat.completions.create(...).withResponse()`
// (added so success-path rate-limit headers are readable, not only on 429s), the real
// openai SDK's `create()` returns an APIPromise with a `.withResponse()` method that
// resolves to `{ data, response }`. A bare async function standing in for `create` returns
// a plain Promise with no `.withResponse()`, so calling it throws a TypeError before the
// intended stub error/stream is ever reached. Wrap the stub so `.withResponse()` proxies
// to it.
//
// `client` is a lazily-memoizing METHOD on the class (`client(): OpenAI { this.openaiClient
// ??= ...; return this.openaiClient; }`), not a plain object built in the constructor,
// shadowing it with a data property here must therefore assign a FUNCTION, or `this.client()`
// at the real call site throws "this.client is not a function" before the stub is ever
// reached.
function setChatCreate(provider: OpenAICompatProvider, create: (...args: unknown[]) => Promise<unknown>): void {
  (provider as unknown as {
    client: () => {
      chat: {
        completions: {
          create: (...args: unknown[]) => { withResponse: () => Promise<{ data: unknown; response: Response }> };
        };
      };
    };
  }).client = () => ({
    chat: {
      completions: {
        create: (...args: unknown[]) => ({
          withResponse: async () => {
            const data = await create(...args);
            return { data, response: new Response(null, { headers: new Headers() }) };
          },
        }),
      },
    },
  });
}

describe('OpenAICompatProvider diagnostics', () => {
  test('preserves upstream request details for request-phase failures', async () => {
    const provider = makeProvider();
    const errorSpy = spyOn(logger, 'error');
    setChatCreate(provider, mock(async () => {
      throw {
        status: 401,
        requestID: 'req-review-1',
        code: 'invalid_api_key',
        type: 'authentication_error',
        error: {
          message: 'token rejected by upstream',
          code: 'invalid_api_key',
          type: 'authentication_error',
        },
        message: '401 Unauthorized',
      };
    }));

    try {
      let thrown: unknown;
      try {
        await provider.chat({
          model: 'mercury-2',
          messages: [{ role: 'user', content: 'review the WRFC result' }],
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ProviderError);
      expect((thrown as ProviderError).message).toContain('inceptionlabs chat request failed 401');
      expect((thrown as ProviderError).message).toContain('token rejected by upstream');
      expect((thrown as ProviderError).message).toContain('request_id=req-review-1');
      expect(errorSpy.mock.calls[0]?.[1]).toMatchObject({
        phase: 'request',
        requestAccepted: false,
        status: 401,
        requestId: 'req-review-1',
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('marks stream failures as post-request errors', async () => {
    const provider = makeProvider();
    const errorSpy = spyOn(logger, 'error');
    setChatCreate(provider, mock(async () => ({
      async *[Symbol.asyncIterator]() {
        throw {
          status: 401,
          requestID: 'req-stream-1',
          error: { message: 'stream authorization expired' },
          message: 'stream closed',
        };
      },
    })));

    try {
      let thrown: unknown;
      try {
        await provider.chat({
          model: 'mercury-2',
          messages: [{ role: 'user', content: 'run the reviewer' }],
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ProviderError);
      expect((thrown as ProviderError).message).toContain('inceptionlabs chat stream failed 401');
      expect((thrown as ProviderError).message).toContain('request_id=req-stream-1');
      expect(errorSpy.mock.calls[0]?.[1]).toMatchObject({
        phase: 'stream',
        requestAccepted: true,
        status: 401,
        requestId: 'req-stream-1',
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
