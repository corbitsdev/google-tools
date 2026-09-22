import { randomUUID } from "node:crypto";

import type { GmailFetch } from "../../src/client/index.js";
import { getString, isRecord } from "./json.js";
import type { StoredGmailToken } from "./token-store.js";

export const GMAIL_LIVE_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/gmail.modify",
];

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  tokenFile: string;
  port: number;
  scopes: readonly string[];
};

export type GmailAccessToken = {
  accessToken: string;
  expiresAt: number;
};

export type GmailLiveLogger = { info(message: string): void };

export const defaultGmailLiveLogger: GmailLiveLogger = {
  info(message) {
    process.stdout.write(`${message}\n`);
  },
};

export function readGmailOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): GmailOAuthConfig {
  const clientId = env.GMAIL_LIVE_CLIENT_ID?.trim();
  const clientSecret = env.GMAIL_LIVE_CLIENT_SECRET?.trim();
  if (clientId === undefined || clientId.length === 0) {
    throw new Error("GMAIL_LIVE_CLIENT_ID is required for the live Gmail suite");
  }
  if (clientSecret === undefined || clientSecret.length === 0) {
    throw new Error("GMAIL_LIVE_CLIENT_SECRET is required for the live Gmail suite");
  }
  return {
    clientId,
    clientSecret,
    tokenFile: env.GMAIL_LIVE_TOKEN_FILE?.trim() || ".local/gmail-live-token.json",
    port: parseLivePort(env.GMAIL_LIVE_PORT),
    scopes: GMAIL_LIVE_SCOPES,
  };
}

function parseLivePort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return 8765;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("GMAIL_LIVE_PORT must be an integer between 1024 and 65535");
  }
  return port;
}

async function parseTokenResponse(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let body: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    body = isRecord(parsed) ? parsed : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const errorCode =
      (body === undefined ? undefined : getString(body, "error")) ??
      `HTTP ${String(response.status)}`;
    throw new Error(`Google OAuth token request failed: ${errorCode}`);
  }
  if (body === undefined) {
    throw new Error("Google OAuth token response was not a JSON object");
  }
  return body;
}

function tokenFromResponse(body: Record<string, unknown>): GmailAccessToken {
  const accessToken = getString(body, "access_token");
  const expiresIn = body.expires_in;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Google OAuth token response did not include access_token");
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    throw new Error("Google OAuth token response did not include expires_in");
  }
  return {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1_000,
  };
}

export async function refreshGmailAccessToken(
  config: Pick<GmailOAuthConfig, "clientId" | "clientSecret">,
  refreshToken: string,
  fetchImpl: GmailFetch = globalThis.fetch,
): Promise<GmailAccessToken> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return tokenFromResponse(await parseTokenResponse(response));
}

async function exchangeAuthorizationCode(
  config: Pick<GmailOAuthConfig, "clientId" | "clientSecret">,
  code: string,
  redirectUri: string,
  fetchImpl: GmailFetch,
): Promise<StoredGmailToken> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const parsed = await parseTokenResponse(response);
  const refreshToken = getString(parsed, "refresh_token");
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new Error(
      "Google OAuth did not return a refresh token; revoke the prior grant and authorize again",
    );
  }
  const scope = getString(parsed, "scope");
  return {
    refreshToken,
    ...(typeof scope === "string"
      ? { grantedScopes: scope.split(" ").filter(Boolean) }
      : {}),
  };
}

export async function authorizeGmail(
  config: GmailOAuthConfig,
  fetchImpl: GmailFetch = globalThis.fetch,
  logger: GmailLiveLogger = defaultGmailLiveLogger,
): Promise<StoredGmailToken> {
  const state = randomUUID();
  let stopServer = (): void => undefined;
  const code = Promise.withResolvers<string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,
    fetch(request) {
      const requestUrl = new URL(request.url);
      if (requestUrl.pathname !== "/oauth2callback") {
        return new Response("Not found", { status: 404 });
      }
      if (requestUrl.searchParams.get("state") !== state) {
        stopServer();
        code.reject(new Error("Google OAuth state mismatch"));
        return new Response("Invalid OAuth state", { status: 400 });
      }
      const error = requestUrl.searchParams.get("error");
      if (error !== null) {
        stopServer();
        code.reject(new Error(`Google OAuth authorization failed: ${error}`));
        return new Response("Google OAuth was denied", { status: 400 });
      }
      const authorizationCode = requestUrl.searchParams.get("code");
      if (authorizationCode === null || authorizationCode.length === 0) {
        stopServer();
        code.reject(new Error("Google OAuth callback did not include a code"));
        return new Response("Missing authorization code", { status: 400 });
      }
      stopServer();
      code.resolve(authorizationCode);
      return new Response("Authorization complete. You can close this window.", {
        headers: { "Content-Type": "text/html" },
      });
    },
  });
  stopServer = () => server.stop();

  const redirectUri = `http://127.0.0.1:${String(server.port)}/oauth2callback`;
  const authorizationUrl = new URL(AUTHORIZATION_ENDPOINT);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();

  const timer = setTimeout(() => {
    stopServer();
    code.reject(new Error("timed out waiting for Google OAuth callback"));
  }, 5 * 60 * 1_000);
  logger.info(`Open this URL to authorize the Gmail live test:\n${authorizationUrl}`);
  try {
    const child = Bun.spawn(["open", authorizationUrl.toString()], {
      stdout: "ignore",
      stderr: "ignore",
    });
    void child.exited;
  } catch {
    // The URL is already printed for environments without macOS `open`.
  }

  const authorizationCode = await code.promise.finally(() => {
    clearTimeout(timer);
    stopServer();
  });

  return exchangeAuthorizationCode(config, authorizationCode, redirectUri, fetchImpl);
}
