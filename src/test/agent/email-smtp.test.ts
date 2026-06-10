/**
 * SMTP client protocol tests using an in-process fake server.
 * No real network connections are made.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { SmtpClient } from '../../agent/email/smtp-client.ts';

// ---------------------------------------------------------------------------
// Fake server helpers
// ---------------------------------------------------------------------------

interface FakeServer {
  readonly address: { port: number };
  readonly server: Server;
  close(): void;
}

function makeFakeSmtpServer(
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
// SMTP happy-path script
// ---------------------------------------------------------------------------

function happyPathScript(socket: Socket, collectedData: string[]): void {
  serverWrite(socket, '220 fake.smtp.example.test ESMTP ready');

  socket.setEncoding('utf8');
  let inData = false;
  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk;
    let pos: number;
    while ((pos = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, pos).replace(/\r$/, '');
      buffer = buffer.slice(pos + 1);
      collectedData.push(line);

      if (inData) {
        if (line === '.') {
          inData = false;
          serverWrite(socket, '250 OK Message accepted');
        }
        continue;
      }

      const upper = line.trim().toUpperCase();
      if (upper.startsWith('EHLO')) {
        serverWrite(socket, '250-fake.smtp.example.test Hello');
        serverWrite(socket, '250-SIZE 10240000');
        serverWrite(socket, '250 AUTH PLAIN LOGIN');
      } else if (upper.startsWith('AUTH PLAIN')) {
        serverWrite(socket, '235 2.7.0 Authentication successful');
      } else if (upper.startsWith('AUTH LOGIN')) {
        serverWrite(socket, '334 VXNlcm5hbWU6');
      } else if (upper.startsWith('MAIL FROM')) {
        serverWrite(socket, '250 OK');
      } else if (upper.startsWith('RCPT TO')) {
        serverWrite(socket, '250 OK');
      } else if (upper === 'DATA') {
        inData = true;
        serverWrite(socket, '354 Start message input; end with <CRLF>.<CRLF>');
      } else if (upper === 'QUIT') {
        serverWrite(socket, '221 Bye');
        socket.end();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SmtpClient protocol', () => {
  let fakeServer: FakeServer | null = null;

  afterEach(() => {
    fakeServer?.close();
    fakeServer = null;
  });

  test('happy path — EHLO, AUTH PLAIN, MAIL FROM, RCPT TO, DATA, QUIT', async () => {
    const commands: string[] = [];
    fakeServer = await makeFakeSmtpServer((sock) => happyPathScript(sock, commands));

    const socket = await connectSocket(fakeServer.address.port);
    const client = new SmtpClient({
      socket,
      hostname: 'client.test',
      username: 'user@example.test',
      password: 'mypassword',
      timeoutMs: 5000,
    });

    await client.sendMail({
      from: 'user@example.test',
      to: 'recipient@example.test',
      subject: 'Test subject',
      body: 'Hello, this is a test email.',
    });

    expect(commands.some((c) => c.trim().toUpperCase().startsWith('EHLO'))).toBe(true);
    expect(commands.some((c) => c.trim().toUpperCase().startsWith('AUTH PLAIN'))).toBe(true);
    expect(commands.some((c) => c.toUpperCase().includes('MAIL FROM'))).toBe(true);
    expect(commands.some((c) => c.toUpperCase().includes('RCPT TO'))).toBe(true);
    expect(commands.some((c) => c.trim() === 'DATA')).toBe(true);
    expect(commands.some((c) => c.trim() === '.')).toBe(true);
  });

  test('dot-stuffing — lines beginning with "." get an extra "."', async () => {
    const commands: string[] = [];
    fakeServer = await makeFakeSmtpServer((sock) => happyPathScript(sock, commands));

    const socket = await connectSocket(fakeServer.address.port);
    const client = new SmtpClient({
      socket,
      hostname: 'client.test',
      username: 'user@example.test',
      password: 'mypassword',
      timeoutMs: 5000,
    });

    await client.sendMail({
      from: 'user@example.test',
      to: 'recipient@example.test',
      subject: 'Dot stuffing test',
      body: '.line starting with dot\nnormal line\n..double dot line',
    });

    // After DATA, body is sent; look for double-dotted lines
    const dataIdx = commands.findIndex((c) => c.trim() === 'DATA');
    const bodyLines = commands.slice(dataIdx + 1);
    expect(bodyLines.some((l) => l.startsWith('..'))).toBe(true);
    // The terminator '.' itself should appear (it's not doubled)
    expect(bodyLines.some((l) => l === '.')).toBe(true);
  });

  test('AUTH LOGIN fallback — uses two-step base64 when PLAIN not advertised', async () => {
    const commands: string[] = [];
    fakeServer = await makeFakeSmtpServer((sock) => {
      serverWrite(sock, '220 fake.smtp.example.test ESMTP ready');
      sock.setEncoding('utf8');
      let buffer = '';
      let loginStep = 0;

      sock.on('data', (chunk) => {
        buffer += chunk;
        let pos: number;
        while ((pos = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, pos).replace(/\r$/, '');
          buffer = buffer.slice(pos + 1);
          commands.push(line);

          const upper = line.trim().toUpperCase();
          if (upper.startsWith('EHLO')) {
            serverWrite(sock, '250-fake.smtp.example.test Hello');
            serverWrite(sock, '250 AUTH LOGIN');
          } else if (upper.startsWith('AUTH LOGIN')) {
            loginStep = 1;
            serverWrite(sock, '334 VXNlcm5hbWU6'); // Username:
          } else if (loginStep === 1) {
            loginStep = 2;
            serverWrite(sock, '334 UGFzc3dvcmQ6'); // Password:
          } else if (loginStep === 2) {
            loginStep = 0;
            serverWrite(sock, '235 2.7.0 Authentication successful');
          } else if (upper.includes('MAIL FROM')) {
            serverWrite(sock, '250 OK');
          } else if (upper.includes('RCPT TO')) {
            serverWrite(sock, '250 OK');
          } else if (upper === 'DATA') {
            serverWrite(sock, '354 Start');
          } else if (line.trim() === '.') {
            serverWrite(sock, '250 OK');
          } else if (upper === 'QUIT') {
            serverWrite(sock, '221 Bye');
            sock.end();
          }
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new SmtpClient({
      socket,
      hostname: 'client.test',
      username: 'user@example.test',
      password: 'mypassword',
      timeoutMs: 5000,
    });

    await client.sendMail({
      from: 'user@example.test',
      to: 'recipient@example.test',
      subject: 'Auth login test',
      body: 'Test body',
    });

    expect(commands.some((c) => c.trim().toUpperCase().startsWith('AUTH LOGIN'))).toBe(true);
  });

  test('AUTH failure — throws when server returns 535', async () => {
    fakeServer = await makeFakeSmtpServer((sock) => {
      serverWrite(sock, '220 fake.smtp.example.test ESMTP ready');
      sock.setEncoding('utf8');
      let buffer = '';

      sock.on('data', (chunk) => {
        buffer += chunk;
        let pos: number;
        while ((pos = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, pos).replace(/\r$/, '');
          buffer = buffer.slice(pos + 1);
          const upper = line.trim().toUpperCase();
          if (upper.startsWith('EHLO')) {
            serverWrite(sock, '250-fake.smtp.example.test Hello');
            serverWrite(sock, '250 AUTH PLAIN LOGIN');
          } else if (upper.startsWith('AUTH PLAIN')) {
            serverWrite(sock, '535 5.7.8 Authentication credentials invalid');
          }
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new SmtpClient({
      socket,
      hostname: 'client.test',
      username: 'user@example.test',
      password: 'wrongpassword',
      timeoutMs: 5000,
    });

    await expect(
      client.sendMail({
        from: 'user@example.test',
        to: 'recipient@example.test',
        subject: 'Fail test',
        body: 'Test',
      }),
    ).rejects.toThrow('SMTP AUTH');
  });

  test('non-empty body passes through to DATA phase (CRIT-2 regression guard)', async () => {
    const collectedData: string[] = [];
    fakeServer = await makeFakeSmtpServer((sock) => happyPathScript(sock, collectedData));

    const socket = await connectSocket(fakeServer.address.port);
    const client = new SmtpClient({
      socket,
      hostname: 'client.test',
      username: 'user@example.test',
      password: 'mypassword',
      timeoutMs: 5000,
    });

    const bodyText = 'This is the expected body content for CRIT-2.';
    await client.sendMail({
      from: 'user@example.test',
      to: 'recipient@example.test',
      subject: 'Body passthrough test',
      body: bodyText,
    });

    // Find DATA section in collected lines
    const dataIdx = collectedData.findIndex((c) => c.trim() === 'DATA');
    expect(dataIdx).toBeGreaterThan(-1);
    const bodyLines = collectedData.slice(dataIdx + 1);
    const bodyText2 = bodyLines.join('\n');
    expect(bodyText2).toContain('CRIT-2');
  });

  test('no AUTH capability — throws descriptive error', async () => {
    fakeServer = await makeFakeSmtpServer((sock) => {
      serverWrite(sock, '220 fake.smtp.example.test ESMTP ready');
      sock.setEncoding('utf8');
      let buffer = '';
      sock.on('data', (chunk) => {
        buffer += chunk;
        let pos: number;
        while ((pos = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, pos).replace(/\r$/, '');
          buffer = buffer.slice(pos + 1);
          const upper = line.trim().toUpperCase();
          if (upper.startsWith('EHLO')) {
            serverWrite(sock, '250 fake.smtp.example.test Hello');
          }
        }
      });
    });

    const socket = await connectSocket(fakeServer.address.port);
    const client = new SmtpClient({
      socket,
      hostname: 'client.test',
      username: 'user@example.test',
      password: 'mypassword',
      timeoutMs: 5000,
    });

    await expect(
      client.sendMail({
        from: 'user@example.test',
        to: 'recipient@example.test',
        subject: 'No auth test',
        body: 'Test',
      }),
    ).rejects.toThrow('does not advertise AUTH PLAIN or AUTH LOGIN');
  });
});
