/**
 * Domain slice files local to this repo's runtime store. Both prior entries
 * (panels, ui-perf) now source their state and types from
 * @pellux/goodvibes-sdk/platform/runtime/store; this repo carries no local
 * domain slice file for either, so the boundary-contract scan below covers
 * an empty set.
 */
export const DOMAINS = [] as const;

export type DomainName = (typeof DOMAINS)[number];

export const DOMAIN_READ_MATRIX: ReadonlyArray<{
  readonly reader: DomainName;
  readonly reads: readonly DomainName[];
}> = [];

export function getAllowedReadsFor(reader: DomainName): ReadonlySet<DomainName> {
  return new Set<DomainName>([reader]);
}
