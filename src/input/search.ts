export interface SearchMatch {
  readonly col: number;
  readonly length: number;
}

export interface SearchManager {
  readonly active: boolean;
  readonly query: string;
  getMatchesOnLine(row: number): readonly SearchMatch[];
  isCurrentMatch(row: number, col: number): boolean;
}
