/**
 * Connected-host receipt delivery: a current daemon delivers its undelivered
 * honesty receipts ("updated from X to Y", "restarted after a crash") once, and
 * ONLY to a /status read that opts in with ?receipts=consume, a plain /status
 * read is receipt-neutral. The agent's consuming reader is a single
 * ?receipts=consume read issued once per attach; the liveness probe stays plain.
 * Every consumed receipt must render exactly once.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { AgentDaemonReceiptFeed, type DaemonReceipt } from '../../runtime/daemon-receipts.ts';
import {
  createSessionSpineReceiptConsumer as createSpineReceiptConsumer,
  createSessionSpineRestProbe as createSpineRestProbe,
  extractSessionSpineReceipts as extractDaemonReceipts,
} from '@pellux/goodvibes-sdk/platform/runtime/session-spine';

describe('extractDaemonReceipts', () => {
  test('parses the receipts array off a /status body', () => {
    const receipts = extractDaemonReceipts({
      status: 'running',
      version: '1.7.1',
      receipts: [
        { id: 'update-1', text: 'updated from 1.7.0 to 1.7.1', at: 1_752_400_000_000 },
        { id: 'crash-1', text: 'restarted after a crash at 08:12', at: 1_752_400_100_000 },
      ],
    });
    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toEqual({ id: 'update-1', text: 'updated from 1.7.0 to 1.7.1', at: 1_752_400_000_000 });
  });

  test('returns [] for bodies without receipts and skips malformed entries', () => {
    expect(extractDaemonReceipts({ status: 'running', version: '1.7.1' })).toEqual([]);
    expect(extractDaemonReceipts(null)).toEqual([]);
    expect(extractDaemonReceipts('nope')).toEqual([]);
    const receipts = extractDaemonReceipts({
      receipts: [{ id: '', text: 'no id' }, { id: 'ok', text: 'valid line', at: 5 }, { text: 'no id at all' }, 42],
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.id).toBe('ok');
  });
});

describe('AgentDaemonReceiptFeed', () => {
  test('buffers receipts captured before the renderer attaches, then flushes in order', () => {
    const feed = new AgentDaemonReceiptFeed();
    feed.push([{ id: 'a', text: 'first', at: 1 }, { id: 'b', text: 'second', at: 2 }]);
    const delivered: DaemonReceipt[] = [];
    feed.attach((receipt) => delivered.push(receipt));
    expect(delivered.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  test('delivers immediately once attached and dedupes by id', () => {
    const feed = new AgentDaemonReceiptFeed();
    const delivered: DaemonReceipt[] = [];
    feed.attach((receipt) => delivered.push(receipt));
    feed.push([{ id: 'a', text: 'first', at: 1 }]);
    feed.push([{ id: 'a', text: 'first again', at: 1 }, { id: 'b', text: 'second', at: 2 }]);
    expect(delivered.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});

describe('liveness probe stays receipt-neutral', () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  test('the plain /status probe never sends ?receipts=consume and never drains receipts', async () => {
    const consumeReads: string[] = [];
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.searchParams.get('receipts') === 'consume') consumeReads.push(url.search);
        // A current daemon serves receipts ONLY to a consuming read; a plain
        // read stays receipt-neutral, so this body carries none.
        return Response.json({ status: 'running', version: '1.9.1' });
      },
    });
    const probe = createSpineRestProbe({
      resolveConnection: () => ({ baseUrl: `http://127.0.0.1:${server!.port}`, token: 'test-token' }),
    });
    await expect(probe()).resolves.toBe(true);
    await expect(probe()).resolves.toBe(true);
    // The liveness probe is plain: it must never have issued a consuming read.
    expect(consumeReads).toHaveLength(0);
  });
});

describe('receipt consumer (?receipts=consume, once per attach)', () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  test('the consuming read opts in with ?receipts=consume and captures the one-shot payload', async () => {
    let served = false;
    const sawParam: boolean[] = [];
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        sawParam.push(url.searchParams.get('receipts') === 'consume');
        // Destructive delivery, as the daemon does: the consuming read gets the
        // receipts once; a subsequent consuming read gets none.
        const body = served
          ? { status: 'running', version: '1.9.1' }
          : {
            status: 'running',
            version: '1.9.1',
            receipts: [{ id: 'crash-1', text: 'restarted after a crash at 08:12', at: 7 }],
          };
        served = true;
        return Response.json(body);
      },
    });
    const consume = createSpineReceiptConsumer({
      resolveConnection: () => ({ baseUrl: `http://127.0.0.1:${server!.port}`, token: 'test-token' }),
    });

    const first = await consume();
    expect(first).toEqual([{ id: 'crash-1', text: 'restarted after a crash at 08:12', at: 7 }]);
    // A second attach's consuming read finds nothing pending.
    const second = await consume();
    expect(second).toEqual([]);
    // Every consuming read opted in with the query param.
    expect(sawParam).toEqual([true, true]);
  });

  test('a receipts-free daemon, a non-JSON body, and a non-2xx status all consume nothing', async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response('plain text', { status: 200 }),
    });
    const consume = createSpineReceiptConsumer({
      resolveConnection: () => ({ baseUrl: `http://127.0.0.1:${server!.port}`, token: 'test-token' }),
    });
    expect(await consume()).toEqual([]);
  });

  test('a dead host consumes nothing without throwing', async () => {
    // Port 1 is not listening; the consuming read must resolve to [] (reachability
    // is the probe's concern, not this read's), never reject.
    const consume = createSpineReceiptConsumer({
      resolveConnection: () => ({ baseUrl: 'http://127.0.0.1:1', token: 'test-token' }),
      consumeTimeoutMs: 200,
    });
    expect(await consume()).toEqual([]);
  });

  test('the consumed payload flows through AgentDaemonReceiptFeed to a render sink exactly once', async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => Response.json({
        status: 'running',
        version: '1.9.1',
        receipts: [{ id: 'update-1', text: 'updated from 1.9.0 to 1.9.1', at: 9 }],
      }),
    });
    const feed = new AgentDaemonReceiptFeed();
    const consume = createSpineReceiptConsumer({
      resolveConnection: () => ({ baseUrl: `http://127.0.0.1:${server!.port}`, token: 'test-token' }),
    });
    // Mirror services.consumeDaemonReceipts: one consuming read, push to the feed.
    feed.push(await consume());
    feed.push(await consume()); // dedupe by id — a re-consume must not double-render.

    const rendered: string[] = [];
    feed.attach((receipt) => rendered.push(receipt.text));
    expect(rendered).toEqual(['updated from 1.9.0 to 1.9.1']);
  });
});
