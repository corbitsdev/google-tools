import { describe, expect, test } from "bun:test";

import { readGmailOAuthConfig, refreshGmailAccessToken } from "../live/oauth.js";

describe("Gmail OAuth", () => {
  test("normalizes the required configuration", () => {
    expect(
      readGmailOAuthConfig({
        GMAIL_LIVE_CLIENT_ID: " client-id ",
        GMAIL_LIVE_CLIENT_SECRET: " secret ",
      }),
    ).toMatchObject({
      clientId: "client-id",
      clientSecret: "secret",
      port: 8765,
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    });
  });

  test("rejects missing client credentials", () => {
    expect(() => readGmailOAuthConfig({})).toThrow("GMAIL_LIVE_CLIENT_ID");
    expect(() =>
      readGmailOAuthConfig({ GMAIL_LIVE_CLIENT_ID: "client-id" }),
    ).toThrow("GMAIL_LIVE_CLIENT_SECRET");
  });

  test("sends the client secret when refreshing a token", async () => {
    let requestBody = "";
    const token = await refreshGmailAccessToken(
      { clientId: "client-id", clientSecret: "secret" },
      "refresh-token",
      async (_input, init) => {
        requestBody = String(init?.body);
        return new Response(
          JSON.stringify({ access_token: "access-token", expires_in: 3_600 }),
        );
      },
    );

    expect(token.accessToken).toBe("access-token");
    expect(requestBody).toContain("client_id=client-id");
    expect(requestBody).toContain("client_secret=secret");
  });

  test("preserves Google OAuth error codes", async () => {
    await expect(
      refreshGmailAccessToken(
        { clientId: "client-id", clientSecret: "secret" },
        "refresh-token",
        async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
      ),
    ).rejects.toThrow("invalid_grant");
  });
});
