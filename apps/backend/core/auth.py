"""
Authentication helpers for Auto Claude.

Provides centralized authentication token resolution with fallback support
for multiple environment variables, and SDK environment variable passthrough
for custom API endpoints.
"""

import json
import os
import platform
import subprocess

# Priority order for auth token resolution per provider.
# NOTE: We intentionally do NOT fall back to ANTHROPIC_API_KEY.
# Auto Claude is designed to use Claude Code OAuth tokens only.
# This prevents silent billing to user's API credits when OAuth fails.
SUPPORTED_PROVIDERS = ("claude", "codex", "antigravity")
DEFAULT_PROVIDER = "claude"
PROVIDER_ENV_VAR = "AUTO_CLAUDE_PROVIDER"


def _is_valid_token(token: str, *, min_length: int = 16) -> bool:
    return bool(token) and len(token) >= min_length and not any(
        char.isspace() for char in token
    )


def _is_valid_claude_oauth_token(token: str) -> bool:
    return _is_valid_token(token, min_length=20) and token.startswith("sk-ant-oat01-")


def _is_valid_anthropic_auth_token(token: str) -> bool:
    return _is_valid_token(token, min_length=12) and (
        token.startswith("sk-ant-") or token.startswith("sk-zcf-")
    )


def _is_valid_codex_token(token: str) -> bool:
    return _is_valid_token(token, min_length=20)


def _is_valid_antigravity_token(token: str) -> bool:
    return _is_valid_token(token, min_length=20)


AUTH_TOKEN_ENV_VARS: dict[str, list[tuple[str, callable, str]]] = {
    "claude": [
        (
            "CLAUDE_CODE_OAUTH_TOKEN",
            _is_valid_claude_oauth_token,
            "Claude Code OAuth token (sk-ant-oat01-...)",
        ),
        (
            "ANTHROPIC_AUTH_TOKEN",
            _is_valid_anthropic_auth_token,
            "Anthropic auth token (sk-ant-... or sk-zcf-...)",
        ),
    ],
    "codex": [
        ("CODEX_API_KEY", _is_valid_codex_token, "Codex API key"),
        ("CODEX_AUTH_TOKEN", _is_valid_codex_token, "Codex auth token"),
    ],
    "antigravity": [
        ("ANTIGRAVITY_API_KEY", _is_valid_antigravity_token, "Antigravity API key"),
        (
            "ANTIGRAVITY_AUTH_TOKEN",
            _is_valid_antigravity_token,
            "Antigravity auth token",
        ),
    ],
}

# Environment variables to pass through to SDK subprocess
# NOTE: ANTHROPIC_API_KEY is intentionally excluded to prevent silent API billing
SDK_ENV_VARS = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "NO_PROXY",
    "DISABLE_TELEMETRY",
    "DISABLE_COST_WARNINGS",
    "API_TIMEOUT_MS",
]

PROVIDER_BASE_URL_ENV = {
    "claude": "ANTHROPIC_BASE_URL",
    "codex": "CODEX_BASE_URL",
    "antigravity": "ANTIGRAVITY_BASE_URL",
}


def get_ai_provider(provider: str | None = None) -> str:
    """
    Resolve the configured AI provider.

    Defaults to "claude" unless AUTO_CLAUDE_PROVIDER is set.
    """
    raw_provider = (provider or os.environ.get(PROVIDER_ENV_VAR, "")).strip().lower()
    resolved = raw_provider or DEFAULT_PROVIDER
    if resolved not in SUPPORTED_PROVIDERS:
        raise ValueError(
            f"Unsupported provider '{resolved}'. "
            f"Supported values: {', '.join(SUPPORTED_PROVIDERS)}"
        )
    return resolved


def get_provider_base_url_env(provider: str | None = None) -> str | None:
    resolved_provider = get_ai_provider(provider)
    return PROVIDER_BASE_URL_ENV.get(resolved_provider)


def get_token_from_keychain() -> str | None:
    """
    Get authentication token from system credential store.

    Reads Claude Code credentials from:
    - macOS: Keychain
    - Windows: Credential Manager
    - Linux: Not yet supported (use env var)

    Returns:
        Token string if found, None otherwise
    """
    system = platform.system()

    if system == "Darwin":
        return _get_token_from_macos_keychain()
    elif system == "Windows":
        return _get_token_from_windows_credential_files()
    else:
        # Linux: secret-service not yet implemented
        return None


