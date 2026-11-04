/**
 * Shared parameter-normalisation helpers for MCP tool handlers.
 *
 * Some MCP clients (notably Kiro IDE) send every value as a string regardless
 * of the declared JSON Schema type. The helpers below ensure robust handling
 * of such type-coercion edge cases.
 */

/**
 * Normalise the `files` argument, which MCP clients may send as either a
 * JSON-encoded string or a proper string array.
 *
 * A JSON-decoded array may contain non-string entries (numbers, null, objects)
 * that would crash downstream path handling, so only string entries are kept.
 * A JSON-encoded single string (e.g. `"\"src/a.ts\""`) is unwrapped.
 *
 * @param value - Raw value from the tool argument payload
 * @returns A normalised string array (may be empty)
 */
export function normalizeFilesParam(value: string[] | string | undefined): string[] {
  if (value === undefined) return [];
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === 'string');
      }
      return typeof parsed === 'string' ? [parsed] : [value];
    } catch {
      return [value];
    }
  }
  return value;
}

/**
 * Pre-process raw MCP tool arguments before Zod validation.
 *
 * Walks the Zod schema to discover which fields expect `number` or `array`,
 * then coerces string values accordingly. This prevents Zod validation errors
 * caused by MCP clients that serialise all arguments as strings.
 */
export function coerceArgs(args: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
  if (!args || typeof args !== 'object') return args;
  const result = { ...args };

  for (const [key, zodType] of Object.entries(schema)) {
    if (result[key] === undefined) continue;
    const typeName = getZodTypeName(zodType);

    // Coerce string → number
    if (typeName === 'ZodNumber' && typeof result[key] === 'string') {
      const num = Number(result[key]);
      if (!Number.isNaN(num)) {
        result[key] = num;
      }
    }

    // Coerce string → array (JSON-encoded)
    if (typeName === 'ZodArray' && typeof result[key] === 'string') {
      try {
        const parsed = JSON.parse(result[key] as string);
        if (Array.isArray(parsed)) {
          result[key] = parsed;
        }
      } catch {
        // leave as-is; Zod will report the validation error
      }
    }
  }
  return result;
}

/** Extract the Zod typeName, unwrapping Optional/Default wrappers. */
function getZodTypeName(zodType: unknown): string {
  const def = (zodType as Record<string, unknown>)?._def as Record<string, unknown> | undefined;
  const typeName = (def?.typeName as string) ?? '';
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
    return getZodTypeName(def?.innerType);
  }
  return typeName;
}
