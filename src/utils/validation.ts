/**
 * Small request-validation helpers that throw {@link ApiError} on failure so
 * the error-handling middleware can translate them into 400 responses.
 */

import { ApiError } from "../errors/ApiError";

/** Ensures `value` is a non-empty string and returns it trimmed. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw ApiError.badRequest(`"${field}" must be a non-empty string`);
  }
  return value.trim();
}

/** Parses a string (or numeric) value to a BigInt. */
export function requireBigInt(value: unknown, field: string): bigint {
  try {
    const str = typeof value === "string" ? value : String(value);
    const val = BigInt(str);
    if (val <= 0n) {
      throw new Error("non-positive");
    }
    return val;
  } catch {
    throw ApiError.badRequest(`"${field}" must be a positive integer (string format)`);
  }
}

/** Ensures `value` is a non-empty string up to a maximum length. */
export function requireStringMaxLength(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const str = requireString(value, field);
  if (str.length > maxLength) {
    throw ApiError.badRequest(
      `"${field}" must be at most ${maxLength} characters`,
    );
  }
  return str;
}

/** Ensures `value` is a finite number greater than zero. */
export function requirePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw ApiError.badRequest(`"${field}" must be a positive number`);
  }
  return value;
}

/**
 * Coerces `value` to a number and ensures it is a positive integer (e.g. a
 * resource id from a route param), returning the parsed number.
 */
export function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw ApiError.badRequest(`"${field}" must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw ApiError.badRequest(`"${field}" must be a positive integer`);
  }
  return parsed;
}

/**
 * Parses an optional boolean flag, typically sourced from a query param where
 * the value arrives as a string (`?dryRun=true`).
 *
 * Parsing is deliberately strict: an absent value defaults to `false`, and the
 * only accepted values are `true`/`false` (as a real boolean, or as a string in
 * any casing/with surrounding whitespace). Anything else — `"yes"`, `"1"`, a
 * typo such as `"ture"`, or a repeated query param that Express turns into an
 * array — is a 400 rather than being silently coerced. For a flag like
 * `dryRun`, silently treating a typo as "not set" would perform a real,
 * persisting write when the caller explicitly asked for a preflight check.
 */
export function optionalBooleanFlag(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw ApiError.badRequest(`"${field}" must be "true" or "false"`);
}

/** Normalizes an asset code to upper case (e.g. "usdc" -> "USDC"). */
export function normalizeAsset(value: unknown): string {
  const asset = requireString(value, "asset").toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(asset)) {
    throw ApiError.badRequest(`"asset" must be 1-12 alphanumeric characters`);
  }
  return asset;
}
