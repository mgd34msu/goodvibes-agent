import type { McpWorkspace, McpWorkspaceRow, McpWorkspaceServerRow } from '../input/mcp-workspace.ts';
import type { Line } from '@pellux/goodvibes-sdk/platform/types';
import { wrapText } from '../utils/terminal-width.ts';
import { GLYPHS } from './ui-primitives.ts';
import {
  getFullscreenWorkspaceMetrics,
  padDisplay,
  renderFullscreenWorkspace,
  stableWindow,
  WORKSPACE_PALETTE as PALETTE,
  type WorkspaceRow,
} from './fullscreen-workspace.ts';

const MCP_WORKSPACE_TITLE = 'MCP Workspace / Servers';
const MCP_WORKSPACE_LEFT_HEADER = 'Servers';
const MCP_WORKSPACE_GROUP_SERVERS = 'SERVERS';
const MCP_WORKSPACE_GROUP_ACTIONS = 'ACTIONS';
const MCP_WORKSPACE_NO_CONFIGURED_SERVERS = '  No configured servers';
const MCP_WORKSPACE_FORM_WRITE_CONFIRMATION = 'Workspace writes require explicit confirmation. Type yes on the Confirm field, then save from here.';
const MCP_WORKSPACE_FORM_CONFIG_LOCATIONS = 'Project/global config locations are shown for review. The workspace dispatches confirmed MCP changes through the shell-owned command router.';
const MCP_WORKSPACE_REMOVE_HELP = 'Press Enter or y to remove through the shell-owned command router.';
const MCP_WORKSPACE_REMOVE_CANCEL_HELP = 'Press n or Esc to return without changing config.';
const MCP_WORKSPACE_RELOAD_TITLE = 'Reload MCP runtime';
const MCP_WORKSPACE_RELOAD_HELP = 'Press Enter or y to reload MCP runtime from the current config through the shell-owned command router.';
const MCP_WORKSPACE_RELOAD_CANCEL_HELP = 'Press n or Esc to return without reloading.';
const MCP_WORKSPACE_NO_ROWS = 'No MCP rows available.';
const MCP_WORKSPACE_RUNTIME_ONLY_COMMAND = '(runtime only; no launch config found)';
const MCP_WORKSPACE_NONE = '(none)';
const MCP_WORKSPACE_STATUS_PREFIX = 'Status:';
const MCP_WORKSPACE_FORM_HEADER_FIELD = 'Field';
const MCP_WORKSPACE_FORM_HEADER_VALUE = 'Value';
const MCP_WORKSPACE_FORM_HEADER_EDIT = 'Edit';
const MCP_WORKSPACE_FORM_TEXT_EDIT = 'text';
const MCP_WORKSPACE_FORM_ACTION_EDIT = 'cycle/action';
const MCP_WORKSPACE_EMPTY_VALUE = '(empty)';
const MCP_WORKSPACE_TOOL_HEADER_TOOL = 'Tool';
const MCP_WORKSPACE_TOOL_HEADER_SERVER = 'Server';
const MCP_WORKSPACE_TOOL_HEADER_DESCRIPTION = 'Description';
const MCP_WORKSPACE_TOOLS_LOADING = 'Tools: loading...';
const MCP_WORKSPACE_TOOLS_LOADING_DETAIL = 'Loading tool list from connected MCP servers.';
const MCP_WORKSPACE_TOOLS_EMPTY = 'No tools cached for the selected server. Press t to refresh.';
const MCP_WORKSPACE_CONFIRM_CANCEL_ROW = '  Cancel and return to MCP server browser';
const MCP_WORKSPACE_CONFIRM_RELOAD = 'Confirm MCP runtime reload';
const MCP_WORKSPACE_FOOTER_FORM = 'Focus MCP server form · Up/Down field · Left/Right cycle · Type edit · Enter save/cancel · Esc back';
const MCP_WORKSPACE_FOOTER_DELETE = 'Focus remove confirmation · Enter/y remove · n/Esc cancel';
const MCP_WORKSPACE_FOOTER_RELOAD = 'Focus reload confirmation · Enter/y reload · n/Esc cancel';
const MCP_WORKSPACE_FOOTER_BROWSE = 'Focus MCP workspace · Up/Down choose · Enter view/action · a add · d remove · r reload · t tools · Esc close';

