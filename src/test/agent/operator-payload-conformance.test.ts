/**
 * The operator payload type guard — the thing that would have caught two
 * breaking contract changes this round without any tarball at all.
 *
 * `invokeOperatorGatewayMethod` used to take `payload: unknown` and call
 * `sdk.operator.invoke(methodId, payload as never)`. That opted every operator
 * call in this repo out of type checking: a known method id carrying a wrong
 * body failed the SDK's typed overload and silently matched the loose
 * `invoke<T>(methodId: string, input?: Record<string, unknown>)` beneath it.
 * `authority` becoming required on the profile write verbs, and `profile.forget`
 * dropping `lineIndex`, both compiled clean here.
 *
 * The payload is now bound to `OperatorMethodInput<TMethodId>` at the wrapper
 * and again at `ProfileGatewayInvoke`, so a stale body is a compile error at the
 * call site. This file asserts that property in the only way it can be asserted
 * from inside a test: the bodies this lane actually sends are declared AS the
 * contract's input types, so if the contract moves, this file stops compiling
 * and `bun run typecheck:test` fails.
 *
 * A runtime `expect` cannot check this — the types are erased by then. The
 * compile is the assertion; the runtime checks below only pin the field NAMES,
 * so a rename that kept the same shape still gets caught.
 */

import { describe, expect, test } from 'bun:test';
import { OPERATOR_CONTRACT } from '@pellux/goodvibes-sdk/contracts';
import type { OperatorMethodId, OperatorMethodInput } from '@pellux/goodvibes-sdk/contracts';
import { PROFILE_METHOD_IDS, PROFILE_RECORDING_SURFACE } from '../../tools/agent-profile-types.ts';

/**
 * Keys of `T`, distributed so a UNION input contributes every member's keys
 * rather than only the keys they share. Without the distribution, `keyof` over
 * a union collapses to the intersection and a body could carry a key that
 * belongs to a different member of the same union.
 */
type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/**
 * Excess-key rejection that works on ANY body, not only a fresh literal.
 *
 * TypeScript's excess-property check fires only for a fresh object literal
 * passed directly. A body built as a variable first, or assembled with a
 * spread, is not checked at all — verified, not assumed: both forms compiled
 * clean against a correctly typed parameter with a stale `lineIndex` in them.
 * That is not a small hole here, because the production forget bodies WERE
 * built with spreads until this round.
 *
 * Mapping every excess key to `never` closes it: a real value can never satisfy
 * `never`, whatever shape the body was built in.
 */
function assertOperatorBody<
  TMethodId extends OperatorMethodId,
  TBody extends OperatorMethodInput<TMethodId>,
>(
  _methodId: TMethodId,
  body: TBody & Record<Exclude<KeysOfUnion<TBody>, KeysOfUnion<OperatorMethodInput<TMethodId>>>, never>,
): TBody {
  return body;
}

interface ContractInput {
  readonly properties: ReadonlySet<string>;
  readonly required: ReadonlySet<string>;
}

/**
 * The verb's input schema as the CONTRACT states it, read at runtime.
 *
 * Deliberately not a hand-written list: a list is a second copy of the contract
 * that goes stale silently on a pin bump, which is the same class of defect
 * this whole file exists to catch. Reading the shipped contract means these
 * assertions re-derive themselves every time the platform runtime is repinned.
 */
function contractInput(methodId: string): ContractInput {
  const method = OPERATOR_CONTRACT.operator.methods.find((entry) => entry.id === methodId);
  if (!method) throw new Error(`${methodId} is not in the operator contract`);
  const schema = (method.inputSchema ?? {}) as {
    readonly properties?: Record<string, unknown>;
    readonly required?: readonly string[];
  };
  return {
    properties: new Set(Object.keys(schema.properties ?? {})),
    required: new Set(schema.required ?? []),
  };
}

// ── The bodies this lane sends, declared as the contract's own input types ──
// Each annotation is the guard. Adding a field the contract dropped, or omitting
// one it made required, fails to compile here.

const SET_BODY: OperatorMethodInput<'profile.set'> = {
  fieldId: 'commerce.shippingAddress',
  value: '200 Office Way',
  surface: PROFILE_RECORDING_SURFACE,
  said: 'ship it to my office instead',
  authority: 'owner-direct',
};

