import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { encryptToken, decryptToken } from './claude-profile/token-encryption';
import type { SubscriptionProvider } from './terminal/subscription-providers';

interface SubscriptionAccountData {
  provider: SubscriptionProvider;
  token?: string;
  email?: string;
  tokenCreatedAt?: Date;
}

interface SubscriptionAccountStoreData {
  version: number;
  accounts: Partial<Record<SubscriptionProvider, SubscriptionAccountData>>;
}

interface SerializedSubscriptionAccountData {
  provider: SubscriptionProvider;
  token?: string;
  email?: string;
  tokenCreatedAt?: string;
}

interface SerializedSubscriptionAccountStoreData {
  version: number;
  accounts: Partial<Record<SubscriptionProvider, SerializedSubscriptionAccountData>>;
}

export class SubscriptionAccountManager {
  private storePath: string;
  private data: SubscriptionAccountStoreData;

  constructor() {
    const configDir = join(app.getPath('userData'), 'config');
    this.storePath = join(configDir, 'subscription-accounts.json');

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    this.data = this.load();
  }

  getAccount(provider: SubscriptionProvider): SubscriptionAccountData | undefined {
    return this.data.accounts[provider];
  }

  getProviderToken(provider: SubscriptionProvider): string | undefined {
    const account = this.data.accounts[provider];
    if (!account?.token) {
      return undefined;
    }
    return decryptToken(account.token);
  }

  setProviderToken(provider: SubscriptionProvider, token: string, email?: string): boolean {
    const existing = this.data.accounts[provider];
    const existingToken = existing?.token ? decryptToken(existing.token) : undefined;
    if (existingToken === token && (!email || email === existing?.email)) {
      return true;
    }

    this.data.accounts[provider] = {
      provider,
      token: encryptToken(token),
      tokenCreatedAt: new Date(),
      email: email ?? existing?.email
    };

    this.save();
    return true;
  }

  private load(): SubscriptionAccountStoreData {
    if (!existsSync(this.storePath)) {
      return { version: 1, accounts: {} };
    }

    try {
      const content = readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(content) as SerializedSubscriptionAccountStoreData;
      return {
        version: parsed.version ?? 1,
        accounts: Object.fromEntries(
          Object.entries(parsed.accounts ?? {}).map(([provider, account]) => [
            provider,
            {
              provider: account.provider,
              token: account.token,
              email: account.email,
              tokenCreatedAt: account.tokenCreatedAt ? new Date(account.tokenCreatedAt) : undefined
            }
          ])
        )
      };
    } catch {
      return { version: 1, accounts: {} };
    }
  }

  private save(): void {
    const serialized: SerializedSubscriptionAccountStoreData = {
      version: this.data.version,
      accounts: Object.fromEntries(
        Object.entries(this.data.accounts).map(([provider, account]) => [
          provider,
          {
            provider: account?.provider ?? (provider as SubscriptionProvider),
            token: account?.token,
            email: account?.email,
            tokenCreatedAt: account?.tokenCreatedAt?.toISOString()
          }
        ])
      )
    };

    writeFileSync(this.storePath, JSON.stringify(serialized, null, 2));
  }
}

let subscriptionAccountManager: SubscriptionAccountManager | null = null;

export function getSubscriptionAccountManager(): SubscriptionAccountManager {
  if (!subscriptionAccountManager) {
    subscriptionAccountManager = new SubscriptionAccountManager();
  }
  return subscriptionAccountManager;
}