function mcpWorkspaceStateLabel(mode: McpWorkspace['mode']): string {
  return mode === 'browse' ? 'Browse' : mode === 'form' ? 'Server Form' : mode === 'delete-confirm' ? 'Remove Confirm' : 'Reload Confirm';
}

function mcpWorkspaceMainHeader(mode: McpWorkspace['mode'], connected: string | number, servers: string | number, tools: string | number): string {
  if (mode === 'form') return 'MCP server form';
  if (mode === 'delete-confirm') return 'MCP remove confirmation';
  if (mode === 'reload-confirm') return 'MCP reload confirmation';
  return `Servers ${connected}/${servers} connected · Tools ${tools}`;
}

function mcpWorkspaceToolsLabel(loading: boolean, server: string | undefined, count: string | number): string {
  if (loading) return MCP_WORKSPACE_TOOLS_LOADING;
  return server ? `Tools for ${server}: ${count}` : `Tools: ${count}`;
}

export function renderMcpWorkspacePackageText(): string {
  return [
    MCP_WORKSPACE_TITLE,
    MCP_WORKSPACE_LEFT_HEADER,
    mcpWorkspaceStateLabel('browse'),
    mcpWorkspaceStateLabel('form'),
    mcpWorkspaceStateLabel('delete-confirm'),
    mcpWorkspaceStateLabel('reload-confirm'),
    mcpWorkspaceMainHeader('browse', '<connected>', '<servers>', '<tools>'),
    mcpWorkspaceMainHeader('form', '<connected>', '<servers>', '<tools>'),
    mcpWorkspaceMainHeader('delete-confirm', '<connected>', '<servers>', '<tools>'),
    mcpWorkspaceMainHeader('reload-confirm', '<connected>', '<servers>', '<tools>'),
    MCP_WORKSPACE_GROUP_SERVERS,
    MCP_WORKSPACE_GROUP_ACTIONS,
    MCP_WORKSPACE_NO_CONFIGURED_SERVERS.trim(),
    'project config',
    'global config',
    'external config',
    'runtime',
    'Drafting an MCP server',
    'Editing server <server>',
    MCP_WORKSPACE_FORM_WRITE_CONFIRMATION,
    MCP_WORKSPACE_FORM_CONFIG_LOCATIONS,
    'Remove server: <server>',
    MCP_WORKSPACE_REMOVE_HELP,
    MCP_WORKSPACE_REMOVE_CANCEL_HELP,
    MCP_WORKSPACE_RELOAD_TITLE,
    MCP_WORKSPACE_RELOAD_HELP,
    MCP_WORKSPACE_RELOAD_CANCEL_HELP,
    MCP_WORKSPACE_NO_ROWS,
    'Connected: <yes-no>    Origin: <origin>    Config: <freshness>',
    'Role: <role>    Review policy: <trust-mode>',
    `Command: ${MCP_WORKSPACE_RUNTIME_ONLY_COMMAND}`,
    `Allowed paths: ${MCP_WORKSPACE_NONE}`,
    `Allowed hosts: ${MCP_WORKSPACE_NONE}`,
    `${MCP_WORKSPACE_STATUS_PREFIX} <status>`,
    MCP_WORKSPACE_FORM_HEADER_FIELD,
    MCP_WORKSPACE_FORM_HEADER_VALUE,
    MCP_WORKSPACE_FORM_HEADER_EDIT,
    MCP_WORKSPACE_FORM_TEXT_EDIT,
    MCP_WORKSPACE_FORM_ACTION_EDIT,
    MCP_WORKSPACE_EMPTY_VALUE,
    mcpWorkspaceToolsLabel(true, undefined, '<count>'),
    mcpWorkspaceToolsLabel(false, '<server>', '<count>'),
    mcpWorkspaceToolsLabel(false, undefined, '<count>'),
    MCP_WORKSPACE_TOOL_HEADER_TOOL,
    MCP_WORKSPACE_TOOL_HEADER_SERVER,
    MCP_WORKSPACE_TOOL_HEADER_DESCRIPTION,
    MCP_WORKSPACE_TOOLS_LOADING_DETAIL,
    MCP_WORKSPACE_TOOLS_EMPTY,
    'Confirm remove <server>',
    MCP_WORKSPACE_CONFIRM_RELOAD,
    MCP_WORKSPACE_CONFIRM_CANCEL_ROW.trim(),
    MCP_WORKSPACE_FOOTER_FORM,
    MCP_WORKSPACE_FOOTER_DELETE,
    MCP_WORKSPACE_FOOTER_RELOAD,
    MCP_WORKSPACE_FOOTER_BROWSE,
  ].join('\n');
}

