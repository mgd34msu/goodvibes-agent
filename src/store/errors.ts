export type RegistryKind = 'memory' | 'skill' | 'persona';

export class RegistryNotFoundError extends Error {
  readonly kind = 'not_found';

  constructor(
    readonly registry: RegistryKind,
    readonly identifier: string,
  ) {
    super(`${registry} record not found: ${identifier}`);
    this.name = 'RegistryNotFoundError';
  }
}

export class RegistryConflictError extends Error {
  readonly kind = 'conflict';

  constructor(
    readonly registry: RegistryKind,
    readonly identifier: string,
  ) {
    super(`${registry} record already exists: ${identifier}`);
    this.name = 'RegistryConflictError';
  }
}
