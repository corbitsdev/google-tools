import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HttpMediatedCredential } from "@intx/types";
import { createRuntimeCapabilities } from "@intx/types/runtime-capabilities";

import type { GmailFetch } from "../src/client/index.js";
import {
  createGmailTools,
  type GmailTools,
} from "../src/tools/create-tools.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

export function getArray(
  value: Record<string, unknown>,
  key: string,
): unknown[] | undefined {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : undefined;
}

type StoredGmailToken = {
  refreshToken: string;
  grantedScopes?: string[];
};

function createFileTokenStore(path: string) {
  return {
    async read() {
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch (error) {
        if (isMissingFileError(error)) return undefined;
        throw error;
      }
      try {
        return parseStoredGmailToken(JSON.parse(raw));
      } catch (cause) {
        throw new Error(`invalid Gmail token file: ${path}`, { cause });
      }
    },
    async write(token: StoredGmailToken) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify(token, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(path, 0o600);
    },
  };
}

function parseStoredGmailToken(value: unknown): StoredGmailToken {
  if (!isRecord(value)) throw new Error("expected JSON object");
  const refreshToken = getString(value, "refreshToken");
  if (refreshToken === undefined || refreshToken.length === 0) {
    throw new Error("refreshToken is required");
  }
  const grantedScopes = getArray(value, "grantedScopes");
  const scopes =
    grantedScopes?.filter(
      (scope): scope is string => typeof scope === "string",
    ) ?? [];
  if (grantedScopes !== undefined && scopes.length !== grantedScopes.length) {
    throw new Error("grantedScopes must contain strings");
  }
  return {
    refreshToken,
    ...(grantedScopes === undefined ? {} : { grantedScopes: scopes }),
  };
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

const GMAIL_LIVE_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/gmail.modify",
];

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  tokenFile: string;
  port: number;
  scopes: readonly string[];
};

type GmailAccessToken = {
  accessToken: string;
  expiresAt: number;
};

type GmailLiveLogger = { info(message: string): void };

const defaultGmailLiveLogger: GmailLiveLogger = {
  info(message) {
    process.stdout.write(`${message}\n`);
  },
};

function readGmailOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): GmailOAuthConfig {
  const clientId = env.GMAIL_LIVE_CLIENT_ID?.trim();
  const clientSecret = env.GMAIL_LIVE_CLIENT_SECRET?.trim();
  if (clientId === undefined || clientId.length === 0) {
    throw new Error(
      "GMAIL_LIVE_CLIENT_ID is required for the live Gmail suite",
    );
  }
  if (clientSecret === undefined || clientSecret.length === 0) {
    throw new Error(
      "GMAIL_LIVE_CLIENT_SECRET is required for the live Gmail suite",
    );
  }
  return {
    clientId,
    clientSecret,
    tokenFile:
      env.GMAIL_LIVE_TOKEN_FILE?.trim() || ".local/gmail-live-token.json",
    port: parseLivePort(env.GMAIL_LIVE_PORT),
    scopes: GMAIL_LIVE_SCOPES,
  };
}

function parseLivePort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return 8765;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(
      "GMAIL_LIVE_PORT must be an integer between 1024 and 65535",
    );
  }
  return port;
}

