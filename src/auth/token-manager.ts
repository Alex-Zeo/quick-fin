/**
 * OAuth token lifecycle manager.
 *
 * - Coalescing promise pattern: only one refresh in-flight per realmId
 * - Write-ahead: persists new tokens BEFORE returning them to callers
 * - Proactive refresh when token has < 5 minutes remaining
 */

import type { TokenPair } from './token-store.js';
import { TokenStore } from './token-store.js';
import { OAuthFlow } from './oauth-flow.js';
import type { Config } from '../config/schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenStatus {
  realmId: string;
  hasTokens: boolean;
  accessTokenExpiresAt: number | null;
  refreshTokenExpiresAt: number | null;
  accessTokenExpired: boolean;
  refreshTokenExpired: boolean;
  accessTokenExpiresInMs: number | null;
  refreshTokenExpiresInMs: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Proactively refresh when access token has less than this remaining. */
const PROACTIVE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class TokenManager {
  private readonly store: TokenStore;
  private readonly oauthFlow: OAuthFlow;

  /**
   * In-flight refresh promises keyed by realmId.
   * Ensures only one refresh call per realm at a time (coalescing).
   */
  private readonly inflightRefreshes = new Map<string, Promise<TokenPair>>();

  constructor(config: Config) {
    const passphrase = config.security.tokenEncryptionKey ?? 'dev-only-key';
    this.store = new TokenStore('./data/tokens', passphrase);
    this.oauthFlow = new OAuthFlow(config);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Get a valid access token for the given realm.
   *
   * If the stored token is expired or about to expire, it will be refreshed
   * automatically. Concurrent callers for the same realmId share the same
   * refresh promise (coalescing).
   */
  async getAccessToken(realmId: string): Promise<string> {
    const stored = this.store.load(realmId);

    if (!stored) {
      throw new Error(
        `No tokens stored for realmId "${realmId}". Run the OAuth flow first.`,
      );
    }

    const now = Date.now();

    // If access token is still valid and not near expiry, return it
    if (stored.expiresAt - now > PROACTIVE_REFRESH_MS) {
      return stored.accessToken;
    }

    // Need to refresh — check if refresh token is still valid
    if (stored.refreshExpiresAt <= now) {
      // Delete stale tokens and force re-auth
      this.store.delete(realmId);
      throw new Error(
        `Refresh token expired for realmId "${realmId}". Re-authorization required.`,
      );
    }

    // Refresh with coalescing
    const refreshed = await this.coalescingRefresh(realmId, stored.refreshToken);
    return refreshed.accessToken;
  }

  /**
   * Store tokens received from the initial OAuth code exchange.
   * Write-ahead: persists before returning.
   */
  async storeTokens(realmId: string, tokens: TokenPair): Promise<void> {
    this.store.save(realmId, tokens);
  }

  /**
   * Revoke and delete tokens for a realm.
   */
  async revokeTokens(realmId: string): Promise<void> {
    const stored = this.store.load(realmId);

    if (stored) {
      // Best-effort revocation at Intuit (don't throw if it fails)
      try {
        await this.oauthFlow.revokeToken(stored.refreshToken);
      } catch {
        // Revocation failure is non-fatal; we still delete locally
      }
      this.store.delete(realmId);
    }
  }

  /**
   * Get status information about stored tokens for a realm.
   */
  getTokenStatus(realmId: string): TokenStatus {
    const stored = this.store.load(realmId);
    const now = Date.now();

    if (!stored) {
      return {
        realmId,
        hasTokens: false,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        accessTokenExpired: true,
        refreshTokenExpired: true,
        accessTokenExpiresInMs: null,
        refreshTokenExpiresInMs: null,
      };
    }

    return {
      realmId,
      hasTokens: true,
      accessTokenExpiresAt: stored.expiresAt,
      refreshTokenExpiresAt: stored.refreshExpiresAt,
      accessTokenExpired: stored.expiresAt <= now,
      refreshTokenExpired: stored.refreshExpiresAt <= now,
      accessTokenExpiresInMs: Math.max(0, stored.expiresAt - now),
      refreshTokenExpiresInMs: Math.max(0, stored.refreshExpiresAt - now),
    };
  }

  /**
   * List all realms that have stored tokens.
   */
  listRealms(): string[] {
    return this.store.list();
  }

  // ── Coalescing refresh ──────────────────────────────────────────────────

  /**
   * Perform a token refresh, coalescing concurrent requests for the same realm.
   */
  private coalescingRefresh(realmId: string, refreshToken: string): Promise<TokenPair> {
    const existing = this.inflightRefreshes.get(realmId);
    if (existing) return existing;

    const promise = this.doRefresh(realmId, refreshToken).finally(() => {
      this.inflightRefreshes.delete(realmId);
    });

    this.inflightRefreshes.set(realmId, promise);
    return promise;
  }

  /**
   * Execute the actual token refresh.
   * Write-ahead: new tokens are persisted BEFORE the promise resolves.
   */
  private async doRefresh(realmId: string, refreshToken: string): Promise<TokenPair> {
    const newTokens = await this.oauthFlow.refreshTokens(refreshToken, realmId);

    // Write-ahead: persist before returning to any caller
    this.store.save(realmId, newTokens);

    return newTokens;
  }
}
