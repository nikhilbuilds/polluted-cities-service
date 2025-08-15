// asciiFold.ts
// Convert "Białyštok" -> "Bialystok", "München" -> "Munchen", "São Paulo" -> "Sao Paulo"
// Works for most Latin-script names without external deps.

type FoldOptions = {
  toLower?: boolean; // default false
  removePunctuation?: boolean; // default false (keeps spaces & hyphens)
  replaceSpacesWith?: string; // e.g. "-" for slugs; default preserves spaces
};

const PRE_MAP: Record<string, string> = {
  // Germanic & Nordic
  ß: "ss",
  ẞ: "SS",
  Æ: "AE",
  æ: "ae",
  Ø: "O",
  ø: "o",
  Å: "A",
  å: "a",
  Œ: "OE",
  œ: "oe",
  // Slavic & Central European
  Ł: "L",
  ł: "l",
  Đ: "D",
  đ: "d",
  Ħ: "H",
  ħ: "h",
  // Turkish dotted/undotted i
  İ: "I",
  ı: "i",
  // Old/compat characters
  ſ: "s",
  ƒ: "f",
  // Icelandic/Old English
  Þ: "Th",
  þ: "th",
  Ð: "D",
  ð: "d",
};

export function asciiFold(input: string, opts: FoldOptions = {}): string {
  if (input == null) return "";

  // 1) Apply pre-map for characters that NFKD doesn’t turn into ASCII letters.
  let s = Array.from(input)
    .map((ch) => PRE_MAP[ch] ?? ch)
    .join("");

  // 2) NFKD: split base letters + diacritics/compat forms (e.g., "ś" -> "s"+" ́ ")
  s = s.normalize("NFKD");

  // 3) Drop all combining marks (accents, carons, tildes, stroke overlays, etc.)
  s = s.replace(/\p{M}+/gu, "");

  // 4) Optionally strip punctuation (keep word separators if you like)
  if (opts.removePunctuation) {
    // remove everything except letters, numbers, space, and hyphen
    s = s.replace(/[^\p{L}\p{N}\s-]/gu, "");
  }

  // 5) Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  // 6) Optional space replacement (for slugs)
  if (opts.replaceSpacesWith != null && opts.replaceSpacesWith !== " ") {
    s = s.replace(/ /g, opts.replaceSpacesWith);
  }

  // 7) Optional case
  if (opts.toLower) s = s.toLowerCase();

  return s;
}
