import { join } from 'node:path';
import { agentHomeDir } from '../config.js';
import { JsonStore } from './json-store.js';

export interface CompanionSessionRecord {
  readonly sessionId: string;
  readonly title: string;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly modelRegistryKey?: string | undefined;
  readonly systemPromptHash?: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CompanionSessionRecovery {
  readonly previousSessionId: string;
  readonly newSessionId: string;
  readonly recoveredAt: number;
  readonly reason: 'session_not_found';
}

export interface CompanionSessionState {
  readonly active: CompanionSessionRecord | null;
  readonly lastRecovery: CompanionSessionRecovery | null;
}

export class CompanionSessionStore {
  private readonly store = new JsonStore<CompanionSessionState>(
    join(agentHomeDir(), 'companion-session.json'),
    { active: null, lastRecovery: null },
  );

  read(): CompanionSessionState {
    return this.store.read();
  }

  active(): CompanionSessionRecord | null {
    return this.read().active;
  }

  save(record: CompanionSessionRecord): CompanionSessionRecord {
    this.store.update(() => ({ active: record, lastRecovery: null }));
    return record;
  }

  recordRecovery(previousSessionId: string, record: CompanionSessionRecord): CompanionSessionRecovery {
    const recovery: CompanionSessionRecovery = {
      previousSessionId,
      newSessionId: record.sessionId,
      recoveredAt: Date.now(),
      reason: 'session_not_found',
    };
    this.store.update((state) => ({ ...state, active: record, lastRecovery: recovery }));
    return recovery;
  }

  clear(): void {
    this.store.write({ active: null, lastRecovery: null });
  }
}
