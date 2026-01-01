export type SubscriptionProvider = 'claude' | 'codex' | 'antigravity';

export const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = [
  'claude',
  'codex',
  'antigravity'
];

export function isSubscriptionProvider(value: string): value is SubscriptionProvider {
  return (SUBSCRIPTION_PROVIDERS as string[]).includes(value);
}
