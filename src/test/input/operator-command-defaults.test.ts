import { describe, expect, test } from 'bun:test';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerSubscriptionRuntimeCommands } from '../../input/commands/subscription-runtime.ts';
import { registerSecurityRuntimeCommands } from '../../input/commands/security-runtime.ts';
import { policyCommand } from '../../input/commands/policy.ts';

function makeSubscriptionContext(out: string[], opened: string[]): CommandContext {
  return {
    print: (text: string) => { out.push(text); },
    openSubscriptionPanel: () => { opened.push('subscription'); },
    platform: {
      subscriptionManager: {
        list: () => [],
      },
      serviceRegistry: {
        getAll: () => ({}),
      },
    },
  } as unknown as CommandContext;
}

function makeSecurityContext(out: string[], opened: string[]): CommandContext {
  return {
    print: (text: string) => { out.push(text); },
    openSecurityPanel: () => { opened.push('security'); },
    platform: {
      readModels: {
        security: {
          getSnapshot: () => ({
            mcpServers: [],
            recentMcpDecisions: [],
          }),
        },
      },
      tokenAuditor: {
        auditAll: () => ({
          results: [],
          blocked: [],
          scopeViolations: [],
          rotationOverdue: [],
          rotationWarnings: [],
        }),
      },
      subscriptionManager: {
        list: () => [],
        listPending: () => [],
      },
    },
    extensions: {
      policyRuntimeState: {
        getSnapshot: () => ({
          lintFindings: [],
          lastPreflightReview: null,
        }),
      },
      pluginManager: {
        list: () => [],
      },
    },
  } as unknown as CommandContext;
}

describe('Agent operator command defaults', () => {
  test('/subscription defaults to transcript review instead of opening copied panels', async () => {
    const registry = new CommandRegistry();
    registerSubscriptionRuntimeCommands(registry);
    const out: string[] = [];
    const opened: string[] = [];

    await registry.execute('subscription', [], makeSubscriptionContext(out, opened));

    expect(opened).toEqual([]);
    expect(out.join('\n')).toContain('Subscription Review');
  });

  test('/security defaults to transcript review and blocks copied panel routing', async () => {
    const registry = new CommandRegistry();
    registerSecurityRuntimeCommands(registry);
    const out: string[] = [];
    const opened: string[] = [];

    await registry.execute('security', [], makeSecurityContext(out, opened));
    await registry.execute('security', ['open'], makeSecurityContext(out, opened));

    expect(opened).toEqual([]);
    expect(out.join('\n')).toContain('Security Review');
    expect(out.join('\n')).toContain('Use /security review');
  });

  test('/policy default usage does not open copied policy panels', async () => {
    const out: string[] = [];
    const opened: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      openPolicyPanel: () => { opened.push('policy'); },
    } as unknown as CommandContext;

    await policyCommand.handler([], context);

    expect(opened).toEqual([]);
    expect(out.join('\n')).toContain('Usage: /policy <subcommand>');
    expect(out.join('\n')).toContain('/policy status');
    expect(out.join('\n')).not.toContain('open the policy/governance panel');
  });
});
