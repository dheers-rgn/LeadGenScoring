import levenshtein from "fast-levenshtein";

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;#039;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

function applyCityAliases(city) {
  const aliases = {
    // Cape Town
    capetown: "cape town",
    "city of cape town": "cape town",

    // Johannesburg - safe aliases
    "johannesburg metropolitan area": "johannesburg",
    "city of johannesburg": "johannesburg",
    "gauteng johannesburg": "johannesburg",
    "johannesburg rsa": "johannesburg",
    "johannesburg south africa": "johannesburg",
    "johannesburg gauteng": "johannesburg",
    "johannesburg city": "johannesburg",
    "city of johannesburg gauteng south africa": "johannesburg",
    "johannesburg gauteng south africa": "johannesburg",

    // Dar es Salaam
    "dar es-salaam": "dar es salaam",

    // Bangalore / Bengaluru
    bengaluru: "bangalore",
  };

  return aliases[city] || city;
}

function normalizeCity(city) {
  if (city === null || city === undefined) return null;

  let value = String(city).trim();

  if (!value) return null;

  // Preserve the special aggregation bucket
  if (value.toUpperCase() === "NO_CITY") {
    return "no_city";
  }

  // Reject numeric-only values
  if (/^\d+$/.test(value)) return null;

  // Reject email / social handle / URL values
  if (value.includes("@")) return null;

  // Decode HTML entities
  value = decodeHtmlEntities(value);

  // Normalize Unicode characters
  value = value.normalize("NFKC");

  // Lowercase
  value = value.toLowerCase();

  // Remove punctuation while preserving Unicode letters/numbers
  value = value.replace(/[^\p{L}\p{N}\s]/gu, " ");

  // Normalize whitespace
  value = value.replace(/\s+/g, " ").trim();

  if (!value) return null;

  // Apply known safe aliases
  value = applyCityAliases(value);

  return value || null;
}

function isFuzzyCityMatch(a, b) {
  if (!a || !b) return false;

  if (a === b) return true;

  const lenDiff = Math.abs(a.length - b.length);

  // Don't fuzzy-match strings with substantially different lengths
  if (lenDiff > 2) return false;

  const distance = levenshtein.get(a, b);
  const maxLength = Math.max(a.length, b.length);

  // Conservative fuzzy matching
  const threshold = maxLength >= 10 ? 2 : 1;

  return distance <= threshold;
}

export function clusterCities(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const normalizedRows = [];
  let skipped = 0;

  for (const row of rows) {
    const city = normalizeCity(row?.city);

    if (!city) {
      skipped++;

      console.log(
        "[CITY CLUSTER] SKIPPED CITY:",
        JSON.stringify(row?.city),
        "count=",
        row?.count,
      );

      continue;
    }

    normalizedRows.push({
      city,
      count: Number(row?.count || 0),
    });
  }

  /*
   * Process high-volume values first.
   *
   * This makes the representative city deterministic and
   * prevents database row ordering from affecting clustering.
   */
  normalizedRows.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }

    return a.city.localeCompare(b.city);
  });

  const clusters = [];

  for (const row of normalizedRows) {
    /*
     * Exact normalized match first.
     */
    let match = clusters.find(
      (cluster) => cluster.city === row.city,
    );

    /*
     * Conservative fuzzy matching.
     *
     * IMPORTANT:
     * We intentionally do NOT use startsWith().
     *
     * Therefore:
     *
     * johannesburg
     * johannesburg south
     *
     * remain separate unless explicitly handled
     * by an alias.
     */
    if (!match) {
      match = clusters.find((cluster) =>
        isFuzzyCityMatch(row.city, cluster.city),
      );
    }

    /*
     * Create a new cluster if nothing matched.
     */
    if (!match) {
      match = {
        city: row.city,
        count: 0,
      };

      clusters.push(match);
    }

    match.count += row.count;
  }

  /*
   * Return highest-volume cities first.
   */
  clusters.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }

    return a.city.localeCompare(b.city);
  });

  console.log(
    `[CITY CLUSTER] Input rows: ${rows.length}, ` +
      `normalized rows: ${normalizedRows.length}, ` +
      `skipped: ${skipped}, ` +
      `clusters: ${clusters.length}`,
  );

  return clusters;
}