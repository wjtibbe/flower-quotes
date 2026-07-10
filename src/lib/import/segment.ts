const NOISE_LINE_PATTERNS = [
  /^(hi|hello|dear|hey|buenos|good\s+(morning|afternoon|evening))\b/i,
  /^(regards|best regards|kind regards|sincerely|thank you|thanks|saludos|atentamente)\b/i,
  /^(from|sent|to|subject|cc|bcc)\s*:/i,
  /^\d+$/, // bare page numbers
  /^(let me know|following up|if you.?re looking|our farm team)/i,
  /^www\.|^https?:\/\//i,
  /^[\p{Emoji_Presentation}\s]+$/u,
];

/**
 * Splits raw extracted text into candidate farm-offer lines, dropping
 * greetings, email headers/signatures and other non-product noise. Each
 * remaining line is a candidate to run through the field-recognition parser.
 */
export function segmentOfferLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .filter((line) => looksLikeProductLine(line));
}

function looksLikeProductLine(line: string): boolean {
  const hasPrice = /\$\s*[\d.,]+/.test(line);
  const hasBoxPattern = /\d+\s*(?:QB|HB|FB)\s*[x×*]?\s*\d+/i.test(line);
  const hasEnoughWords = line.split(/\s+/).length >= 2;
  return (hasPrice || hasBoxPattern) && hasEnoughWords;
}