async function parseTokenResponse(
  response: Response,
): Promise<Record<string, unknown>> {
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

async function refreshGmailAccessToken(
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

async function authorizeGmail(
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
      return new Response(
        "Authorization complete. You can close this window.",
        {
          headers: { "Content-Type": "text/html" },
        },
      );
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

  const timer = setTimeout(
    () => {
      stopServer();
      code.reject(new Error("timed out waiting for Google OAuth callback"));
    },
    5 * 60 * 1_000,
  );
  logger.info(
    `Open this URL to authorize the Gmail live test:\n${authorizationUrl}`,
  );
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

  return exchangeAuthorizationCode(
    config,
    authorizationCode,
    redirectUri,
    fetchImpl,
  );
}

const GMAIL_API_ORIGIN = "https://gmail.googleapis.com";

type StandaloneGmailCredentialOptions = {
  config: GmailOAuthConfig;
  token: StoredGmailToken;
  fetchImpl?: GmailFetch;
};

function createStandaloneGmailCredential(
  options: StandaloneGmailCredentialOptions,
): HttpMediatedCredential {
  const networkFetch = options.fetchImpl ?? globalThis.fetch;
  let accessToken: GmailAccessToken | undefined;
  let refreshPromise: Promise<GmailAccessToken> | undefined;

  async function getAccessToken(force = false): Promise<string> {
    if (
      !force &&
      accessToken !== undefined &&
      accessToken.expiresAt > Date.now() + 60_000
    ) {
      return accessToken.accessToken;
    }
    refreshPromise ??= refreshGmailAccessToken(
      options.config,
      options.token.refreshToken,
      networkFetch,
    ).finally(() => {
      refreshPromise = undefined;
    });
    accessToken = await refreshPromise;
    return accessToken.accessToken;
  }

  async function authenticatedFetch(
    input: string | URL | Request,
    init?: RequestInit,
    forceRefresh = false,
  ): Promise<Response> {
    const sourceRequest = input instanceof Request ? input : undefined;
    const url = new URL(sourceRequest?.url ?? String(input));
    if (url.origin !== GMAIL_API_ORIGIN) {
      throw new Error(
        `standalone Gmail credential rejected non-Gmail origin: ${url.origin}`,
      );
    }
    const headers = new Headers(sourceRequest?.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set(
      "Authorization",
      `Bearer ${await getAccessToken(forceRefresh)}`,
    );

    const request: RequestInit = { ...init, headers, redirect: "manual" };
    return networkFetch(
      sourceRequest === undefined
        ? new Request(url.href, request)
        : new Request(sourceRequest, request),
    );
  }

  return {
    kind: "http",
    async fetch(input, init) {
      const response = await authenticatedFetch(input, init);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (
        response.status !== 401 ||
        !["GET", "HEAD", "OPTIONS"].includes(method)
      ) {
        return response;
      }
      return authenticatedFetch(input, init, true);
    },
    dispose() {
      accessToken = undefined;
    },
  };
}

type GmailFixture = { threadId: string; messageId: string };

async function findGmailFixture(
  tools: GmailTools,
  query: string,
  signal: AbortSignal,
): Promise<GmailFixture> {
  const result = await tools.run(
    {
      id: "live-fixture-search",
      name: "gmail_search_threads",
      arguments: { query, pageSize: 10 },
    },
    signal,
  );
  if (result.isError) {
    throw new Error(`fixture search failed: ${JSON.stringify(result.content)}`);
  }
  if (!isRecord(result.content) || !isRecord(result.content.data)) {
    throw new Error("fixture search did not return structured data");
  }
  const threads = getArray(result.content.data, "threads");
  if (threads === undefined || threads.length !== 1) {
    throw new Error(
      `fixture query must match exactly one Gmail thread: ${query}`,
    );
  }
  const thread = threads[0];
  if (!isRecord(thread)) {
    throw new Error(`no Gmail fixture matched query: ${query}`);
  }
  const threadId = getString(thread, "id");
  const messages = getArray(thread, "messages");
  if (messages === undefined || messages.length !== 1) {
    throw new Error(
      `fixture thread must contain exactly one Gmail message: ${query}`,
    );
  }
  const firstMessage = messages[0];
  const messageId = isRecord(firstMessage)
    ? getString(firstMessage, "id")
    : undefined;
  if (
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    typeof messageId !== "string" ||
    messageId.length === 0
  ) {
    throw new Error(`no Gmail fixture matched query: ${query}`);
  }
  return { threadId, messageId };
}

type LiveHarness = {
  tools: GmailTools;
  fixture: GmailFixture;
  deleteDraftsForSubject(subject: string): Promise<void>;
  dispose(): Promise<void>;
};

export async function createLiveHarness(): Promise<LiveHarness> {
  const config = readGmailOAuthConfig();
  const tokenStore = createFileTokenStore(config.tokenFile);
  const existingToken = await tokenStore.read();
  const token = existingToken ?? (await authorizeGmail(config));
  if (!token.grantedScopes?.includes(config.scopes[0] ?? "")) {
    throw new Error("Gmail OAuth token did not record granted scopes");
  }
  if (existingToken === undefined) await tokenStore.write(token);

  const credential = createStandaloneGmailCredential({
    config,
    token,
  });
  const tools = createGmailTools({
    capabilities: createRuntimeCapabilities({
      credentials: {
        async resolve(handle) {
          if (handle !== "gmail-api") {
            throw new Error(`unknown standalone credential handle: ${handle}`);
          }
          return credential;
        },
      },
    }),
  });

  const query = process.env.GMAIL_LIVE_FIXTURE_QUERY?.trim();
  if (query === undefined || query.length === 0) {
    await tools.dispose();
    throw new Error(
      "GMAIL_LIVE_FIXTURE_QUERY is required for the live Gmail suite",
    );
  }

  try {
    const fixture = await findGmailFixture(
      tools,
      query,
      new AbortController().signal,
    );
    return {
      tools,
      fixture,
      deleteDraftsForSubject: (subject) =>
        deleteDraftsForSubject(tools, credential, subject),
      async dispose() {
        await tools.dispose();
      },
    };
  } catch (cause) {
    await tools.dispose();
    throw cause;
  }
}

async function deleteDraftsForSubject(
  tools: GmailTools,
  credential: { fetch(input: string, init?: RequestInit): Promise<Response> },
  subject: string,
): Promise<void> {
  const result = await tools.run(
    {
      id: "live-cleanup-drafts",
      name: "gmail_list_drafts",
      arguments: { query: `subject:${subject}` },
    },
    new AbortController().signal,
  );
  const data = toolData(result, "gmail_list_drafts");
  const drafts = getArray(data, "drafts") ?? [];
  const draftIds = drafts.flatMap((draft) => {
    if (!isRecord(draft) || getString(draft, "subject") !== subject) return [];
    const id = getString(draft, "id");
    return id === undefined ? [] : [id];
  });
  for (const draftId of draftIds) {
    const response = await credential.fetch(
      `${GMAIL_API_ORIGIN}/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(
        `failed to delete live test draft: HTTP ${String(response.status)}`,
      );
    }
  }
}

export function toolData(
  result: unknown,
  toolName: string,
): Record<string, unknown> {
  if (
    !isRecord(result) ||
    result.isError === true ||
    !isRecord(result.content)
  ) {
    throw new Error(`${toolName} failed`);
  }
  const data = result.content.data;
  if (!isRecord(data))
    throw new Error(`${toolName} did not return structured data`);
  return data;
}

export function toolId(result: unknown, toolName: string): string {
  const id = getString(toolData(result, toolName), "id");
  if (id === undefined || id.length === 0)
    throw new Error(`${toolName} did not return an ID`);
  return id;
}
