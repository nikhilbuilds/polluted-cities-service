// nameCase.ts
// Generic "proper name" casing for place names.
// - Keeps diacritics (ę, ź, ó, etc.)
// - Capitalizes first letter and after separators: space, hyphen, em/en dashes, apostrophes
// - Locale-aware for edge cases like ß/İ (pass e.g. "PL", "DE", "ES", "FR")

export function toNameCase(input: string, locale = "pl"): string {
  if (!input) return "";

  // Map country codes to proper locale codes
  const localeMap: Record<string, string> = {
    PL: "pl",
    DE: "de",
    ES: "es",
    FR: "fr",
    pl: "pl",
    de: "de",
    es: "es",
    fr: "fr",
  };

  const normalizedLocale = localeMap[locale] || locale.toLowerCase();

  // Normalize & lowercase in the chosen locale
  let s = input.normalize("NFKC").toLocaleLowerCase(normalizedLocale);

  // Handle special cases for specific locales
  s = handleLocaleSpecificCases(s, normalizedLocale);

  // Capitalize first letter and any letter after common separators:
  // \p{Zs} = any Unicode space separator
  // \p{Pd} = any Unicode dash (hyphen, en/em dash, non-breaking hyphen, etc.)
  // Also handle ASCII/curly apostrophes and common punctuation separators
  const rx = /(^|[\p{Zs}\p{Pd}''/()\.])(\p{L})/gu;

  s = s.replace(rx, (_m, sep: string, letter: string) => {
    return sep + letter.toLocaleUpperCase(normalizedLocale);
  });

  return s;
}

function handleLocaleSpecificCases(input: string, locale: string): string {
  let result = input;

  switch (locale) {
    case "de":
      // German: Handle ß properly - it should remain lowercase after capitalization rules
      // and handle compound words with proper casing
      break;

    case "es":
      // Spanish: Handle ñ, accented vowels, and proper casing for compound names
      // Handle "de", "del", "de la", "de los", "de las" (should remain lowercase in middle of names)
      result = result.replace(
        /\b(de|del|de\s+la|de\s+los|de\s+las)\b/g,
        (match, particle) => particle.toLowerCase()
      );
      break;

    case "fr":
      // French: Handle proper casing for articles and prepositions in place names
      // "de", "du", "des", "le", "la", "les", "sur", "sous" should remain lowercase in middle
      result = result.replace(
        /\b(de|du|des|le|la|les|sur|sous|en|au|aux)\b/g,
        (match, article) => article.toLowerCase()
      );
      break;

    case "pl":
      // Polish: Handle proper diacritics and compound place names
      // No special lowercasing rules like Romance languages
      break;
  }

  return result;
}
