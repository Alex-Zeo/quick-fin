/**
 * OAuth 2.0 authorization code flow helpers for Intuit / QuickBooks Online.
 *
 * Builds auth URLs, exchanges codes, and refreshes tokens using undici
 * directly (not the main HTTP connection pool).
 */

import { request } from 'undici';
import type { Config } from '../config/schema.js';
import type { TokenPair } from './token-store.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTUIT_AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const INTUIT_REVOKE_ENDPOINT = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

const SCOPES = 'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment';

// ---------------------------------------------------------------------------
// Sandbox / production URL mapping
// ---------------------------------------------------------------------------

function authBaseUrl(env: 'sandbox' | 'production'): string {
  // Intuit uses the same auth URL for both environments
  return INTUIT_AUTH_BASE;
}

function tokenEndpoint(_env: 'sandbox' | 'production'): string {
  return INTUIT_TOKEN_ENDPOINT;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

interface IntuitTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;       // seconds
  x_refresh_token_expires_in: number; // seconds
  token_type: string;
}

function toTokenPair(body: IntuitTokenResponse, realmId: string): TokenPair {
  const now = Date.now();
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    realmId,
    expiresAt: now + body.expires_in * 1000,
    refreshExpiresAt: now + body.x_refresh_token_expires_in * 1000,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class OAuthFlow {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly environment: 'sandbox' | 'production';

  constructor(config: Config) {
    this.clientId = config.oauth.clientId;
    this.clientSecret = config.oauth.clientSecret;
    this.redirectUri = config.oauth.redirectUri;
    this.environment = config.oauth.environment;
  }

  /**
   * Build the Intuit authorization URL.
   * The user should be redirected here; upon consent they will be sent back
   * to `redirectUri` with `code` and `realmId` query params.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: SCOPES,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state,
    });
    return `${authBaseUrl(this.environment)}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for access + refresh tokens.
   */
  async exchangeCode(code: string, realmId: string): Promise<TokenPair> {
    const { statusCode, body } = await request(tokenEndpoint(this.environment), {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': basicAuthHeader(this.clientId, this.clientSecret),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }).toString(),
    });

    const json = (await body.json()) as IntuitTokenResponse;

    if (statusCode !== 200) {
      throw new Error(
        `Token exchange failed (HTTP ${statusCode}): ${JSON.stringify(json)}`,
      );
    }

    return toTokenPair(json, realmId);
  }

  /**
   * Refresh an expired access token using the refresh token.
   */
  async refreshTokens(refreshToken: string, realmId: string): Promise<TokenPair> {
    const { statusCode, body } = await request(tokenEndpoint(this.environment), {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': basicAuthHeader(this.clientId, this.clientSecret),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    const json = (await body.json()) as IntuitTokenResponse;

    if (statusCode !== 200) {
      throw new Error(
        `Token refresh failed (HTTP ${statusCode}): ${JSON.stringify(json)}`,
      );
    }

    return toTokenPair(json, realmId);
  }

  /**
   * Revoke tokens (e.g. on disconnect).
   */
  async revokeToken(token: string): Promise<void> {
    const { statusCode, body } = await request(INTUIT_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader(this.clientId, this.clientSecret),
      },
      body: JSON.stringify({ token }),
    });

    // Drain the body to release the connection
    await body.text();

    if (statusCode !== 200) {
      throw new Error(`Token revocation failed (HTTP ${statusCode})`);
    }
  }
}