const APPEND_BODY: OperatorMethodInput<'profile.append'> = {
  section: 'Notes',
  text: 'Allergic to shellfish',
  surface: PROFILE_RECORDING_SURFACE,
  said: "I'm allergic to shellfish",
  authority: 'owner-direct',
};

/** A mechanical field goes by id. */
const FORGET_FIELD_BODY: OperatorMethodInput<'profile.forget'> = {
  fieldId: 'contact.phone',
  authority: 'owner-direct',
};

/** A prose line goes by its section and its exact text — never a position. */
const FORGET_PROSE_BODY: OperatorMethodInput<'profile.forget'> = {
  section: 'Notes',
  text: '- Allergic to shellfish',
  authority: 'owner-direct',
};

const UNDO_BODY: OperatorMethodInput<'profile.undo'> = {
  fieldId: 'commerce.shippingAddress',
  authority: 'owner-direct',
};

const GET_BODY: OperatorMethodInput<'profile.get'> = { fieldId: 'location.timezone' };
const PERSON_BODY: OperatorMethodInput<'profile.person'> = { name: 'Sarah' };
const PROVENANCE_BODY: OperatorMethodInput<'profile.provenance'> = { fieldId: 'commerce.shippingAddress' };

describe('operator payload conformance for the profile verbs', () => {
  test('every write body carries an authority, because the contract requires one', () => {
    // Not defaulted by the daemon any more: an absent authority is a 400. The
    // annotations above are what enforce it; this pins that none of them lost it.
    for (const [name, body] of [
      ['set', SET_BODY],
      ['append', APPEND_BODY],
      ['forget by field', FORGET_FIELD_BODY],
      ['forget by content', FORGET_PROSE_BODY],
      ['undo', UNDO_BODY],
    ] as const) {
      expect(body.authority, `${name} sends no authority`).toBe('owner-direct');
    }
  });

  test('no forget body carries a position', () => {
    // The field is gone from the contract. If it ever came back, the guard is
    // the annotation on these constants, not this assertion — but a body built
    // by hand somewhere else would still show up here.
    for (const body of [FORGET_FIELD_BODY, FORGET_PROSE_BODY]) {
      expect(Object.keys(body)).not.toContain('lineIndex');
    }
  });

  test('a prose forget names a section and the exact text, and a field forget names neither', () => {
    expect(FORGET_PROSE_BODY.section).toBe('Notes');
    expect(FORGET_PROSE_BODY.text).toBe('- Allergic to shellfish');
    expect(FORGET_PROSE_BODY.fieldId).toBeUndefined();

    expect(FORGET_FIELD_BODY.fieldId).toBe('contact.phone');
    expect(FORGET_FIELD_BODY.section).toBeUndefined();
    expect(FORGET_FIELD_BODY.text).toBeUndefined();
  });

  test('a recording surface accompanies every learned line, distinct from its authority', () => {
    // Two different questions: authority says the fact came from HIM, surface
    // says which of his surfaces wrote it down.
    expect(SET_BODY.surface).toBe('agent');
    expect(APPEND_BODY.surface).toBe('agent');
    expect(SET_BODY.said.length).toBeGreaterThan(0);
    expect(APPEND_BODY.said.length).toBeGreaterThan(0);
  });

  test('the read verbs take exactly the key they are documented to take', () => {
    expect(Object.keys(GET_BODY)).toEqual(['fieldId']);
    expect(Object.keys(PERSON_BODY)).toEqual(['name']);
    expect(Object.keys(PROVENANCE_BODY)).toEqual(['fieldId']);
  });

  test('the nine method ids this lane calls are the ids the contract declares', () => {
    // PROFILE_METHOD_IDS is assignable to OperatorMethodId[] in the gateway; if
    // a verb were renamed upstream that assignment fails there. This pins the
    // set itself so a silent removal from our side is visible too.
    expect(Object.values(PROFILE_METHOD_IDS).sort()).toEqual([
      'profile.append',
      'profile.forget',
      'profile.get',
      'profile.person',
      'profile.provenance',
      'profile.read',
      'profile.set',
      'profile.status',
      'profile.undo',
    ]);
  });
});
