export class GmailApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`Gmail API request failed (${String(status)} ${statusText})`);
    this.name = "GmailApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}
