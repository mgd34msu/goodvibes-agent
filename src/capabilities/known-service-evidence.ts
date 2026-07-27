import { join } from 'node:path';
import type { CapabilityProbe } from './capability-types.ts';

/**
 * Footprints of services that are configured on this machine whether or not
 * anything in this build knows how to use them.
 *
 * The agent told its owner it could not send email while working Google
 * credentials sat in ~/.gmail-mcp. Nothing lied: no email provider was
 * registered, email is not one of this product's channel surfaces, and the
 * daemon serves no email route, so every inventory honestly returned nothing.
 * The gap was that "nothing here is wired up" and "you cannot do this" came out
 * as the same answer, and the credentials sitting on disk went unmentioned —
 * no code path in this product reads that directory.
 *
 * This list closes that gap. When the ingredients for a capability are present
 * but nothing claims them, the index says what it found and what would make it
 * work, instead of a flat no.
 *
 * Entries are deliberately narrow: known locations for known services. They
 * never scan the disk and never read a credential's contents.
 */

export interface KnownServiceEvidence {
  /** The capability this configuration would satisfy, e.g. "email.send". */
  readonly capabilityId: string;
  readonly title: string;
  /** Plain-language name of the configuration, for the message. */
  readonly label: string;
  readonly evidence: readonly CapabilityProbe[];
  readonly fix: string;
}

/** The only files this product reads to discover MCP servers. */
export function mcpConfigLocations(homeDirectory: string, workingDirectory: string): readonly string[] {
  return [
    join(homeDirectory, '.config', 'mcp', 'mcp.json'),
    join(homeDirectory, '.mcp', 'mcp.json'),
    join(homeDirectory, '.config', 'claude', 'claude_desktop_config.json'),
    join(workingDirectory, '.mcp', 'mcp.json'),
    join(workingDirectory, '.goodvibes', 'mcp.json'),
  ];
}

export function knownServiceEvidence(homeDirectory: string, workingDirectory = homeDirectory): readonly KnownServiceEvidence[] {
  const gmailMcpDirectory = join(homeDirectory, '.gmail-mcp');
  const googleCredentialPaths = [
    join(gmailMcpDirectory, 'credentials.json'),
    join(gmailMcpDirectory, 'gcp-oauth.keys.json'),
    join(gmailMcpDirectory, 'google-workspace-credentials.json'),
    join(homeDirectory, '.config', 'gcloud', 'application_default_credentials.json'),
  ];
  const mcpFiles = mcpConfigLocations(homeDirectory, workingDirectory);
  const googleFix = [
    'These credentials belong to a Gmail MCP server, which this build does not read on its own.',
    `Add that server to one of the MCP config files this product does read (${mcpFiles.join(', ')});`,
    'its tools then become callable with mcp mode:"call".',
    'The built-in mail feature is a separate path: configure email.smtpHost, email.username, email.passwordRef and email.fromAddress to use it.',
    'Either one turns this from unavailable into usable.',
  ].join(' ');

  const googleEvidence: readonly CapabilityProbe[] = [
    { kind: 'any-file-present', paths: googleCredentialPaths, label: 'Google account credentials' },
  ];

  return [
    {
      capabilityId: 'email.send',
      title: 'Send email',
      label: 'Google account credentials',
      evidence: googleEvidence,
      fix: googleFix,
    },
    {
      capabilityId: 'email.read',
      title: 'Read email',
      label: 'Google account credentials',
      evidence: googleEvidence,
      fix: googleFix,
    },
    {
      capabilityId: 'calendar.read',
      title: 'Read the calendar',
      label: 'Google account credentials',
      evidence: googleEvidence,
      fix: googleFix,
    },
  ];
}
