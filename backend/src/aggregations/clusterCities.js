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

//   for (const row of rows) {
//     if (JSON.stringify(row).toLowerCase().includes("yandev")) {
//     console.log("FOUND RAW ROW:", row);
//   }
//     const norm = normalizeCity(row.city);

//     if (!norm) {
//       skipped++;
//       console.log("SKIPPED VALUE:", row.city);
//       continue;
//     }

//     let match = clusters.find(c =>
//       levenshtein.get(norm, c) <= 2 ||
//       norm.startsWith(c + " ") ||
//       c.startsWith(norm + " ")
//     );

//     if (!match) {
//       match = norm;
//       clusters.push(match);
//     }

//     if (!merged[match]) {
//       merged[match] = {
//         city: match,
//         count: 0,
//       };
//     }

//     merged[match].count += Number(row.count || 0);
//   }

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

  const threshold = Math.max(1, Math.floor(Math.max(norm.length, c.length) * 0.15));

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