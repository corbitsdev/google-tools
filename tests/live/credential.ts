import type { HttpMediatedCredential } from "@intx/types";

import type { GmailFetch } from "../../src/client/index.js";
import {
  refreshGmailAccessToken,
  type GmailAccessToken,
  type GmailOAuthConfig,
} from "./oauth.js";
import type { StoredGmailToken } from "./token-store.js";

export const GMAIL_API_ORIGIN = "https://gmail.googleapis.com";

export type StandaloneGmailCredentialOptions = {
  config: GmailOAuthConfig;
  token: StoredGmailToken;
  fetchImpl?: GmailFetch;
};

export function createStandaloneGmailCredential(
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
    headers.set("Authorization", `Bearer ${await getAccessToken(forceRefresh)}`);

    return networkFetch(
      new Request(sourceRequest ?? url, {
        ...init,
        headers,
        redirect: "manual",
      }),
    );
  }

  return {
    kind: "http",
    async fetch(input, init) {
      const response = await authenticatedFetch(input, init);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (response.status !== 401 || !["GET", "HEAD", "OPTIONS"].includes(method)) {
        return response;
      }
      return authenticatedFetch(input, init, true);
    },
    dispose() {
      accessToken = undefined;
    },
  };
}
