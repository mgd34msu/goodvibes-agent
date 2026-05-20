export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function truncate(value: string, max = 96): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}...`;
}

export function titleFromText(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (!singleLine) return 'Untitled';
  return truncate(singleLine, 72);
}

export function wrapText(text: string, width: number): string[] {
  const targetWidth = Math.max(20, width);
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    let remaining = rawLine;
    if (!remaining) {
      lines.push('');
      continue;
    }
    while (remaining.length > targetWidth) {
      let breakAt = remaining.lastIndexOf(' ', targetWidth);
      if (breakAt < Math.floor(targetWidth * 0.4)) breakAt = targetWidth;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
}
