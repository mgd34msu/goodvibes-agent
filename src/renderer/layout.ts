export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

export function getTerminalSize(): TerminalSize {
  return {
    columns: process.stdout.columns || 100,
    rows: process.stdout.rows || 32,
  };
}

export function fitLine(line: string, width: number): string {
  if (line.length <= width) return line.padEnd(width);
  if (width <= 1) return line.slice(0, width);
  if (width <= 3) return line.slice(0, width);
  return `${line.slice(0, width - 3)}...`;
}
