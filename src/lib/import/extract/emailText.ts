/**
 * Minimal .eml text extraction: strips MIME headers and picks the
 * text/plain body part (falling back to a naive HTML-tag strip for
 * text/html-only emails). Good enough for internally forwarded/saved farm
 * emails; full MIME parsing (attachments, multipart edge cases) can be
 * swapped in later behind this same function signature.
 */
export function extractEmailText(raw: string): string {
  if (!looksLikeMime(raw)) {
    // Plain pasted text or a saved email body - use as-is.
    return raw;
  }

  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = raw.split(new RegExp(`--${escapeRegex(boundary)}`, "g"));
    const textPart = parts.find((p) => /content-type:\s*text\/plain/i.test(p));
    const htmlPart = parts.find((p) => /content-type:\s*text\/html/i.test(p));
    const chosen = textPart ?? htmlPart;
    if (chosen) {
      const body = chosen.split(/\r?\n\r?\n/).slice(1).join("\n\n");
      return textPart ? body : stripHtml(body);
    }
  }

  // No multipart boundary found - strip headers (everything before the first blank line).
  const blankLineIndex = raw.search(/\r?\n\r?\n/);
  const body = blankLineIndex !== -1 ? raw.slice(blankLineIndex) : raw;
  return /<html|<body|<div/i.test(body) ? stripHtml(body) : body;
}

function looksLikeMime(raw: string): boolean {
  return /^(from|to|subject|content-type|mime-version):/im.test(raw.slice(0, 2000));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
