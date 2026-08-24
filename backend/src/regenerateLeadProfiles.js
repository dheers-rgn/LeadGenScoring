import "dotenv/config";
import { createPool } from "./db.js";
import { generateLeadProfiles } from "./ml/generateLeadProfile.js";

/**
 * One-off maintenance CLI to regenerate already-generated lead profiles so
 * they pick up the current template / Bedrock output format (5 Q&A pairs).
 *
 * Usage:
 *   npm run regenerate:profiles -- --limit=100 --threshold=0.2
 *
 * It:
 *   1. Resets IsProfileGenerated -> 0 for the N highest-value generated leads.
 *   2. Re-runs generateLeadProfiles, which rewrites ProfileSummary +
 *      TargetingQuestions in the current format and re-flags the status code.
 */
function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
}

async function main() {
  const limitRaw = arg("limit", "100");
  const all = limitRaw.toLowerCase() === "all";
  const limit = all ? null : Math.max(1, Number(limitRaw) || 100);
  const threshold = Number(arg("threshold", "0.2"));

  const pool = createPool(process.env);
  try {
    // Pick the highest-value leads that already have a profile so we rewrite
    // them in the current Q&A format instead of leaving old 10-string rows.
    const [rows] = all
      ? await pool.query(
          `SELECT id
           FROM dr_training_leads
           WHERE COALESCE(IsProfileGenerated, 0) > 0
           ORDER BY conversion_probability DESC, id DESC`,
        )
      : await pool.query(
          `SELECT id
           FROM dr_training_leads
           WHERE COALESCE(IsProfileGenerated, 0) > 0
           ORDER BY conversion_probability DESC, id DESC
           LIMIT ?`,
          [limit],
        );
    const ids = rows.map((r) => r.id);
    let reset = 0;
    if (ids.length) {
      await pool.query(
        `UPDATE dr_training_leads
         SET IsProfileGenerated = 0
         WHERE id IN (?)`,
        [ids],
      );
      reset = ids.length;
      // eslint-disable-next-line no-console
      console.log(`Reset ${reset} lead(s) to pending; regenerating...`);
    } else {
      // eslint-disable-next-line no-console
      console.log("No generated profiles found to reset. Running generation for pending leads.");
    }

    // Run generation for all just-pending rows (no batch cap) in one pass.
    const result = await generateLeadProfiles(pool, process.env, {
      threshold,
      batchSize: all ? Math.max(1, reset) : limit,
    });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          reset,
          ...result,
          note: "If generatedByTemplate > 0 and Bedrock not configured, answers come from the built-in template.",
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});