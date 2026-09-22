export type DraftInput = {
  to?: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  subject?: string;
  body?: string;
  htmlBody?: string;
};

export type ReplyContext = {
  threadId?: string;
  messageId?: string;
  references?: string;
  subject?: string;
  plaintextBody?: string;
  htmlBody?: string;
  to?: readonly string[];
};

function assertSafeHeader(value: string, name: string): void {
  if (value.includes("\r") || value.includes("\n")) {
    throw new Error(`argument "${name}" cannot contain a newline`);
  }
}

function recipientHeader(name: string, addresses: readonly string[] | undefined): string[] {
  if (addresses === undefined || addresses.length === 0) return [];
  for (const address of addresses) {
    assertSafeHeader(address, name);
  }
  return [`${name}: ${addresses.join(", ")}`];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function replyBodies(input: DraftInput, reply: ReplyContext | undefined): {
  plaintext: string;
  html: string | undefined;
} {
  const body = input.body ?? "";
  const html = input.htmlBody;
  if (reply === undefined) {
    return { plaintext: body, html };
  }

  const quotedPlaintext = reply.plaintextBody;
  const plaintext =
    quotedPlaintext === undefined || quotedPlaintext.length === 0
      ? body
      : `${body}\r\n\r\n${quotedPlaintext}`;
  const quotedHtml = reply.htmlBody;
  const richBody = html ?? (body.length === 0 ? undefined : `<p>${escapeHtml(body)}</p>`);
  const mergedHtml =
    richBody === undefined && quotedHtml === undefined
      ? undefined
      : `${richBody ?? ""}${quotedHtml === undefined ? "" : `<blockquote>${quotedHtml}</blockquote>`}`;
  return { plaintext, html: mergedHtml };
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function createRawDraft(input: DraftInput, reply?: ReplyContext): string {
  const subject = input.subject ?? reply?.subject ?? "";
  assertSafeHeader(subject, "subject");
  const headers = [
    ...recipientHeader("To", input.to ?? reply?.to),
    ...recipientHeader("Cc", input.cc),
    ...recipientHeader("Bcc", input.bcc),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];
  if (reply?.messageId !== undefined) {
    assertSafeHeader(reply.messageId, "replyToMessageId");
    if (reply.references !== undefined) {
      assertSafeHeader(reply.references, "references");
    }
    const references =
      reply.references === undefined
        ? reply.messageId
        : `${reply.references} ${reply.messageId}`;
    headers.push(`In-Reply-To: ${reply.messageId}`);
    headers.push(`References: ${references}`);
  }

  const bodies = replyBodies(input, reply);
  if (bodies.html === undefined) {
    return encodeBase64Url(
      `${headers.join("\r\n")}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${bodies.plaintext}`,
    );
  }

  const boundary = `gmail-tools-${crypto.randomUUID()}`;
  return encodeBase64Url(
    [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      bodies.plaintext,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      bodies.html,
      `--${boundary}--`,
    ].join("\r\n"),
  );
}
