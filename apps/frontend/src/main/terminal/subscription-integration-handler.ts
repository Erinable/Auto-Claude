/**
 * Subscription Integration Handler
 * Manages subscription token detection and provider-specific persistence
 */

import { IPC_CHANNELS } from '../../shared/constants';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { getSubscriptionAccountManager } from '../subscription-account-manager';
import * as OutputParser from './output-parser';
import type { SubscriptionProvider } from './subscription-providers';
import { isSubscriptionProvider } from './subscription-providers';
import type { TerminalProcess, WindowGetter, SubscriptionTokenEvent } from './types';

function getProviderFromTerminalId(terminalId: string): SubscriptionProvider | null {
  if (terminalId.startsWith('claude-login-')) {
    return 'claude';
  }

  const match = terminalId.match(/subscription-login-([a-zA-Z0-9_-]+)-/);
  if (match?.[1] && isSubscriptionProvider(match[1]) && match[1] !== 'claude') {
    return match[1];
  }

  return null;
}

function sendSubscriptionTokenEvent(
  getWindow: WindowGetter,
  event: SubscriptionTokenEvent
): void {
  const win = getWindow();
  if (win) {
    win.webContents.send(IPC_CHANNELS.TERMINAL_SUBSCRIPTION_TOKEN, event);
  }
}

function sendClaudeOAuthEvent(
  getWindow: WindowGetter,
  event: Omit<SubscriptionTokenEvent, 'provider'> & { profileId?: string }
): void {
  const win = getWindow();
  if (win) {
    win.webContents.send(IPC_CHANNELS.TERMINAL_OAUTH_TOKEN, {
      terminalId: event.terminalId,
      profileId: event.profileId,
      email: event.email,
      success: event.success,
      message: event.message,
      detectedAt: event.detectedAt
    });
  }
}

/**
 * Handle subscription token detection and auto-save
 */
export function handleSubscriptionToken(
  terminal: TerminalProcess,
  data: string,
  getWindow: WindowGetter
): void {
  const tokenMatch = OutputParser.extractSubscriptionToken(data);
  if (!tokenMatch) {
    return;
  }

  const fallbackProvider = getProviderFromTerminalId(terminal.id);
  const provider = tokenMatch.provider ?? fallbackProvider;
  if (!provider) {
    return;
  }

  const email = OutputParser.extractEmail(terminal.outputBuffer);
  const detectedAt = new Date().toISOString();

  if (provider === 'claude') {
    const profileIdMatch = terminal.id.match(/claude-login-(profile-\d+|default)-/);

    if (profileIdMatch) {
      const profileId = profileIdMatch[1];
      const profileManager = getClaudeProfileManager();
      const success = profileManager.setProfileToken(profileId, tokenMatch.token, email || undefined);

      sendSubscriptionTokenEvent(getWindow, {
        terminalId: terminal.id,
        provider,
        profileId,
        email,
        success,
        detectedAt,
        message: success ? undefined : 'Failed to save token to profile'
      });

      if (success) {
        sendClaudeOAuthEvent(getWindow, {
          terminalId: terminal.id,
          profileId,
          email,
          success,
          detectedAt
        });
      } else {
        sendClaudeOAuthEvent(getWindow, {
          terminalId: terminal.id,
          profileId,
          email,
          success,
          detectedAt,
          message: 'Failed to save token to profile'
        });
      }
      return;
    }

    const profileManager = getClaudeProfileManager();
    const activeProfile = profileManager.getActiveProfile();

    if (!activeProfile) {
      sendSubscriptionTokenEvent(getWindow, {
        terminalId: terminal.id,
        provider,
        email,
        success: false,
        detectedAt,
        message: 'No active profile found'
      });

      sendClaudeOAuthEvent(getWindow, {
        terminalId: terminal.id,
        profileId: undefined,
        email,
        success: false,
        detectedAt,
        message: 'No active profile found'
      });
      return;
    }

    const success = profileManager.setProfileToken(activeProfile.id, tokenMatch.token, email || undefined);

    sendSubscriptionTokenEvent(getWindow, {
      terminalId: terminal.id,
      provider,
      profileId: activeProfile.id,
      email,
      success,
      detectedAt,
      message: success ? undefined : 'Failed to save token to active profile'
    });

    sendClaudeOAuthEvent(getWindow, {
      terminalId: terminal.id,
      profileId: activeProfile.id,
      email,
      success,
      detectedAt,
      message: success ? undefined : 'Failed to save token to active profile'
    });

    return;
  }

  const accountManager = getSubscriptionAccountManager();
  const success = accountManager.setProviderToken(provider, tokenMatch.token, email || undefined);

  sendSubscriptionTokenEvent(getWindow, {
    terminalId: terminal.id,
    provider,
    email,
    success,
    detectedAt,
    message: success ? undefined : 'Failed to save provider token'
  });
}
