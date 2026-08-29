/**
 * In-memory convenience buffer of recent mutating requests.
 *
 * Records method/path/status/request-id/timestamp for every
 * POST/PUT/PATCH/DELETE request once its response finishes, in a bounded
 * rolling buffer, so operators can see recent write activity without an
 * external logging pipeline. This is an operator convenience buffer, not
 * a durable audit trail. Oldest entries are evicted once the limit is reached.
 */

import { NextFunction, Request, Response } from "express";
import { BoundedHistory } from "../utils/history";

export interface AuditEntry {
  method: string;
  path: string;
  status: number;
  requestId?: string;
  timestamp: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, any>;
}

export const SENSITIVE_FIELD_DENYLIST: ReadonlySet<string> = new Set([
  "x-api-key",
  "api-key",
  "apikey",
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "password",
  "bearer",
  "private_key",
  "privatekey",
  "client_secret",
]);

export function isSensitiveField(key: string): boolean {
  return SENSITIVE_FIELD_DENYLIST.has(key.toLowerCase().trim());
}

export function redactSensitiveData<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  const redactedObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveField(key)) {
      redactedObj[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      redactedObj[key] = redactSensitiveData(value);
    } else {
      redactedObj[key] = value;
    }
  }
  return redactedObj as T;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_LIMIT = 200;

export function createAuditLog(
  limit: number = DEFAULT_LIMIT,
): {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  entries: () => AuditEntry[];
  evictedCount: () => number;
} {
  const history = new BoundedHistory<AuditEntry>(limit);

  return {
    middleware: (req, res, next) => {
      if (!MUTATING_METHODS.has(req.method)) {
        next();
        return;
      }

      // Snapshot method/path now: Express mutates `req.url` (and so
      // `req.path`) while dispatching through mounted sub-routers, and by the
      // time the `finish` event fires that mutation may not have been
      // unwound, so reading them lazily below would capture the wrong value.
      const method = req.method;
      const path = req.originalUrl.split("?")[0];

      res.on("finish", () => {
        const entry: AuditEntry = {
          method,
          path,
          status: res.statusCode,
          requestId: res.getHeader("x-request-id") as string | undefined,
          timestamp: new Date().toISOString(),
        };

        history.push(redactSensitiveData(entry));
      });

      next();
    },
    entries: () => history.all(),
    evictedCount: () => history.evictedCount,
  };
}

