/**
 * Connected-host receipt delivery: the daemon serves undelivered honesty
 * receipts ("updated from X to Y", "restarted after a crash") once, to the
 * first authenticated /status reader — the agent's spine probe is that
 * reader, and every captured receipt must render exactly once.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { AgentDaemonReceiptFeed, extractDaemonReceipts, type DaemonReceipt } from '../../runtime/daemon-receipts.ts';
import { createSpineRestProbe } from '../../runtime/session-spine-rest-transport.ts';

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

describe('spine probe receipt capture', () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  test('the default /status probe hands receipts to onReceipts and still reports reachable', async () => {
    let served = false;
    server = Bun.serve({
      port: 0,
      fetch() {
        // Destructive delivery, as the daemon does: receipts appear once.
        const body = served
          ? { status: 'running', version: '1.7.1' }
          : { status: 'running', version: '1.7.1', receipts: [{ id: 'update-1', text: 'updated from 1.7.0 to 1.7.1', at: 7 }] };
        served = true;
        return Response.json(body);
      },
    });
    const captured: DaemonReceipt[][] = [];
    const probe = createSpineRestProbe({
      resolveConnection: () => ({ baseUrl: `http://127.0.0.1:${server!.port}`, token: 'test-token' }),
      onReceipts: (receipts) => captured.push([...receipts]),
    });

    await expect(probe()).resolves.toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual([{ id: 'update-1', text: 'updated from 1.7.0 to 1.7.1', at: 7 }]);

    // A later probe with no receipts pending captures nothing and stays reachable.
    await expect(probe()).resolves.toBe(true);
    expect(captured).toHaveLength(1);
  });

  test('a receipts-free daemon and a non-JSON body probe reachable without receipts', async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        return new Response('plain text', { status: 200 });
      },
    });
    const captured: DaemonReceipt[][] = [];
    const probe = createSpineRestProbe({
      resolveConnection: () => ({ baseUrl: `http://127.0.0.1:${server!.port}`, token: 'test-token' }),
      onReceipts: (receipts) => captured.push([...receipts]),
    });
    await expect(probe()).resolves.toBe(true);
    expect(captured).toHaveLength(0);
  });
});
