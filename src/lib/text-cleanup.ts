/**
 * Decode common symbol-font (Wingdings-like) text back to ASCII.
 */
function decodeSymbolFont(text: string): string {
  return text.replace(/[\uF000-\uF0FF]/g, (char) => {
    const code = char.charCodeAt(0);
    const decoded = code - 0xF000;

    if (decoded >= 32 && decoded <= 126) {
      return String.fromCharCode(decoded);
    }
    return char;
  });
}

/**
 * Normalize smart punctuation and weird symbols.
 */
function normalizePunctuation(text: string): string {
  return text
    // Smart quotes → normal quotes
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")

    // Dashes → normal hyphen
    .replace(/[–—−]/g, '-')

    // Ellipsis → ...
    .replace(/…/g, '...')

    // Bullet points → dash
    .replace(/[•●▪]/g, '-')

    // Weird spacing characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')

    // Remove any remaining strange symbols (optional strict cleanup)
    .replace(/[^\x20-\x7E\n]/g, '');
}

/**
 * Post-process OCR text
 */
export function cleanOcrText(raw: string): string {
  // STEP 0: Decode symbol fonts
  let text = decodeSymbolFont(raw);

  // STEP 1: Normalize punctuation
  text = normalizePunctuation(text);

  // STEP 2: Normalize Unicode & remove control chars
  text = text
    .normalize('NFKD')
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      return char !== '\uFFFD' && !(code <= 0x1f && ![0x09, 0x0a, 0x0d].includes(code));
    })
    .join('');

  // Replace special whitespace
  text = text.replace(/[\u00A0\u2000-\u200A]+/g, ' ');

  // Normalize line spacing
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n');

  // Remove dot leaders
  text = text.replace(/(?:\.\s*){4,}/g, '  ');

  // Normalize dashes
  text = text.replace(/(?:[-]\s*){2,}/g, ' - ');

  // Collapse spaces
  text = text.replace(/[ \t]{2,}/g, ' ');

  // Fix page number alignment
  text = text.replace(/\s{2,}(\d+)\s/g, '\n$1 ');

  // Clean blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  // Final cleanup
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !/^[\s.-]*$/.test(line))
    .join('\n');

  return text.trim();
}

/**
 * Convert OCR text → structured HTML
 */
export function formatOcrTextAsHtml(text: string): string {
  const lines = text.split('\n');
  const htmlParts: string[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      htmlParts.push(
        `<p class="ocr-paragraph">${paragraphBuffer.join(' ')}</p>`
      );
      paragraphBuffer = [];
    }
  };

  for (let line of lines) {
    line = line.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    const headingLevel = detectHeadingLevel(line);

    if (headingLevel) {
      flushParagraph();

      const tag = headingLevel === 1 ? 'h2' : 'h3';
      const cls =
        headingLevel === 1 ? 'ocr-heading-1' : 'ocr-heading-2';

      htmlParts.push(
        `<${tag} class="${cls}">${escapeHtml(line)}</${tag}>`
      );
    } else {
      paragraphBuffer.push(escapeHtml(line));
    }
  }

  flushParagraph();
  return htmlParts.join('\n');
}

function detectHeadingLevel(line: string): 1 | 2 | null {
  if (line.length > 100) return null;
  if (line.length > 60 && /[a-z]/.test(line)) return null;

  if (/^(chapter|section|part)\s+\d/i.test(line)) return 1;

  const alphaOnly = line.replace(/[^a-zA-Z]/g, '');
  if (
    alphaOnly.length >= 3 &&
    alphaOnly === alphaOnly.toUpperCase() &&
    line.length <= 80
  )
    return 1;

  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(line)) return 2;

  if (/^(I{1,3}|IV|VI{0,3}|IX|X{0,3})\.?\s+\S/i.test(line))
    return 2;

  if (line.endsWith(':')) return 2;

  return null;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
