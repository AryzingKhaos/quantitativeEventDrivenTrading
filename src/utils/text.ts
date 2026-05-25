export function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function stripHtmlTags(value: string | null | undefined): string {
  return normalizeWhitespace((value ?? '').replace(/<[^>]+>/g, ' '));
}

export function sanitizeTitle(value: string | null | undefined): string {
  return normalizeWhitespace(value);
}

export function shortenText(value: string | null | undefined, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return '';
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

export function deriveSummary(
  summary: string | null | undefined,
  content: string | null | undefined,
  maxLength = 160
): string | null {
  const normalizedSummary = normalizeWhitespace(summary);
  if (normalizedSummary) {
    return shortenText(normalizedSummary, maxLength);
  }

  const normalizedContent = normalizeWhitespace(content);
  if (!normalizedContent) {
    return null;
  }

  return shortenText(normalizedContent, maxLength);
}

export function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

export function includesKeyword(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
}

// A keyword made only of ASCII letters/digits (with internal spaces, hyphens,
// slashes, apostrophes). For these we want whole-word matching; CJK keywords
// have no word boundaries and must keep substring matching.
const ASCII_WORD_KEYWORD = /^[a-z0-9](?:[a-z0-9'/\- ]*[a-z0-9])?$/;

/**
 * Exclude-keyword match. Unlike {@link includesKeyword}, an ASCII keyword only
 * matches on word boundaries, so a short acronym like "AMA" no longer hits
 * "Amazon"/"llama"/"drama". CJK keywords still match as substrings.
 */
export function includesExcludeKeyword(text: string, keyword: string): boolean {
  const haystack = text.toLowerCase();
  const needle = keyword.toLowerCase().trim();
  if (!needle) {
    return false;
  }

  if (ASCII_WORD_KEYWORD.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(haystack);
  }

  return haystack.includes(needle);
}
