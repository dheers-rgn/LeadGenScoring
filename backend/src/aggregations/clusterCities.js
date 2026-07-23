import levenshtein from "fast-levenshtein";

function normalizeCity(city) {
  if (!city) return null;

  city = city.trim();
  if (/^\d+$/.test(city)) return null;
  if (city.includes("@")) return null;

  return city
    .toLowerCase()
    .replace(/\?/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function clusterCities(rows) {
  const clusters = [];
  const merged = {};

  let skipped = 0;

  for (const row of rows) {
    const norm = normalizeCity(row.city);

    if (!norm) {
      skipped++;
      continue;
    }

    let match = clusters.find(c => {
      const lenDiff = Math.abs(norm.length - c.length);

      if (lenDiff > 3) return false;

      const dist = levenshtein.get(norm, c);

      // Dynamic threshold: 15% of the longer string length, capped at max 3
      const pctThreshold = Math.floor(Math.max(norm.length, c.length) * 0.15);
      const threshold = Math.max(1, Math.min(pctThreshold, 3));

      return (
        dist <= threshold ||
        norm.startsWith(c + " ") ||
        c.startsWith(norm + " ")
      );
    });

    if (!match) {
      match = norm;
      clusters.push(match);
    }

    if (!merged[match]) {
      merged[match] = {
        city: match,
        count: 0,
      };
    }

    merged[match].count += Number(row.count || 0);
  }

  return Object.values(merged);
}