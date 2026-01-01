import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Key,
  Eye,
  EyeOff,
  Info,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Star,
  Check,
  Pencil,
  X,
  LogIn,
  ChevronDown,
  ChevronRight,
  Users,
  Lock
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';
import { loadClaudeProfiles as loadGlobalClaudeProfiles } from '../../stores/claude-profile-store';
import { useAppSettings } from '../../hooks/useIpc';
import type { ClaudeProfile, SubscriptionAccount, SubscriptionProvider } from '../../../shared/types';

interface OAuthStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * OAuth step component for the onboarding wizard.
 * Guides users through Claude profile management and OAuth authentication,
 * reusing patterns from IntegrationSettings.tsx.
 */
export function OAuthStep({ onNext, onBack, onSkip }: OAuthStepProps) {
  const { t } = useTranslation('onboarding');
  const { getSettings, saveSettings } = useAppSettings();
  const providerOptions: SubscriptionProvider[] = ['claude', 'codex', 'antigravity'];

  // Claude Profiles state
  const [claudeProfiles, setClaudeProfiles] = useState<ClaudeProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileProvider, setNewProfileProvider] = useState<SubscriptionProvider>('claude');
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingProfileName, setEditingProfileName] = useState('');
  const [editingProfileProvider, setEditingProfileProvider] = useState<SubscriptionProvider | null>(null);
  const [authenticatingProfileId, setAuthenticatingProfileId] = useState<string | null>(null);
  const [subscriptionAccounts, setSubscriptionAccounts] = useState<SubscriptionAccount[]>([]);
  const [activeSubscriptionAccountIds, setActiveSubscriptionAccountIds] = useState<
    Partial<Record<SubscriptionProvider, string>>
  >({});

  // Manual token entry state
  const [expandedTokenProfileId, setExpandedTokenProfileId] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [manualTokenEmail, setManualTokenEmail] = useState('');
  const [showManualToken, setShowManualToken] = useState(false);
  const [savingTokenProfileId, setSavingTokenProfileId] = useState<string | null>(null);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Derived state: check if at least one profile is authenticated
  const hasAuthenticatedProfile = claudeProfiles.some(
    (profile) => profile.oauthToken || (profile.isDefault && profile.configDir)
  ) || subscriptionAccounts.some((account) => Boolean(account.token));

  // Reusable function to load Claude profiles
  const loadClaudeProfiles = async () => {
    setIsLoadingProfiles(true);
    setError(null);
    try {
      const result = await window.electronAPI.getClaudeProfiles();
      if (result.success && result.data) {
        setClaudeProfiles(result.data.profiles);
        setActiveProfileId(result.data.activeProfileId);
        // Also update the global store
        await loadGlobalClaudeProfiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setIsLoadingProfiles(false);
    }
  };

  const loadSubscriptionAccounts = async () => {
    try {
      const settings = await getSettings();
      if (settings) {
        setSubscriptionAccounts(settings.subscriptionAccounts ?? []);
        setActiveSubscriptionAccountIds(settings.activeSubscriptionAccountIds ?? {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscription accounts');
    }
  };

  const updateSubscriptionSettings = async (
    accounts: SubscriptionAccount[],
    activeIds = activeSubscriptionAccountIds
  ) => {
    setSubscriptionAccounts(accounts);
    setActiveSubscriptionAccountIds(activeIds);
    await saveSettings({ subscriptionAccounts: accounts, activeSubscriptionAccountIds: activeIds });
  };

  // Load Claude profiles on mount
  useEffect(() => {
    loadClaudeProfiles();
    loadSubscriptionAccounts();
  }, []);

  // Listen for OAuth authentication completion
  useEffect(() => {
    const unsubscribe = window.electronAPI.onTerminalOAuthToken(async (info) => {
      if (info.success && info.profileId) {
        // Reload profiles to show updated state
        await loadClaudeProfiles();
        // Show simple success notification
        alert(`✅ Profile authenticated successfully!\n\n${info.email ? `Account: ${info.email}` : 'Authentication complete.'}\n\nYou can now use this profile.`);
      }
    });

    return unsubscribe;
  }, []);

  const getProviderLabel = (provider: SubscriptionProvider) =>
    t(`oauth.providers.${provider}.label`);

  const getProviderTokenHint = (provider: SubscriptionProvider) =>
    t(`oauth.providers.${provider}.tokenHint`);

  const getProviderTokenPlaceholder = (provider: SubscriptionProvider) =>
    t(`oauth.providers.${provider}.tokenPlaceholder`);

  // Profile management handlers - following patterns from IntegrationSettings.tsx
  const handleAddProfile = async () => {
    if (!newProfileName.trim()) return;

    if (newProfileProvider !== 'claude') {
      const profileName = newProfileName.trim();
      if (!profileName) {
        setError(t('oauth.errors.invalidAccountName'));
        return;
      }
      const newAccount: SubscriptionAccount = {
        id: `account-${Date.now()}`,
        name: profileName,
        provider: newProfileProvider,
        createdAt: new Date()
      };
      await updateSubscriptionSettings([...subscriptionAccounts, newAccount]);
      setNewProfileName('');
      return;
    }

    setIsAddingProfile(true);
    setError(null);
    try {
      const profileName = newProfileName.trim();
      // Sanitize slug: only allow alphanumeric and dashes, remove leading/trailing dashes
      const profileSlug = profileName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      // Validate that sanitized slug is not empty (e.g., "!!!" becomes "")
      if (!profileSlug) {
        setError(t('oauth.errors.invalidAccountName'));
        setIsAddingProfile(false);
        return;
      }

      const result = await window.electronAPI.saveClaudeProfile({
        id: `profile-${Date.now()}`,
        name: profileName,
        configDir: `~/.claude-profiles/${profileSlug}`,
        isDefault: false,
        createdAt: new Date()
      });

      if (result.success && result.data) {
        // Initialize the profile (starts OAuth flow)
        const initResult = await window.electronAPI.initializeClaudeProfile(result.data.id);

        if (initResult.success) {
          await loadClaudeProfiles();
          setNewProfileName('');

          alert(
            `Authenticating "${profileName}"...\n\n` +
            `A browser window will open for you to log in with your Claude account.\n\n` +
            `The authentication will be saved automatically once complete.`
          );
        } else {
          await loadClaudeProfiles();
          alert(`Failed to start authentication: ${initResult.error || 'Please try again.'}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add profile');
      alert('Failed to add profile. Please try again.');
    } finally {
      setIsAddingProfile(false);
    }
  };

  const handleDeleteProfile = async (profileId: string, provider: SubscriptionProvider) => {
    setDeletingProfileId(profileId);
    setError(null);
    if (provider !== 'claude') {
      const nextAccounts = subscriptionAccounts.filter((account) => account.id !== profileId);
      const nextActiveIds = { ...activeSubscriptionAccountIds };
      if (nextActiveIds[provider] === profileId) {
        delete nextActiveIds[provider];
      }
      await updateSubscriptionSettings(nextAccounts, nextActiveIds);
      setDeletingProfileId(null);
      return;
    }
    try {
      const result = await window.electronAPI.deleteClaudeProfile(profileId);
      if (result.success) {
        await loadClaudeProfiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete profile');
    } finally {
      setDeletingProfileId(null);
    }
  };

  const startEditingProfile = (profile: ClaudeProfile) => {
    setEditingProfileId(profile.id);
    setEditingProfileName(profile.name);
    setEditingProfileProvider('claude');
  };

  const startEditingSubscriptionAccount = (account: SubscriptionAccount) => {
    setEditingProfileId(account.id);
    setEditingProfileName(account.name);
    setEditingProfileProvider(account.provider);
  };

  const cancelEditingProfile = () => {
    setEditingProfileId(null);
    setEditingProfileName('');
    setEditingProfileProvider(null);
  };

  const handleRenameProfile = async () => {
    if (!editingProfileId || !editingProfileName.trim()) return;

    setError(null);
    if (editingProfileProvider && editingProfileProvider !== 'claude') {
      const nextAccounts = subscriptionAccounts.map((account) =>
        account.id === editingProfileId
          ? { ...account, name: editingProfileName.trim() }
          : account
      );
      await updateSubscriptionSettings(nextAccounts);
      setEditingProfileId(null);
      setEditingProfileName('');
      setEditingProfileProvider(null);
      return;
    }

    try {
      const result = await window.electronAPI.renameClaudeProfile(editingProfileId, editingProfileName.trim());
      if (result.success) {
        await loadClaudeProfiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename profile');
    } finally {
      setEditingProfileId(null);
      setEditingProfileName('');
      setEditingProfileProvider(null);
    }
  };

  const handleSetActiveProfile = async (profileId: string, provider: SubscriptionProvider) => {
    setError(null);
    if (provider !== 'claude') {
      const nextActiveIds = { ...activeSubscriptionAccountIds, [provider]: profileId };
      await updateSubscriptionSettings(subscriptionAccounts, nextActiveIds);
      return;
    }
    try {
      const result = await window.electronAPI.setActiveClaudeProfile(profileId);
      if (result.success) {
        setActiveProfileId(profileId);
        await loadGlobalClaudeProfiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set active profile');
    }
  };

  const handleAuthenticateProfile = async (profileId: string, provider: SubscriptionProvider) => {
    if (provider !== 'claude') {
      toggleTokenEntry(profileId);
      return;
    }

    setAuthenticatingProfileId(profileId);
    setError(null);
    try {
      const initResult = await window.electronAPI.initializeClaudeProfile(profileId);
      if (initResult.success) {
        alert(
          `Authenticating profile...\n\n` +
          `A browser window will open for you to log in with your Claude account.\n\n` +
          `The authentication will be saved automatically once complete.`
        );
      } else {
        alert(`Failed to start authentication: ${initResult.error || 'Please try again.'}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate profile');
      alert('Failed to start authentication. Please try again.');
    } finally {
      setAuthenticatingProfileId(null);
    }
  };

  const toggleTokenEntry = (profileId: string) => {
    if (expandedTokenProfileId === profileId) {
      setExpandedTokenProfileId(null);
      setManualToken('');
      setManualTokenEmail('');
      setShowManualToken(false);
    } else {
      setExpandedTokenProfileId(profileId);
      setManualToken('');
      setManualTokenEmail('');
      setShowManualToken(false);
    }
  };

  const handleSaveManualToken = async (profileId: string, provider: SubscriptionProvider) => {
    if (!manualToken.trim()) {
      setError(t('oauth.errors.tokenRequired', { provider: getProviderLabel(provider) }));
      return;
    }

    setSavingTokenProfileId(profileId);
    setError(null);
    if (provider !== 'claude') {
      const nextAccounts = subscriptionAccounts.map((account) =>
        account.id === profileId
          ? {
            ...account,
            token: manualToken.trim(),
            email: manualTokenEmail.trim() || undefined,
            tokenCreatedAt: new Date()
          }
          : account
      );
      await updateSubscriptionSettings(nextAccounts);
      setExpandedTokenProfileId(null);
      setManualToken('');
      setManualTokenEmail('');
      setShowManualToken(false);
      setSavingTokenProfileId(null);
      return;
    }

    try {
      const result = await window.electronAPI.setClaudeProfileToken(
        profileId,
        manualToken.trim(),
        manualTokenEmail.trim() || undefined
      );
      if (result.success) {
        await loadClaudeProfiles();
        setExpandedTokenProfileId(null);
        setManualToken('');
        setManualTokenEmail('');
        setShowManualToken(false);
      } else {
        alert(`Failed to save token: ${result.error || 'Please try again.'}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save token');
      alert('Failed to save token. Please try again.');
    } finally {
      setSavingTokenProfileId(null);
    }
  };

  type AccountEntry = {
    id: string;
    name: string;
    email?: string;
    provider: SubscriptionProvider;
    type: 'claude' | 'subscription';
    isDefault: boolean;
    isActive: boolean;
    isAuthenticated: boolean;
    profile?: ClaudeProfile;
    account?: SubscriptionAccount;
  };

  const accountEntries: AccountEntry[] = [
    ...claudeProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      provider: 'claude' as const,
      type: 'claude' as const,
      isDefault: profile.isDefault,
      isActive: profile.id === activeProfileId,
      isAuthenticated: Boolean(profile.oauthToken || (profile.isDefault && profile.configDir)),
      profile
    })),
    ...subscriptionAccounts
      .filter((account) => account.provider !== 'claude')
      .map((account) => ({
        id: account.id,
        name: account.name,
        email: account.email,
        provider: account.provider,
        type: 'subscription' as const,
        isDefault: false,
        isActive: activeSubscriptionAccountIds[account.provider] === account.id,
        isAuthenticated: Boolean(account.token),
        account
      }))
  ];

  const handleContinue = () => {
    onNext();
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            {t('oauth.title')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t('oauth.description')}
          </p>
        </div>

        {/* Loading state */}
        {isLoadingProfiles && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Profile management UI - placeholder for subtask-1-4 */}
        {!isLoadingProfiles && (
          <div className="space-y-6">
            {/* Error banner */}
            {error && (
              <Card className="border border-destructive/30 bg-destructive/10">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Info card */}
            <Card className="border border-info/30 bg-info/10">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">
                      {t('oauth.multiAccountHint')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Keychain explanation - macOS only */}
            {navigator.platform.toLowerCase().includes('mac') && (
              <Card className="border border-border bg-muted/30">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground mb-1">
                        {t('oauth.keychainTitle')}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t('oauth.keychainDescription')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Profile list */}
            <div className="rounded-lg bg-muted/30 border border-border p-4">
              {accountEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center mb-4">
                  <p className="text-sm text-muted-foreground">{t('oauth.noAccountsYet')}</p>
                </div>
              ) : (
                <div className="space-y-2 mb-4">
                  {accountEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        "rounded-lg border transition-colors",
                        entry.isActive
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background"
                      )}
                    >
                      <div className={cn(
                        "flex items-center justify-between p-3",
                        expandedTokenProfileId !== entry.id && "hover:bg-muted/50"
                      )}>
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0",
                            entry.isActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}>
                            {(editingProfileId === entry.id ? editingProfileName : entry.name).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            {editingProfileId === entry.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  value={editingProfileName}
                                  onChange={(e) => setEditingProfileName(e.target.value)}
                                  className="h-7 text-sm w-40"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameProfile();
                                    if (e.key === 'Escape') cancelEditingProfile();
                                  }}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={handleRenameProfile}
                                  className="h-7 w-7 text-success hover:text-success hover:bg-success/10"
                                >
                                  <Check className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={cancelEditingProfile}
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-foreground">{entry.name}</span>
                                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                    {getProviderLabel(entry.provider)}
                                  </span>
                                  {entry.isDefault && (
                                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{t('oauth.default')}</span>
                                  )}
                                  {entry.isActive && (
                                    <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded flex items-center gap-1">
                                      <Star className="h-3 w-3" />
                                      {t('oauth.active')}
                                    </span>
                                  )}
                                  {entry.isAuthenticated ? (
                                    <span className="text-xs bg-success/20 text-success px-1.5 py-0.5 rounded flex items-center gap-1">
                                      <Check className="h-3 w-3" />
                                      {t('oauth.authenticated')}
                                    </span>
                                  ) : (
                                    <span className="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                                      {t('oauth.needsAuth')}
                                    </span>
                                  )}
                                </div>
                                {entry.email && (
                                  <span className="text-xs text-muted-foreground">{entry.email}</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {editingProfileId !== entry.id && (
                          <div className="flex items-center gap-1">
                            {!entry.isAuthenticated ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAuthenticateProfile(entry.id, entry.provider)}
                                disabled={authenticatingProfileId === entry.id}
                                className="gap-1 h-7 text-xs"
                              >
                                {authenticatingProfileId === entry.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <LogIn className="h-3 w-3" />
                                )}
                                {t('oauth.authenticate')}
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleAuthenticateProfile(entry.id, entry.provider)}
                                disabled={authenticatingProfileId === entry.id}
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title={t('oauth.reauthenticate')}
                              >
                                {authenticatingProfileId === entry.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <LogIn className="h-3 w-3" />
                                )}
                              </Button>
                            )}
                            {!entry.isActive && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSetActiveProfile(entry.id, entry.provider)}
                                className="gap-1 h-7 text-xs"
                              >
                                <Check className="h-3 w-3" />
                                {t('oauth.setActive')}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleTokenEntry(entry.id)}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title={expandedTokenProfileId === entry.id ? t('oauth.hideTokenEntry') : t('oauth.showTokenEntry')}
                            >
                              {expandedTokenProfileId === entry.id ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (entry.type === 'claude' && entry.profile) {
                                  startEditingProfile(entry.profile);
                                } else if (entry.account) {
                                  startEditingSubscriptionAccount(entry.account);
                                }
                              }}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title={t('oauth.renameAccount')}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            {!entry.isDefault && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteProfile(entry.id, entry.provider)}
                                disabled={deletingProfileId === entry.id}
                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                title={t('oauth.deleteAccount')}
                              >
                                {deletingProfileId === entry.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {expandedTokenProfileId === entry.id && (
                        <div className="px-3 pb-3 pt-0 border-t border-border/50 mt-0">
                          <div className="bg-muted/30 rounded-lg p-3 mt-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-medium text-muted-foreground">
                                {t('oauth.manualTokenEntry')}
                              </Label>
                              <span className="text-xs text-muted-foreground">
                                {getProviderTokenHint(entry.provider)}
                              </span>
                            </div>

                            <div className="space-y-2">
                              <div className="relative">
                                <Input
                                  type={showManualToken ? 'text' : 'password'}
                                  placeholder={getProviderTokenPlaceholder(entry.provider)}
                                  value={manualToken}
                                  onChange={(e) => setManualToken(e.target.value)}
                                  className="pr-10 font-mono text-xs h-8"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowManualToken(!showManualToken)}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                  {showManualToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </button>
                              </div>

                              <Input
                                type="email"
                                placeholder={t('oauth.emailPlaceholder')}
                                value={manualTokenEmail}
                                onChange={(e) => setManualTokenEmail(e.target.value)}
                                className="text-xs h-8"
                              />
                            </div>

                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleTokenEntry(entry.id)}
                                className="h-7 text-xs"
                              >
                                {t('oauth.cancel')}
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleSaveManualToken(entry.id, entry.provider)}
                                disabled={!manualToken.trim() || savingTokenProfileId === entry.id}
                                className="h-7 text-xs gap-1"
                              >
                                {savingTokenProfileId === entry.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Check className="h-3 w-3" />
                                )}
                                {t('oauth.saveToken')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add new account input */}
              <div className="flex items-center gap-2">
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  value={newProfileProvider}
                  onChange={(e) => setNewProfileProvider(e.target.value as SubscriptionProvider)}
                  aria-label={t('oauth.provider')}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider} value={provider}>
                      {getProviderLabel(provider)}
                    </option>
                  ))}
                </select>
                <Input
                  placeholder={t('oauth.accountNamePlaceholder')}
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  className="flex-1 h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProfileName.trim()) {
                      handleAddProfile();
                    }
                  }}
                />
                <Button
                  onClick={handleAddProfile}
                  disabled={!newProfileName.trim() || isAddingProfile}
                  size="sm"
                  className="gap-1 shrink-0"
                >
                  {isAddingProfile ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  {t('oauth.add')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t(`oauth.providers.${newProfileProvider}.description`)}
              </p>
            </div>

            {/* Success state when profiles are authenticated */}
            {hasAuthenticatedProfile && (
              <Card className="border border-success/30 bg-success/10">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                    <p className="text-sm text-success">
                      {t('oauth.authenticatedHint')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center mt-10 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            Back
          </Button>
          <div className="flex gap-4">
            <Button
              variant="ghost"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground"
            >
              Skip
            </Button>
            <Button
              onClick={handleContinue}
              disabled={!hasAuthenticatedProfile}
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
