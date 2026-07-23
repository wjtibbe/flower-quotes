import { parsePriceTierLine } from "./rangeExpansion";

/**
 * Line-aware chunker for large pasted-text / email supplier offers.
 *
 * Why this exists: the structured extraction call has a bounded output-token
 * budget. A large availability list (100+ product rows) cannot be extracted in
 * one call - the response is truncated (`stop_reason: "max_tokens"`), the tool
 * input comes back empty, and Zod fails with "lines: Required". Rather than
 * chase an ever-larger token cap, this segments a large source into bounded
 * batches of product rows, each small enough to extract reliably, which the
 * orchestrator (`runTextImportSource`) sends through the existing forced
 * structured-tool-use flow and then merges back in source order.
 *
 * The chunker is PURELY structural - it never parses flower-domain data. It
 * only distinguishes three kinds of physical line:
 *   A) document/section context   (a greeting, the farm name, a "ROSES"
 *                                   section heading) - background, never an
 *                                   offer line.
 *   B) probable product row        ("2hb Alert 40-60cm", "Dallas 60cm 0.38")
 *                                   - the rows that actually get chunked.
 *   C) shared commercial context   (a price-table tier like "40 cm 0.16")
 *                                   - shared pricing that applies to the whole
 *                                     document.
 *
 * The document header (leading context) and the shared price table are copied,
 * verbatim and clearly delimited, into EVERY chunk so each batch has the
 * global context it needs; only the product rows are partitioned across
 * chunks. Small inputs stay a single, byte-for-byte-unchanged call (a
 * Gutimilko-style 7-row list must remain 1 call), so nothing about the common
 * case changes.
 *
 * Everything here is pure and side-effect-free - no network, no database - so
 * it is exhaustively unit-testable.
 */

export type SourceLineType = "A" | "B" | "C";

export interface TextChunk {
  /** 0-based position of this chunk in the sequence. */
  index: number;
  /** Total number of chunks the source was split into. */
  total: number;
  /** Ready-to-send text for one extraction call (delimited when chunked). */
  composedText: string;
  /** Number of probable product rows in this chunk (safe metadata for logging). */
  productRowCount: number;
}

export interface ChunkOptions {
  /** Target number of product rows per chunk before flushing. */
  targetProductRows?: number;
  /** Secondary byte bound per chunk body (UTF-8), a backstop for very long rows. */
  maxChunkBytes?: number;
  /** At/below this product-row count (and byte size) the source stays one verbatim call. */
  singleCallRowThreshold?: number;
  /** At/below this byte size (with the row threshold) the source stays one verbatim call. */
  singleCallByteThreshold?: number;
}

// ~20-25 product rows per chunk keeps each extraction's output comfortably
// inside the token budget (roughly ~320 output tokens per line), with the byte
// bound as a backstop for pathologically long rows.
const DEFAULT_TARGET_PRODUCT_ROWS = 22;
const DEFAULT_MAX_CHUNK_BYTES = 12_000;
// A list this small comfortably fits one call - keep it a single, unmodified
// request so the common case is byte-for-byte identical to before chunking.
const DEFAULT_SINGLE_CALL_ROW_THRESHOLD = 30;
const DEFAULT_SINGLE_CALL_BYTE_THRESHOLD = 12_000;

export const DELIMITER_DOCUMENT_CONTEXT =
  "=== DOCUMENT CONTEXT (achtergrondinformatie — GEEN offerteregels) ===";
export const DELIMITER_BATCH_PRODUCT_ROWS =
  "=== BATCH PRODUCT ROWS (haal UITSLUITEND offerteregels hieruit) ===";
export const DELIMITER_SHARED_CONTEXT =
  "=== SHARED COMMERCIAL CONTEXT — gedeelde prijstabel (achtergrond — GEEN offerteregels) ===";

// A probable product row carries BOTH a word (a name) AND at least one concrete
// product signal: a cm length, a length range, a box code with a leading count,
// or a decimal price. A bare "week 30" or a "ROSES" heading has no such signal.
const HAS_WORD_RE = /[A-Za-z]{2,}/;
const PRODUCT_SIGNAL_RES: RegExp[] = [
  /\d{1,3}\s*-\s*\d{1,3}\s*cm/i, // "40-60cm"
  /\d{1,3}\s*cm/i, // "60cm", "60 cm"
  /\b\d{2,3}\s*[-–—]\s*\d{2,3}\b/, // bare range "40-60"
  /\b\d+\s*(?:qb|hb|fb)\b/i, // "2hb", "1qb"
  /\b(?:qb|hb|fb)\s*[x×*]\s*\d+\b/i, // "QBx40"
  /\d+[.,]\d{1,3}\b/, // a decimal price "0.38"
];

/**
 * Structurally classifies one physical source line (see the three types
 * above). Conservative by design: a line is only a product row (B) when it has
 * both a word and a concrete product signal; price-table tiers are C; anything
 * else - greetings, section headings, blank lines - is context (A).
 */
export function classifySourceLine(line: string): SourceLineType {
  if (parsePriceTierLine(line) !== null) return "C";
  if (!HAS_WORD_RE.test(line)) return "A";
  if (PRODUCT_SIGNAL_RES.some((re) => re.test(line))) return "B";
  return "A";
}

// A short, digit-free, word-bearing line is treated as a section heading
// ("ROSES", "SPRAY ROSES", "Carnations") - preserved as context so a section
// that spans a chunk boundary keeps its heading in the continuation chunk.
function isSectionHeader(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (/\d/.test(t)) return false;
  if (!HAS_WORD_RE.test(t)) return false;
  return t.split(/\s+/).length <= 4;
}

