/**
 * IMAP client protocol tests using an in-process fake server.
 * No real network connections are made. TLS is bypassed by injecting
 * a plain net.Socket pair via net.createServer.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { ImapClient, formatImapDate } from '../../agent/email/imap-client.ts';

// ---------------------------------------------------------------------------
// Fake server helpers
// ---------------------------------------------------------------------------

interface FakeServer {
  readonly address: { port: number };
  readonly server: Server;
  close(): void;
}

function makeFakeImapServer(
  script: (socket: Socket) => void,
): Promise<FakeServer> {
  return new Promise<FakeServer>((resolve) => {
    const server = createServer((socket) => {
      script(socket);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        address: { port: (addr as { port: number }).port },
        server,
        close: () => server.close(),
      });
    });
  });
}

function serverWrite(socket: Socket, line: string): void {
  socket.write(`${line}\r\n`);
}

async function connectSocket(port: number): Promise<Socket> {
  return new Promise<Socket>((resolve) => {
    const sock = connect({ host: '127.0.0.1', port }, () => resolve(sock));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImapClient protocol', () => {
  let fakeServer: FakeServer | null = null;

  afterEach(() => {
    fakeServer?.close();
    fakeServer = null;
  });

  test('LOGIN success — open() sends greeting, auth, and EXAMINE', async () => {
    const events: string[] = [];

    fakeServer = await makeFakeImapServer((sock) => {
      serverWrite(sock, '* OK IMAP4rev1 Fake Server ready');
      sock.on('data', (chunk) => {
        const lines = chunk.toString().split(/\r\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          events.push(line.trim());
          if (line.includes('LOGIN')) {
            const tag = line.split(' ')[0] ?? 'A0001';
            serverWrite(sock, `${tag} OK LOGIN completed`);
          } else if (line.includes('EXAMINE')) {
            const tag = line.split(' ')[0] ?? 'A0002';
            serverWrite(sock, '* 10 EXISTS');
            serverWrite(sock, '* 0 RECENT');
            serverWrite(sock, `${tag} OK [READ-ONLY] EXAMINE completed`);
          }
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new ImapClient({
      socket,
      username: 'user@example.test',
      password: 'supersecret',
      timeoutMs: 3000,
    });

    await client.open();

    expect(events.some((e) => e.includes('LOGIN user@example.test supersecret'))).toBe(true);
    expect(events.some((e) => e.includes('EXAMINE INBOX'))).toBe(true);
  });

  test('LOGIN failure — throws on NO response', async () => {
    fakeServer = await makeFakeImapServer((sock) => {
      serverWrite(sock, '* OK IMAP4rev1 Fake Server ready');
      sock.on('data', (chunk) => {
        const line = chunk.toString().trim();
        if (line.includes('LOGIN')) {
          const tag = line.split(' ')[0] ?? 'A0001';
          serverWrite(sock, `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new ImapClient({
      socket,
      username: 'user@example.test',
      password: 'wrongpassword',
      timeoutMs: 3000,
    });

    await expect(client.open()).rejects.toThrow('IMAP command failed');
  });

  test('SEARCH UNSEEN — parses sequence numbers from * SEARCH response', async () => {
    fakeServer = await makeFakeImapServer((sock) => {
      serverWrite(sock, '* OK IMAP4rev1 Fake Server ready');
      sock.on('data', (chunk) => {
        const lines = chunk.toString().split(/\r\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          const tag = line.split(' ')[0] ?? 'A0001';
          if (line.includes('LOGIN')) serverWrite(sock, `${tag} OK LOGIN completed`);
          else if (line.includes('EXAMINE')) serverWrite(sock, `${tag} OK [READ-ONLY] EXAMINE completed`);
          else if (line.includes('SEARCH')) {
            serverWrite(sock, '* SEARCH 3 7 12 15');
            serverWrite(sock, `${tag} OK SEARCH completed`);
          }
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new ImapClient({
      socket,
      username: 'user@example.test',
      password: 'secret',
      timeoutMs: 3000,
    });
    await client.open();
    const nums = await client.searchUnseen();
    expect(nums).toEqual([3, 7, 12, 15]);
  });

  test('SEARCH SINCE — command includes date criterion', async () => {
    const commandsSeen: string[] = [];

    fakeServer = await makeFakeImapServer((sock) => {
      serverWrite(sock, '* OK IMAP4rev1 Fake Server ready');
      sock.on('data', (chunk) => {
        const lines = chunk.toString().split(/\r\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          commandsSeen.push(line.trim());
          const tag = line.split(' ')[0] ?? 'A0001';
          if (line.includes('LOGIN')) serverWrite(sock, `${tag} OK LOGIN completed`);
          else if (line.includes('EXAMINE')) serverWrite(sock, `${tag} OK [READ-ONLY] EXAMINE completed`);
          else if (line.includes('SEARCH')) {
            serverWrite(sock, '* SEARCH 5');
            serverWrite(sock, `${tag} OK SEARCH completed`);
          }
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new ImapClient({
      socket,
      username: 'user@example.test',
      password: 'secret',
      timeoutMs: 3000,
    });
    await client.open();
    const date = new Date('2025-01-15');
    const nums = await client.searchUnseen(date);
    expect(nums).toEqual([5]);
    const searchCmd = commandsSeen.find((c) => c.includes('SEARCH'));
    expect(searchCmd).toContain('SINCE');
    expect(searchCmd).toContain('15-Jan-2025');
  });

  test('FETCH envelope — parses FROM, SUBJECT, DATE headers; messages stay unread (PEEK)', async () => {
    const commandsSeen: string[] = [];

    fakeServer = await makeFakeImapServer((sock) => {
      serverWrite(sock, '* OK IMAP4rev1 Fake Server ready');
      sock.on('data', (chunk) => {
        const lines = chunk.toString().split(/\r\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          commandsSeen.push(line.trim());
          const tag = line.split(' ')[0] ?? 'A0001';
          if (line.includes('LOGIN')) serverWrite(sock, `${tag} OK LOGIN completed`);
          else if (line.includes('EXAMINE')) serverWrite(sock, `${tag} OK [READ-ONLY] EXAMINE completed`);
          else if (line.includes('FETCH') && line.includes('HEADER')) {
            serverWrite(sock, '* 3 FETCH (BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] ');
            serverWrite(sock, 'From: Alice <alice@example.test>');
            serverWrite(sock, 'Subject: Hello world');
            serverWrite(sock, 'Date: Mon, 10 Jun 2026 09:00:00 +0000');
            serverWrite(sock, 'Message-ID: <abc123@example.test>');
            serverWrite(sock, ')');
            serverWrite(sock, `${tag} OK FETCH completed`);
          }
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new ImapClient({
      socket,
      username: 'user@example.test',
      password: 'secret',
      timeoutMs: 3000,
    });
    await client.open();
    const envelopes = await client.fetchEnvelopes([3]);

    // Verify PEEK was used (messages not marked read)
    expect(commandsSeen.some((c) => c.includes('BODY.PEEK[HEADER'))).toBe(true);
    expect(commandsSeen.every((c) => !c.includes('BODY[HEADER') || c.includes('PEEK'))).toBe(true);

    expect(envelopes).toHaveLength(1);
    const env = envelopes[0];
    expect(env).toBeDefined();
    if (env) {
      expect(env.from).toContain('alice@example.test');
      expect(env.subject).toBe('Hello world');
      expect(env.date).toContain('Jun 2026');
    }
  });

  test('FETCH body preview — uses PEEK and returns bounded content', async () => {
    const commandsSeen: string[] = [];

    fakeServer = await makeFakeImapServer((sock) => {
      serverWrite(sock, '* OK IMAP4rev1 Fake Server ready');
      sock.on('data', (chunk) => {
        const lines = chunk.toString().split(/\r\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          commandsSeen.push(line.trim());
          const tag = line.split(' ')[0] ?? 'A0001';
          if (line.includes('LOGIN')) serverWrite(sock, `${tag} OK LOGIN completed`);
          else if (line.includes('EXAMINE')) serverWrite(sock, `${tag} OK [READ-ONLY] EXAMINE completed`);
          else if (line.includes('FETCH') && line.includes('TEXT')) {
            serverWrite(sock, '* 5 FETCH (BODY[TEXT]<0>');
            serverWrite(sock, 'Hello from the body');
            serverWrite(sock, ')');
            serverWrite(sock, `${tag} OK FETCH completed`);
          }
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new ImapClient({
      socket,
      username: 'user@example.test',
      password: 'secret',
      timeoutMs: 3000,
      maxBodyBytes: 512,
    });
    await client.open();
    const preview = await client.fetchBodyPreview(5);

    expect(commandsSeen.some((c) => c.includes('BODY.PEEK[TEXT]'))).toBe(true);
    expect(preview).toContain('Hello from the body');
  });

  test('LOGOUT — sends LOGOUT command and closes', async () => {
    const commandsSeen: string[] = [];

    fakeServer = await makeFakeImapServer((sock) => {
      serverWrite(sock, '* OK IMAP4rev1 Fake Server ready');
      sock.on('data', (chunk) => {
        const lines = chunk.toString().split(/\r\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          commandsSeen.push(line.trim());
          const tag = line.split(' ')[0] ?? 'A0001';
          if (line.includes('LOGIN')) serverWrite(sock, `${tag} OK LOGIN completed`);
          else if (line.includes('EXAMINE')) serverWrite(sock, `${tag} OK [READ-ONLY] EXAMINE completed`);
          else if (line.includes('LOGOUT')) {
            serverWrite(sock, '* BYE IMAP4rev1 Server logging out');
            serverWrite(sock, `${tag} OK LOGOUT completed`);
            sock.end();
          }
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new ImapClient({
      socket,
      username: 'user@example.test',
      password: 'secret',
      timeoutMs: 3000,
    });
    await client.open();
    await client.logout();
    expect(commandsSeen.some((c) => c.includes('LOGOUT'))).toBe(true);
  });
});

describe('formatImapDate', () => {
  test('formats date in IMAP SINCE format', () => {
    expect(formatImapDate(new Date('2025-01-15'))).toBe('15-Jan-2025');
    expect(formatImapDate(new Date('2026-06-10'))).toBe('10-Jun-2026');
    expect(formatImapDate(new Date('2024-12-01'))).toBe('1-Dec-2024');
  });
});
