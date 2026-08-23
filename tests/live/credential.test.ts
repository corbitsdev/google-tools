import { describe, expect, test } from "bun:test";

import { createStandaloneGmailCredential } from "./credential.js";
import { type GmailOAuthConfig } from "./oauth.js";

const config: GmailOAuthConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  tokenFile: ".local/test-token.json",
  port: 8765,
  scopes: [],
};

describe("standalone Gmail credential", () => {
  test("refreshes locally and pins requests to Gmail", async () => {
    let tokenRequests = 0;
    let gmailRequests = 0;
    const credential = createStandaloneGmailCredential({
      config,
      token: { refreshToken: "refresh-token" },
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          tokenRequests += 1;
          expect(init?.method).toBe("POST");
          return new Response(
            JSON.stringify({ access_token: `access-${String(tokenRequests)}`, expires_in: 3_600 }),
            { status: 200 },
          );
        }
        gmailRequests += 1;
        expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/labels");
        const headers = input instanceof Request ? input.headers : init?.headers;
        expect(new Headers(headers).get("authorization")).toBe("Bearer access-1");
        return new Response(JSON.stringify({ labels: [] }), { status: 200 });
      }),
    });

    await expect(
      credential.fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels"),
    ).resolves.toBeInstanceOf(Response);
    await expect(
      credential.fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels"),
    ).resolves.toBeInstanceOf(Response);
    expect(tokenRequests).toBe(1);
    expect(gmailRequests).toBe(2);
  });

  test("rejects non-Gmail origins before network access", async () => {
    const credential = createStandaloneGmailCredential({
      config,
      token: { refreshToken: "refresh-token" },
      fetchImpl: (async () => {
        throw new Error("network should not run");
      }),
    });
    await expect(credential.fetch("https://evil.example/steal")).rejects.toThrow(
      /non-Gmail origin/,
    );
  });
});