function statusColor(text: string): string {
  if (text.includes('failed') || text.includes('Save failed') || text.includes('Remove failed')) return PALETTE.bad;
  if (text.includes('attention') || text.includes('quarantine')) return PALETTE.warn;
  return PALETTE.muted;
}

function connectedColor(connected: boolean): string {
  return connected ? PALETTE.good : PALETTE.warn;
}

function serverOriginLabel(source: McpWorkspaceServerRow['source']): string {
  switch (source) {
    case 'project':
      return 'project config';
    case 'global':
      return 'global config';
    case 'external':
      return 'external config';
    case 'runtime':
      return 'runtime';
  }
}

function rowLabel(row: McpWorkspaceRow): string {
  if (row.type === 'server') return `${row.server.name} (${serverOriginLabel(row.server.source)})`;
  return row.label;
}

function rowDetail(row: McpWorkspaceRow): string {
  if (row.type === 'server') {
    const server = row.server;
    return `${server.connected ? 'connected' : 'offline'} · ${server.role} · ${server.trustMode} · config ${server.freshness}`;
  }
  return row.detail;
}

function buildLeftRows(workspace: McpWorkspace, height: number): WorkspaceRow[] {
  const rendered: WorkspaceRow[] = [];
  let selectedRenderedIndex = 0;
  let sawServerGroup = false;
  let sawActionGroup = false;

  workspace.rows.forEach((row, rowIndex) => {
    if (row.type === 'server' && !sawServerGroup) {
      rendered.push({ text: MCP_WORKSPACE_GROUP_SERVERS, kind: 'group', bold: true });
      sawServerGroup = true;
    }
    if (row.type === 'action' && !sawActionGroup) {
      if (!sawServerGroup) rendered.push({ text: MCP_WORKSPACE_GROUP_SERVERS, kind: 'group', bold: true });
      if (workspace.servers.length === 0) rendered.push({ text: MCP_WORKSPACE_NO_CONFIGURED_SERVERS, kind: 'item', fg: PALETTE.dim, dim: true });
      rendered.push({ text: MCP_WORKSPACE_GROUP_ACTIONS, kind: 'group', bold: true });
      sawActionGroup = true;
    }

    const selected = workspace.mode === 'browse' && rowIndex === workspace.selectedIndex;
    if (selected) selectedRenderedIndex = rendered.length;
    const marker = selected ? GLYPHS.navigation.selected : row.type === 'server' ? (row.server.connected ? '✓' : '•') : '+';
    rendered.push({
      text: `  ${marker} ${rowLabel(row)}`,
      selected,
      kind: 'item',
      fg: row.type === 'server' ? connectedColor(row.server.connected) : PALETTE.info,
      bold: selected || row.type === 'action',
    });
  });

  const visible = Math.max(1, height);
  const window = stableWindow(rendered.length, selectedRenderedIndex, visible);
  const rows = rendered.slice(window.start, window.end);
  if (window.start > 0 && rows.length > 0) {
    rows[0] = { text: `${GLYPHS.navigation.moreAbove} ${window.start} more row(s) above`, kind: 'more', fg: PALETTE.dim, dim: true };
  }
  if (window.end < rendered.length && rows.length > 0) {
    rows[rows.length - 1] = { text: `${GLYPHS.navigation.moreBelow} ${rendered.length - window.end} more row(s) below`, kind: 'more', fg: PALETTE.dim, dim: true };
  }
  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function selectedDetailLines(workspace: McpWorkspace, width: number): WorkspaceRow[] {
  const lines: string[] = [];
  if (workspace.mode === 'form') {
    const field = workspace.formFields[workspace.formIndex];
    lines.push(
      workspace.editingServerName ? `Editing server ${workspace.editingServerName}` : 'Drafting an MCP server',
      MCP_WORKSPACE_FORM_WRITE_CONFIRMATION,
      field ? `${field.label}: ${field.help}` : '',
      MCP_WORKSPACE_FORM_CONFIG_LOCATIONS,
    );
  } else if (workspace.mode === 'delete-confirm') {
    lines.push(
      `Remove server: ${workspace.editingServerName ?? '(unknown)'}`,
      MCP_WORKSPACE_REMOVE_HELP,
      MCP_WORKSPACE_REMOVE_CANCEL_HELP,
    );
  } else if (workspace.mode === 'reload-confirm') {
    lines.push(
      MCP_WORKSPACE_RELOAD_TITLE,
      MCP_WORKSPACE_RELOAD_HELP,
      MCP_WORKSPACE_RELOAD_CANCEL_HELP,
    );
  } else {
    const selected = workspace.selectedRow;
    if (!selected) lines.push(MCP_WORKSPACE_NO_ROWS);
    else if (selected.type === 'action') lines.push(selected.label, selected.detail);
    else {
      const server = selected.server;
      lines.push(
        server.name,
        `Connected: ${server.connected ? 'yes' : 'no'}    Origin: ${serverOriginLabel(server.source)}    Config: ${server.freshness}`,
        `Role: ${server.role}    Review policy: ${server.trustMode}`,
        `Command: ${server.command ? `${server.command}${server.args?.length ? ` ${server.args.join(' ')}` : ''}` : MCP_WORKSPACE_RUNTIME_ONLY_COMMAND}`,
        `Allowed paths: ${server.allowedPaths.length > 0 ? server.allowedPaths.join(', ') : MCP_WORKSPACE_NONE}`,
        `Allowed hosts: ${server.allowedHosts.length > 0 ? server.allowedHosts.join(', ') : MCP_WORKSPACE_NONE}`,
        ...(server.quarantineReason ? [`Quarantine: ${server.quarantineReason}${server.quarantineDetail ? ` - ${server.quarantineDetail}` : ''}`] : []),
      );
    }
  }

  lines.push('', `${MCP_WORKSPACE_STATUS_PREFIX} ${workspace.status}`);
  return lines.flatMap((text, index): WorkspaceRow[] => {
    if (text === '') return [{ text: '', dim: true }];
    return wrapText(text, Math.max(1, width)).map((wrapped, wrapIndex): WorkspaceRow => ({
      text: wrapped,
      fg: index === 0 ? PALETTE.title : text.startsWith(MCP_WORKSPACE_STATUS_PREFIX) ? statusColor(workspace.status) : PALETTE.text,
      bold: index === 0 && wrapIndex === 0,
      dim: text.length === 0,
    }));
  });
}

function buildFormRows(workspace: McpWorkspace, width: number, height: number): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [];
  const fields = workspace.formFields;
  const labelWidth = Math.min(24, Math.max(14, Math.floor(width * 0.24)));
  const valueWidth = Math.max(12, width - labelWidth - 20);
  rows.push({
    text: `  ${padDisplay(MCP_WORKSPACE_FORM_HEADER_FIELD, labelWidth)}  ${padDisplay(MCP_WORKSPACE_FORM_HEADER_VALUE, valueWidth)}  ${padDisplay(MCP_WORKSPACE_FORM_HEADER_EDIT, 10)}`,
    fg: PALETTE.muted,
    bold: true,
  });

  const visible = Math.max(1, height - 2);
  const window = stableWindow(fields.length, workspace.formIndex, visible);
  if (window.start > 0) rows.push({ text: `${GLYPHS.navigation.moreAbove} ${window.start} more field(s) above`, kind: 'more', fg: PALETTE.dim, dim: true });
  for (let index = window.start; index < window.end; index += 1) {
    const field = fields[index]!;
    const selected = index === workspace.formIndex;
    const marker = selected ? GLYPHS.navigation.selected : ' ';
    const value = field.id === 'save' || field.id === 'cancel'
      ? field.help
      : field.value.length > 0 ? field.value : MCP_WORKSPACE_EMPTY_VALUE;
    rows.push({
      text: `${marker} ${padDisplay(field.label, labelWidth)}  ${padDisplay(value, valueWidth)}  ${padDisplay(field.editable ? MCP_WORKSPACE_FORM_TEXT_EDIT : MCP_WORKSPACE_FORM_ACTION_EDIT, 12)}`,
      selected,
      fg: field.id === 'save' ? PALETTE.good : field.id === 'cancel' ? PALETTE.warn : field.editable ? PALETTE.text : PALETTE.info,
      bold: selected,
    });
  }
  if (window.end < fields.length) rows.push({ text: `${GLYPHS.navigation.moreBelow} ${fields.length - window.end} more field(s) below`, kind: 'more', fg: PALETTE.dim, dim: true });
  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function buildToolRows(workspace: McpWorkspace, width: number, height: number): WorkspaceRow[] {
  const server = workspace.selectedServer?.name;
  const tools = server ? workspace.tools.filter((tool) => tool.serverName === server) : workspace.tools;
  const toolWidth = Math.min(36, Math.max(18, Math.floor(width * 0.34)));
  const serverWidth = Math.min(24, Math.max(12, Math.floor(width * 0.20)));
  const descriptionWidth = Math.max(12, width - toolWidth - serverWidth - 8);
  const label = mcpWorkspaceToolsLabel(workspace.loadingTools, server, tools.length);
  const rows: WorkspaceRow[] = [
    { text: label, fg: PALETTE.subtitle, bold: true },
    { text: `  ${padDisplay(MCP_WORKSPACE_TOOL_HEADER_TOOL, toolWidth)}  ${padDisplay(MCP_WORKSPACE_TOOL_HEADER_SERVER, serverWidth)}  ${padDisplay(MCP_WORKSPACE_TOOL_HEADER_DESCRIPTION, descriptionWidth)}`, fg: PALETTE.muted, bold: true },
  ];

  if (tools.length === 0) {
    rows.push({
      text: workspace.loadingTools ? MCP_WORKSPACE_TOOLS_LOADING_DETAIL : MCP_WORKSPACE_TOOLS_EMPTY,
      fg: PALETTE.muted,
      dim: true,
    });
  } else {
    for (const tool of tools.slice(0, Math.max(0, height - rows.length))) {
      rows.push({
        text: `  ${padDisplay(tool.toolName, toolWidth)}  ${padDisplay(tool.serverName, serverWidth)}  ${padDisplay(tool.description ?? '', descriptionWidth)}`,
        fg: PALETTE.text,
      });
    }
  }

  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function buildDeleteRows(workspace: McpWorkspace, height: number): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [
    { text: `${GLYPHS.navigation.selected} Confirm remove ${workspace.editingServerName ?? '(unknown)'}`, selected: true, fg: PALETTE.bad, bold: true },
    { text: MCP_WORKSPACE_CONFIRM_CANCEL_ROW, fg: PALETTE.muted },
  ];
  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function buildReloadRows(height: number): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [
    { text: `${GLYPHS.navigation.selected} ${MCP_WORKSPACE_CONFIRM_RELOAD}`, selected: true, fg: PALETTE.warn, bold: true },
    { text: MCP_WORKSPACE_CONFIRM_CANCEL_ROW, fg: PALETTE.muted },
  ];
  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function buildControlRows(workspace: McpWorkspace, width: number, height: number): WorkspaceRow[] {
  if (workspace.mode === 'form') return buildFormRows(workspace, width, height);
  if (workspace.mode === 'delete-confirm') return buildDeleteRows(workspace, height);
  if (workspace.mode === 'reload-confirm') return buildReloadRows(height);
  return buildToolRows(workspace, width, height);
}

function footerText(workspace: McpWorkspace): string {
  if (workspace.mode === 'form') return MCP_WORKSPACE_FOOTER_FORM;
  if (workspace.mode === 'delete-confirm') return MCP_WORKSPACE_FOOTER_DELETE;
  if (workspace.mode === 'reload-confirm') return MCP_WORKSPACE_FOOTER_RELOAD;
  return MCP_WORKSPACE_FOOTER_BROWSE;
}

export function renderMcpWorkspace(workspace: McpWorkspace, width: number, height: number): Line[] {
  const metrics = getFullscreenWorkspaceMetrics({ width, height });
  const connected = workspace.servers.filter((server) => server.connected).length;
  const stateLabel = mcpWorkspaceStateLabel(workspace.mode);
  const mainHeader = mcpWorkspaceMainHeader(workspace.mode, connected, workspace.servers.length, workspace.tools.length);

  return renderFullscreenWorkspace({
    width,
    height,
    title: MCP_WORKSPACE_TITLE,
    stateLabel,
    leftHeader: MCP_WORKSPACE_LEFT_HEADER,
    mainHeader,
    leftRows: buildLeftRows(workspace, metrics.bodyRows),
    contextRows: selectedDetailLines(workspace, metrics.contextWidth),
    controlRows: buildControlRows(workspace, metrics.contextWidth, metrics.controlRows),
    footer: footerText(workspace),
  });
}
