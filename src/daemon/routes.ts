import {
  getOperatorMethod,
  type OperatorMethodId,
} from '@pellux/goodvibes-sdk/contracts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly dangerous?: boolean | undefined;
  readonly admin?: boolean | undefined;
}

export type RouteId = OperatorMethodId;

export function getRoute(id: RouteId): RouteDefinition {
  const method = getOperatorMethod(id);
  if (!method) throw new Error(`Unknown GoodVibes operator method: ${id}`);
  if (!method.http) {
    throw new Error(`GoodVibes operator method does not expose an HTTP route: ${id}`);
  }
  return {
    method: method.http.method,
    path: method.http.path,
    dangerous: method.dangerous,
    admin: method.access === 'admin',
  };
}
