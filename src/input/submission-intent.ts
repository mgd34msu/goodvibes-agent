export type SubmissionIntentKind =
  | 'empty'
  | 'prompt'
  | 'slash-command'
  | 'orchestration'
  | 'delegation'
  | 'plan'
  | 'panel-action'
  | 'shell'
  | 'memory-pin';

export interface SubmissionIntent {
  readonly kind: SubmissionIntentKind;
  readonly label: string;
  readonly commandName?: string;
  readonly hasAttachments: boolean;
}