interface BodyLine {
  raw: string;
  type: SourceLineType;
  /** The section heading in effect when this line was read (for boundary carry-over). */
  activeSectionHeader: string | null;
}

function composeChunk(
  headerLines: string[],
  sectionHeader: string | null,
  bodyLines: string[],
  priceTableLines: string[],
): string {
  const parts: string[] = [];

  const docContext = [...headerLines];
  // Carry the active section heading into a chunk that starts mid-section and
  // doesn't already open with that heading.
  if (sectionHeader && bodyLines[0]?.trim() !== sectionHeader.trim()) {
    docContext.push(sectionHeader);
  }
  const docText = docContext.join("\n").trim();
  if (docText) parts.push(`${DELIMITER_DOCUMENT_CONTEXT}\n${docText}`);

  parts.push(`${DELIMITER_BATCH_PRODUCT_ROWS}\n${bodyLines.join("\n").trim()}`);

  const priceText = priceTableLines.join("\n").trim();
  if (priceText) parts.push(`${DELIMITER_SHARED_CONTEXT}\n${priceText}`);

  return parts.join("\n\n");
}

/**
 * Splits a plain-text supplier offer into bounded extraction chunks (see the
 * module doc). Small inputs return a single chunk whose `composedText` is the
 * ORIGINAL text unchanged. Large inputs return several chunks, each carrying
 * the document header + shared price table verbatim plus its own slice of the
 * product rows, wrapped in the section delimiters above. Source order,
 * headers, section headings and trailing price tables are all preserved.
 */
export function chunkTextSupplierOffer(text: string, options: ChunkOptions = {}): TextChunk[] {
  const targetProductRows = options.targetProductRows ?? DEFAULT_TARGET_PRODUCT_ROWS;
  const maxChunkBytes = options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES;
  const singleCallRowThreshold = options.singleCallRowThreshold ?? DEFAULT_SINGLE_CALL_ROW_THRESHOLD;
  const singleCallByteThreshold = options.singleCallByteThreshold ?? DEFAULT_SINGLE_CALL_BYTE_THRESHOLD;

  const rawLines = text.split(/\r?\n/);
  const classified = rawLines.map((raw) => ({ raw, type: classifySourceLine(raw) }));
  const totalProductRows = classified.filter((c) => c.type === "B").length;
  const totalBytes = Buffer.byteLength(text, "utf-8");

  // Small enough to extract in one shot: keep the request byte-for-byte
  // unchanged (the Gutimilko-style common case).
  if (totalProductRows <= singleCallRowThreshold && totalBytes <= singleCallByteThreshold) {
    return [{ index: 0, total: 1, composedText: text, productRowCount: totalProductRows }];
  }

  // Separate the global context (leading header + all price-table tiers) from
  // the body of product rows and their section headings.
  const headerLines: string[] = [];
  const priceTableLines: string[] = [];
  const bodyLines: BodyLine[] = [];
  let seenFirstProduct = false;
  let activeSectionHeader: string | null = null;

  for (const { raw, type } of classified) {
    if (type === "C") {
      // A shared price tier belongs to the whole document regardless of where
      // it appears (top or trailing), so it is pulled out as global context.
      priceTableLines.push(raw);
      continue;
    }
    if (!seenFirstProduct && type === "A") {
      headerLines.push(raw);
      continue;
    }
    if (type === "A" && isSectionHeader(raw)) activeSectionHeader = raw;
    if (type === "B") seenFirstProduct = true;
    bodyLines.push({ raw, type, activeSectionHeader });
  }

  // Partition the body into chunks by product-row count (with the byte bound as
  // a backstop). Section headings and blank lines ride along inside the chunk
  // whose products they introduce.
  interface PendingChunk {
    lines: string[];
    productRowCount: number;
    bytes: number;
    sectionHeaderAtStart: string | null;
  }
  const chunks: PendingChunk[] = [];
  let current: PendingChunk | null = null;

  for (const bl of bodyLines) {
    if (!current) {
      current = { lines: [], productRowCount: 0, bytes: 0, sectionHeaderAtStart: bl.activeSectionHeader };
    }
    current.lines.push(bl.raw);
    current.bytes += Buffer.byteLength(bl.raw, "utf-8") + 1;
    if (bl.type === "B") current.productRowCount++;

    if (current.productRowCount >= targetProductRows || current.bytes >= maxChunkBytes) {
      chunks.push(current);
      current = null;
    }
  }
  if (current && current.productRowCount > 0) {
    chunks.push(current);
  } else if (current) {
    // Trailing non-product lines (blank lines, a stray heading) - fold them
    // into the previous chunk rather than emitting an empty batch.
    if (chunks.length > 0) {
      chunks[chunks.length - 1].lines.push(...current.lines);
    }
  }

  // Degenerate case: no product rows survived partitioning (e.g. the size
  // threshold was crossed purely by header/price-table bytes). Fall back to a
  // single verbatim call so nothing is dropped.
  if (chunks.length === 0) {
    return [{ index: 0, total: 1, composedText: text, productRowCount: totalProductRows }];
  }

  return chunks.map((chunk, index) => ({
    index,
    total: chunks.length,
    composedText: composeChunk(headerLines, chunk.sectionHeaderAtStart, chunk.lines, priceTableLines),
    productRowCount: chunk.productRowCount,
  }));
}
