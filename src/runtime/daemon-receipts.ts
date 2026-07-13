/**
 * Connected-host receipt delivery.
 *
 * The daemon keeps honesty receipts ("updated from X to Y", "restarted
 * after a crash at HH:MM", settings-migration notes) and delivers the
 * undelivered ones ONLY to a `/status` read that opts in with
 * `?receipts=consume` — a plain `/status` read is receipt-neutral. Delivery is
 * destructive at the daemon (served exactly once to the consuming reader), so
 * whichever read consumes them must render them or they are lost. The agent's
 * consuming reader is a single `?receipts=consume` read issued once per attach
 * (createSpineReceiptConsumer in session-spine-rest-transport.ts, wired through
 * services.consumeDaemonReceipts); the frequent liveness keepalive probe stays
 * plain and never touches receipts. Every consumed payload is pushed here.
 *
 * This feed buffers receipts captured before the renderer exists (the first
 * consuming read can fire during boot, before the render sink attaches) and
 * delivers each receipt exactly once (dedupe by id) as soon as — and whenever —
 * a delivery sink is attached.
 */

/** One daemon honesty receipt, as served on the /status body. */
export interface DaemonReceipt {
  readonly id: string;
  readonly text: string;
  readonly at: number;
}

/** Parse the receipts array off a /status response body; [] when absent/malformed. */
export function extractDaemonReceipts(body: unknown): DaemonReceipt[] {
  if (typeof body !== 'object' || body === null) return [];
  const receipts = (body as { receipts?: unknown }).receipts;
  if (!Array.isArray(receipts)) return [];
  const parsed: DaemonReceipt[] = [];
  for (const entry of receipts) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, text, at } = entry as { id?: unknown; text?: unknown; at?: unknown };
    if (typeof id !== 'string' || id.length === 0 || typeof text !== 'string' || text.length === 0) continue;
    parsed.push({ id, text, at: typeof at === 'number' ? at : Date.now() });
  }
  return parsed;
}

export class AgentDaemonReceiptFeed {
  private readonly buffered: DaemonReceipt[] = [];
  private readonly seen = new Set<string>();
  private deliver: ((receipt: DaemonReceipt) => void) | null = null;

  /** Ingest receipts from a /status read; buffers until a sink attaches. */
  push(receipts: readonly DaemonReceipt[]): void {
    for (const receipt of receipts) {
      if (this.seen.has(receipt.id)) continue;
      this.seen.add(receipt.id);
      if (this.deliver) {
        this.deliver(receipt);
      } else {
        this.buffered.push(receipt);
      }
    }
  }

  /** Attach the rendering sink; anything captured earlier flushes immediately. */
  attach(deliver: (receipt: DaemonReceipt) => void): void {
    this.deliver = deliver;
    for (const receipt of this.buffered.splice(0)) deliver(receipt);
  }
}
