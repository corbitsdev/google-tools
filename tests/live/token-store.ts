import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getArray, getString, isRecord } from "./json.js";

export type StoredGmailToken = {
  refreshToken: string;
  grantedScopes?: string[];
};

export interface GmailTokenStore {
  read(): Promise<StoredGmailToken | undefined>;
  write(token: StoredGmailToken): Promise<void>;
}

export function createFileTokenStore(path: string): GmailTokenStore {
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
    async write(token) {
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
    grantedScopes?.filter((scope): scope is string => typeof scope === "string") ?? [];
  if (grantedScopes !== undefined && scopes.length !== grantedScopes.length) {
    throw new Error("grantedScopes must contain strings");
  }
  return { refreshToken, ...(grantedScopes === undefined ? {} : { grantedScopes: scopes }) };
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