def _get_token_from_macos_keychain() -> str | None:
    """Get token from macOS Keychain."""
    try:
        result = subprocess.run(
            [
                "/usr/bin/security",
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode != 0:
            return None

        credentials_json = result.stdout.strip()
        if not credentials_json:
            return None

        data = json.loads(credentials_json)
        token = data.get("claudeAiOauth", {}).get("accessToken")

        if not token:
            return None

        # Validate token format (Claude OAuth tokens start with sk-ant-oat01-)
        if not token.startswith("sk-ant-oat01-"):
            return None

        return token

    except (subprocess.TimeoutExpired, json.JSONDecodeError, KeyError, Exception):
        return None


def _get_token_from_windows_credential_files() -> str | None:
    """Get token from Windows credential files.

    Claude Code on Windows stores credentials in ~/.claude/.credentials.json
    """
    try:
        # Claude Code stores credentials in ~/.claude/.credentials.json
        cred_paths = [
            os.path.expandvars(r"%USERPROFILE%\.claude\.credentials.json"),
            os.path.expandvars(r"%USERPROFILE%\.claude\credentials.json"),
            os.path.expandvars(r"%LOCALAPPDATA%\Claude\credentials.json"),
            os.path.expandvars(r"%APPDATA%\Claude\credentials.json"),
        ]

        for cred_path in cred_paths:
            if os.path.exists(cred_path):
                with open(cred_path, encoding="utf-8") as f:
                    data = json.load(f)
                    token = data.get("claudeAiOauth", {}).get("accessToken")
                    if token and token.startswith("sk-ant-oat01-"):
                        return token

        return None

    except (json.JSONDecodeError, KeyError, FileNotFoundError, Exception):
        return None


def _get_env_token_details(
    provider: str,
) -> tuple[str | None, str | None, str | None]:
    invalid_vars: list[tuple[str, str]] = []
    for var, validator, description in AUTH_TOKEN_ENV_VARS[provider]:
        token = os.environ.get(var)
        if not token:
            continue
        if validator(token):
            return token, var, None
        invalid_vars.append((var, description))

    if invalid_vars:
        var, description = invalid_vars[0]
        return None, var, f"{var} does not look like a valid {description}."
    return None, None, None


def get_auth_token(provider: str | None = None) -> str | None:
    """
    Get authentication token from environment variables or system credential store.

    Checks multiple sources in priority order for the selected provider.

    NOTE: ANTHROPIC_API_KEY is intentionally NOT supported to prevent
    silent billing to user's API credits when OAuth is misconfigured.

    Returns:
        Token string if found, None otherwise
    """
    resolved_provider = get_ai_provider(provider)

    # First check environment variables
    token, _, _ = _get_env_token_details(resolved_provider)
    if token:
        return token

    # Fallback to system credential store
    if resolved_provider == "claude":
        return get_token_from_keychain()

    return None


def get_auth_token_source(provider: str | None = None) -> str | None:
    """Get the name of the source that provided the auth token."""
    resolved_provider = get_ai_provider(provider)

    # Check environment variables first
    token, source, _ = _get_env_token_details(resolved_provider)
    if token and source:
        return source

    # Check if token came from system credential store
    if resolved_provider == "claude" and get_token_from_keychain():
        system = platform.system()
        if system == "Darwin":
            return "macOS Keychain"
        elif system == "Windows":
            return "Windows Credential Files"
        else:
            return "System Credential Store"

    return None


def require_auth_token(provider: str | None = None) -> str:
    """
    Get authentication token or raise ValueError.

    Raises:
        ValueError: If no auth token is found in any supported source
    """
    resolved_provider = get_ai_provider(provider)
    token, _, invalid_reason = _get_env_token_details(resolved_provider)
    if token is None and resolved_provider == "claude":
        token = get_token_from_keychain()
    if invalid_reason and not token:
        raise ValueError(invalid_reason)
    if not token:
        error_msg = (
            "No auth token found.\n\n"
            "Auto Claude requires provider authentication.\n"
            "Direct API keys (ANTHROPIC_API_KEY) are not supported.\n\n"
        )

        if resolved_provider == "claude":
            # Provide platform-specific guidance
            system = platform.system()
            if system == "Darwin":
                error_msg += (
                    "To authenticate:\n"
                    "  1. Run: claude setup-token\n"
                    "  2. The token will be saved to macOS Keychain automatically\n\n"
                    "Or set CLAUDE_CODE_OAUTH_TOKEN in your .env file."
                )
            elif system == "Windows":
                error_msg += (
                    "To authenticate:\n"
                    "  1. Run: claude setup-token\n"
                    "  2. The token should be saved to Windows Credential Manager\n\n"
                    "If auto-detection fails, set CLAUDE_CODE_OAUTH_TOKEN in your .env file.\n"
                    "Check: %LOCALAPPDATA%\\Claude\\credentials.json"
                )
            else:
                error_msg += (
                    "To authenticate:\n"
                    "  1. Run: claude setup-token\n"
                    "  2. Set CLAUDE_CODE_OAUTH_TOKEN in your .env file"
                )
        elif resolved_provider == "codex":
            error_msg += (
                "To authenticate:\n"
                "  1. Set CODEX_API_KEY in your .env file\n"
                "  2. (Optional) Use CODEX_AUTH_TOKEN as a fallback"
            )
        else:
            error_msg += (
                "To authenticate:\n"
                "  1. Set ANTIGRAVITY_API_KEY in your .env file\n"
                "  2. (Optional) Use ANTIGRAVITY_AUTH_TOKEN as a fallback"
            )
        raise ValueError(error_msg)
    return token


def get_sdk_env_vars() -> dict[str, str]:
    """
    Get environment variables to pass to SDK.

    Collects relevant env vars (ANTHROPIC_BASE_URL, etc.) that should
    be passed through to the claude-agent-sdk subprocess.

    Returns:
        Dict of env var name -> value for non-empty vars
    """
    env = {}
    for var in SDK_ENV_VARS:
        value = os.environ.get(var)
        if value:
            env[var] = value
    return env


def ensure_claude_code_oauth_token() -> None:
    """
    Ensure CLAUDE_CODE_OAUTH_TOKEN is set (for SDK compatibility).

    If not set but other auth tokens are available, copies the value
    to CLAUDE_CODE_OAUTH_TOKEN so the underlying SDK can use it.
    """
    if get_ai_provider() != "claude":
        return

    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return

    token = get_auth_token(provider="claude")
    if token:
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token
