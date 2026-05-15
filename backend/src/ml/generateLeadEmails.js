const EMAIL_FEATURE_KEYS = ["city", "country", "course", "qualification", "study_mode"];
const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_BATCH_SIZE = 100;

/** dr_email_generation_status.code */
export const EMAIL_GEN_PENDING = 0;
export const EMAIL_GEN_TEMPLATE = 1;
export const EMAIL_GEN_BEDROCK = 2;
export const EMAIL_GEN_OTHER_FALLBACK = 3;

let isRunning = false;

function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseFirstName(fullName) {
  const clean = String(fullName || "").trim();
  if (!clean) return "there";
  const first = clean.split(/\s+/)[0];
  return first || "there";
}

function resolveBedrockModelId(env) {
  const direct = String(env.BEDROCK_MODEL_ID || env.BEDROCK_INFERENCE_PROFILE_ARN || env.BEDROCK_INFERENCE_PROFILE_ID || "")
    .trim();
  if (direct) return direct;
  return parseAvailableModelId(env.AVAILABLE_MODELS);
}

/** Safe snapshot for API / logs (no secrets). */
export function getBedrockEnvSnapshot(env = process.env) {
  const awsRegion = String(env.AWS_REGION || "").trim() || null;
  const resolvedModelId = resolveBedrockModelId(env) || null;
  return {
    awsRegion,
    resolvedModelId,
    explicitAwsKeysSet: Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
  };
}

export async function checkBedrockSdkLoadable() {
  try {
    await import("@aws-sdk/client-bedrock-runtime");
    return { sdkLoadable: true, error: null };
  } catch (e) {
    return { sdkLoadable: false, error: e?.message || String(e) };
  }
}

function parseAvailableModelId(rawValue) {
  if (rawValue == null) return "";
  const raw = String(rawValue).trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed.trim();
    if (parsed && typeof parsed === "object") {
      const first = Object.values(parsed).find((v) => typeof v === "string" && v.trim());
      if (first) return first.trim();
    }
  } catch {
    // ignore and fallback to non-JSON formats
  }
  const cleaned = raw;
  const eqIdx = cleaned.indexOf("=");
  if (eqIdx >= 0 && eqIdx < cleaned.length - 1) {
    return cleaned.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return cleaned;
}

function envNum(env, key) {
  const v = env[key];
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  return Number(s);
}

function parseTemperature(env) {
  const n = envNum(env, "BEDROCK_TEMPERATURE");
  if (Number.isFinite(n)) return n;
  return 0.3;
}

/**
 * Bedrock Converse maxTokens must be below model limits (e.g. Llama 3 70B instruct: 2048 max).
 * Env values with spaces around "=" often fail to load — we still default safely here.
 */
function parseMaxTokens(env) {
  const capRaw = envNum(env, "BEDROCK_MAX_TOKENS_CAP");
  const hardCap = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : 2047;
  const n = envNum(env, "BEDROCK_MAX_TOKENS");
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), hardCap);
  return Math.min(2000, hardCap);
}

function extractResponseText(result) {
  const blocks = result?.output?.message?.content || [];
  return blocks.map((b) => b?.text || "").join("\n").trim();
}

function hasText(v) {
  return v != null && String(v).trim().length > 0;
}

/** Internal only: drives wording variety without exposing numbers in copy. */
function inferStrength(p) {
  if (p == null || !Number.isFinite(Number(p))) return "neutral";
  const prob = Number(p) > 1 ? Number(p) / 100 : Number(p);
  if (prob >= 0.12) return "strong";
  if (prob >= 0.06) return "moderate";
  return "soft";
}

function buildFactorInferenceNarrative(factors, courseRaw) {
  const course = hasText(courseRaw) ? String(courseRaw).trim() : "this programme";
  const ec = escapeHtml(course);
  const parts = [];
  for (const f of factors) {
    if (!hasText(f.value)) continue;
    const v = escapeHtml(String(f.value).trim());
    const s = inferStrength(f.probability);
    if (f.feature === "city") {
      parts.push(
        s === "strong"
          ? `Among people from the city of <strong>${v}</strong>, we often meet motivated individuals who approach us to enrol and complete courses such as <strong>${ec}</strong>.`
          : `People from <strong>${v}</strong> frequently reach out to us when they are ready to explore a structured path toward <strong>${ec}</strong>.`,
      );
    } else if (f.feature === "country") {
      parts.push(
        s === "strong"
          ? `Among applicants from <strong>${v}</strong>, we see a steady stream of interest in moving from enquiry to enrolment for programmes like <strong>${ec}</strong>.`
          : `We regularly support candidates from <strong>${v}</strong> who want a clear route into <strong>${ec}</strong>.`,
      );
    } else if (f.feature === "course") {
      parts.push(
        `Our experience suggests that going for <strong>${v}</strong> can put you in a promising position to move forward when you stay engaged with the next steps.`,
      );
    } else if (f.feature === "qualification") {
      parts.push(
        s === "strong"
          ? `Candidates with a background like <strong>${v}</strong> often show strong adoption for taking <strong>${ec}</strong> and building on what they already know.`
          : `Your qualification path (<strong>${v}</strong>) pairs well with the demands of <strong>${ec}</strong> for learners who want to deepen their credentials.`,
      );
    } else if (f.feature === "study_mode") {
      parts.push(
        `Choosing <strong>${v}</strong> study works well for many applicants who need flexibility while still committing to <strong>${ec}</strong>.`,
      );
    }
  }
  if (!parts.length) return "";
  return `<p>${parts.join(" ")}</p>`;
}

function buildQualificationStudyModeParagraph(lead) {
  const q = hasText(lead.qualification) ? String(lead.qualification).trim() : "";
  const sm = hasText(lead.study_mode) ? String(lead.study_mode).trim() : "";
  if (!q && !sm) {
    return `<p>We can help you map the next practical steps for <strong>${escapeHtml(String(lead.course || "this programme").trim() || "this programme")}</strong> once we understand your preferred pace and schedule in a short follow-up.</p>`;
  }
  if (q && sm) {
    return `<p>Your background in <strong>${escapeHtml(q)}</strong> is a strong fit for this course, and the <strong>${escapeHtml(sm)}</strong> format can help you keep steady progress while balancing work and life.</p>`;
  }
  if (q) {
    return `<p>Your background in <strong>${escapeHtml(q)}</strong> is a strong foundation for this course and for the skills employers expect from graduates in this field.</p>`;
  }
  return `<p>The <strong>${escapeHtml(sm)}</strong> format can help you build momentum while balancing your schedule, which is especially helpful when you are ready to move quickly on applications and coursework.</p>`;
}

function fallbackEmailHtml(lead, factors) {
  const firstName = escapeHtml(parseFirstName(lead.name));
  const city = hasText(lead.city) ? String(lead.city).trim() : "";
  const country = hasText(lead.country) ? String(lead.country).trim() : "";
  const course = hasText(lead.course) ? String(lead.course).trim() : "this programme";
  const regionBits = [city, country].filter(Boolean).join(", ");
  const regionSentence = regionBits
    ? `Many applicants from <strong>${escapeHtml(regionBits)}</strong> pursue programmes like this, and we see strong engagement when they stay consistent through the application steps.`
    : `We see strong engagement from applicants who stay consistent through the application steps for programmes like this.`;

  const overallLine = hasText(lead.course)
    ? `<p>Our historical experience suggests that pursuing <strong>${escapeHtml(String(lead.course).trim())}</strong> can put you in a promising position to move forward when you take the next practical steps with us.</p>`
    : `<p>Our historical experience suggests you are in a promising position to move forward when you take the next practical steps with us.</p>`;

  const factorBlock = buildFactorInferenceNarrative(factors, lead.course);
  const qsBlock = buildQualificationStudyModeParagraph(lead);

  return `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1d1f">
  <p>Hi ${firstName},</p>
  <p>Great news — your profile shows strong potential for <strong>${escapeHtml(course)}</strong>.</p>
  <p>${regionSentence}</p>
  ${overallLine}
  ${factorBlock}
  ${qsBlock}
  <p>Graduates in this area continue to see solid demand across roles that value planning, delivery, and stakeholder communication — skills this course is designed to strengthen.</p>
  <p>Warm regards,<br/>Admissions Team</p>
</div>
`.trim();
}

async function columnExists(pool, tableName, columnName) {
  const [dbRows] = await pool.query(`SELECT DATABASE() AS db_name`);
  const dbName = dbRows[0]?.db_name;
  if (!dbName) return false;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = ?
       AND table_name = ?
       AND column_name = ?`,
    [dbName, tableName, columnName],
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function ensureEmailGenerationLookup(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dr_email_generation_status (
      code TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      label VARCHAR(96) NOT NULL,
      description VARCHAR(512) NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  const rows = [
    [EMAIL_GEN_PENDING, "Pending", "Not yet generated; eligible when conversion probability > threshold and latest model version"],
    [EMAIL_GEN_TEMPLATE, "Template", "Email HTML generated using the built-in template (Bedrock not used or not configured)"],
    [EMAIL_GEN_BEDROCK, "Bedrock", "Email HTML generated using the configured AWS Bedrock model"],
    [
      EMAIL_GEN_OTHER_FALLBACK,
      "Other fallback",
      "Bedrock was invoked but failed or returned empty; built-in template was used as fallback",
    ],
  ];
  for (const [code, label, description] of rows) {
    await pool.query(
      `INSERT INTO dr_email_generation_status (code, label, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description)`,
      [code, label, description],
    );
  }
}

async function ensureEmailHtmlColumn(pool) {
  const [dbRows] = await pool.query(`SELECT DATABASE() AS db_name`);
  const dbName = dbRows[0]?.db_name;
  if (!dbName) return;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = ?
       AND table_name = 'dr_training_leads'
       AND column_name = 'EmailHTML'`,
    [dbName],
  );
  if (Number(rows[0]?.c || 0) === 0) {
    await pool.query(`ALTER TABLE dr_training_leads ADD COLUMN EmailHTML LONGTEXT NULL`);
  }
}

/**
 * IsEmailGenerated (0–3) + migrate legacy IsMailGenerated; reset all to 0 when migrating from boolean column.
 */
async function ensureIsEmailGeneratedColumn(pool) {
  const hasNew = await columnExists(pool, "dr_training_leads", "IsEmailGenerated");
  const hasOld = await columnExists(pool, "dr_training_leads", "IsMailGenerated");

  if (!hasNew && hasOld) {
    await pool.query(
      `ALTER TABLE dr_training_leads ADD COLUMN IsEmailGenerated TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'dr_email_generation_status.code'`,
    );
    await pool.query(`UPDATE dr_training_leads SET IsEmailGenerated = 0`);
    await pool.query(`ALTER TABLE dr_training_leads DROP COLUMN IsMailGenerated`);
    return;
  }

  if (!hasNew) {
    await pool.query(
      `ALTER TABLE dr_training_leads ADD COLUMN IsEmailGenerated TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'dr_email_generation_status.code'`,
    );
    return;
  }

  if (hasOld) {
    await pool.query(`UPDATE dr_training_leads SET IsEmailGenerated = 0`);
    await pool.query(`ALTER TABLE dr_training_leads DROP COLUMN IsMailGenerated`);
  }
}

async function ensureEmailSchema(pool) {
  await ensureEmailGenerationLookup(pool);
  await ensureIsEmailGeneratedColumn(pool);
  await ensureEmailHtmlColumn(pool);
}

async function resolveLatestModelVersion(pool) {
  const [rows] = await pool.query(
    `SELECT model_version
     FROM dr_ml_conversion_params
     ORDER BY trained_at DESC
     LIMIT 1`,
  );
  if (!rows.length) {
    throw new Error("No rows in dr_ml_conversion_params; run build/score jobs first.");
  }
  return rows[0].model_version;
}

async function loadFeatureStatMaps(pool, modelVersion) {
  const [rows] = await pool.query(
    `SELECT feature_key, feature_value, score_logit, probability
     FROM dr_ml_conversion_params
     WHERE model_version = ?
       AND feature_key IN ('city','country','course','qualification','study_mode')
       AND (param_kind IS NULL OR param_kind = 'category')`,
    [modelVersion],
  );
  const maps = new Map();
  for (const key of EMAIL_FEATURE_KEYS) maps.set(key, new Map());
  for (const r of rows) {
    const fk = r.feature_key;
    const fv = norm(r.feature_value);
    if (!maps.has(fk) || !fv) continue;
    maps.get(fk).set(fv, {
      scoreLogit: Number(r.score_logit),
      probability: r.probability != null ? Number(r.probability) : null,
    });
  }
  return maps;
}

function getLeadFactors(lead, statMap) {
  const pairs = [
    { feature: "city", value: lead.city },
    { feature: "country", value: lead.country },
    { feature: "course", value: lead.course },
    { feature: "qualification", value: lead.qualification },
    { feature: "study_mode", value: lead.study_mode },
  ];
  return pairs.map((p) => {
    const hit = statMap.get(p.feature)?.get(norm(p.value));
    return {
      ...p,
      scoreLogit: hit && Number.isFinite(hit.scoreLogit) ? hit.scoreLogit : null,
      probability: hit && Number.isFinite(hit.probability) ? hit.probability : null,
    };
  });
}

/**
 * Qualitative hints for the writer only — do not quote these labels verbatim if they sound technical.
 * No percentages or counts (internal use only).
 */
function factorsForPrompt(factors) {
  return factors
    .filter((f) => hasText(f.value))
    .map((f) => ({
      aspect: f.feature,
      value: String(f.value).trim(),
      pattern_note: inferStrength(f.probability),
    }));
}

function overallFitBand(lead) {
  const p = lead.conversion_probability;
  if (p == null || !Number.isFinite(Number(p))) return "unknown";
  const prob = Number(p) > 1 ? Number(p) / 100 : Number(p);
  if (prob >= 0.5) return "strong";
  if (prob >= 0.25) return "encouraging";
  return "moderate";
}

function buildPrompt(lead, factors) {
  const firstName = parseFirstName(lead.name);
  const fp = factorsForPrompt(factors);
  const fit = overallFitBand(lead);

  const lines = [
    "Generate a concise motivational email body in valid HTML only (no markdown code fences).",
    "Tone: positive, personalized, practical, and professional.",
    "About 180–260 words.",
    `Greet the reader by first name: ${firstName}.`,
    "CRITICAL style rules for the email body (must follow):",
    '- Do NOT use the words "lead" or "leads" (use people, applicants, candidates, or similar).',
    "- Do not echo internal JSON field names or band labels (such as pattern_note values) as technical wording in the email.",
    '- Do NOT use the words "model", "training data", "dataset", "conversion", "probability", "percentage", "%", or any numeric statistics or rates.',
    "- Do NOT present numerical analysis, charts, or bullet lists of metrics.",
    "- Write qualitative inferences only: warm, motivating reasons the reader fits the course and region, similar to admissions counselling.",
    "Examples of acceptable phrasing (adapt to the profile JSON, do not copy verbatim if details differ):",
    '- "Our historical experience suggests going for [course] will put you in a promising position to move forward."',
    '- "Among people from the city of [city], we often meet motivated individuals who approach us to enrol and complete our courses."',
    '- "[Country] applicants with [qualification] often show strong interest in taking [course]."',
    "Content requirements:",
    "- Mention regional and course fit when city/country/course are present in the profile JSON.",
    "- Mention realistic career relevance for the course area without guaranteed outcomes.",
    "- If qualification is present, relate it naturally to the course; if empty, do not invent one and avoid placeholder phrasing.",
    "- If study_mode is present, explain practical benefits of that mode; if empty, omit study-mode-specific claims.",
    "- Use full sentences and short paragraphs only (no bullet lists of factors).",
    "Internal context (do not mention these terms in the email): overall_fit_band is a rough qualitative hint only:",
    fit,
    "Profile JSON (values only; use for personalization — never restate as data analysis):",
    JSON.stringify(
      {
        firstName,
        city: lead.city || "",
        country: lead.country || "",
        course: lead.course || "",
        qualification: lead.qualification || "",
        study_mode: lead.study_mode || "",
        profile_aspects: fp,
      },
      null,
      2,
    ),
  ];
  return lines.join("\n");
}

async function tryBedrockHtml(env, prompt) {
  const snap = getBedrockEnvSnapshot(env);
  let BedrockRuntimeClient;
  let ConverseCommand;
  try {
    const sdk = await import("@aws-sdk/client-bedrock-runtime");
    BedrockRuntimeClient = sdk.BedrockRuntimeClient;
    ConverseCommand = sdk.ConverseCommand;
  } catch (e) {
    return {
      ok: false,
      html: "",
      attempted: false,
      error: "sdk_missing",
      errorDetail: e?.message || String(e),
      meta: { ...snap, sdkLoaded: false },
    };
  }

  const region = String(env.AWS_REGION || "").trim();
  const modelId = resolveBedrockModelId(env);
  if (!region || !modelId) {
    return {
      ok: false,
      html: "",
      attempted: false,
      error: "missing_region_or_model",
      errorDetail: !region ? "AWS_REGION is empty" : "BEDROCK_MODEL_ID and AVAILABLE_MODELS did not yield a model id",
      meta: { ...snap, sdkLoaded: true },
    };
  }

  const client = new BedrockRuntimeClient({
    region,
    credentials:
      env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

  const command = new ConverseCommand({
    modelId,
    inferenceConfig: {
      temperature: parseTemperature(env),
      maxTokens: parseMaxTokens(env),
    },
    messages: [{ role: "user", content: [{ text: prompt }] }],
  });
  try {
    const result = await client.send(command);
    const html = extractResponseText(result);
    if (!html) {
      return {
        ok: false,
        html: "",
        attempted: true,
        error: "empty_response",
        errorDetail: "Model returned no text content blocks",
        meta: { ...snap, sdkLoaded: true },
      };
    }
    return { ok: true, html, attempted: true, error: null, errorDetail: null, meta: { ...snap, sdkLoaded: true } };
  } catch (e) {
    return {
      ok: false,
      html: "",
      attempted: true,
      error: "bedrock_invoke_failed",
      errorDetail: e?.message || String(e),
      meta: { ...snap, sdkLoaded: true },
    };
  }
}

function bedrockOutcomeKey(bedrock) {
  if (bedrock.ok) return "bedrock_ok";
  if (!bedrock.attempted) return bedrock.error || "not_attempted";
  return bedrock.error || "bedrock_failed";
}

const IS_EMAIL_GENERATED_LEGEND = {
  0: "Pending — eligible for generation when conversion_probability > threshold and scored_model_version matches latest",
  1: "Template — Bedrock was not invoked (missing SDK, region/model, or configuration)",
  2: "Bedrock — HTML produced by configured Bedrock model",
  3: "Other fallback — Bedrock was invoked but failed or returned empty; template HTML was used",
};

export async function generateLeadEmails(pool, env = process.env, options = {}) {
  if (isRunning) {
    return {
      skipped: true,
      reason: "Already running",
      bedrockDiagnostics: { environment: getBedrockEnvSnapshot(env) },
    };
  }
  isRunning = true;
  try {
    await ensureEmailSchema(pool);
    const modelVersion = await resolveLatestModelVersion(pool);
    const threshold = Number(options.threshold ?? DEFAULT_THRESHOLD);
    const batchSize = Math.min(Math.max(Number(options.batchSize) || DEFAULT_BATCH_SIZE, 1), 1000);
    const dryRun = Boolean(options.dryRun);
    const statMap = await loadFeatureStatMaps(pool, modelVersion);

    const [leads] = await pool.query(
      `SELECT id, name, email, city, country, course, qualification, study_mode, conversion_probability
       FROM dr_training_leads
       WHERE conversion_probability > ?
         AND COALESCE(IsEmailGenerated, 0) = 0
         AND scored_model_version = ?
       ORDER BY conversion_probability DESC, id DESC
       LIMIT ?`,
      [threshold, modelVersion, batchSize],
    );

    let processed = 0;
    let generatedByBedrock = 0;
    let generatedByTemplate = 0;
    let generatedByOtherFallback = 0;
    const preview = [];
    const failureReasonHistogram = {};
    let firstBedrockFailure = null;

    for (const lead of leads) {
      const factors = getLeadFactors(lead, statMap);
      const prompt = buildPrompt(lead, factors);

      let emailHtml = "";
      let statusCode = EMAIL_GEN_TEMPLATE;

      const bedrock = await tryBedrockHtml(env, prompt);
      const outcomeKey = bedrockOutcomeKey(bedrock);
      failureReasonHistogram[outcomeKey] = (failureReasonHistogram[outcomeKey] || 0) + 1;
      if (bedrock.attempted && !bedrock.ok && !firstBedrockFailure) {
        firstBedrockFailure = {
          leadId: lead.id,
          error: bedrock.error,
          errorDetail: bedrock.errorDetail || null,
        };
      }

      if (bedrock.ok && bedrock.html) {
        emailHtml = bedrock.html;
        statusCode = EMAIL_GEN_BEDROCK;
        generatedByBedrock += 1;
      } else {
        emailHtml = fallbackEmailHtml(lead, factors);
        if (bedrock.attempted) {
          statusCode = EMAIL_GEN_OTHER_FALLBACK;
          generatedByOtherFallback += 1;
        } else {
          statusCode = EMAIL_GEN_TEMPLATE;
          generatedByTemplate += 1;
        }
      }

      preview.push({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        conversion_probability: lead.conversion_probability,
        factors,
        emailHtml,
        IsEmailGenerated: statusCode,
        bedrock: {
          attempted: bedrock.attempted,
          ok: bedrock.ok,
          error: bedrock.error || null,
          errorDetail: bedrock.errorDetail || null,
          meta: bedrock.meta || null,
        },
      });

      if (!dryRun) {
        await pool.query(
          `UPDATE dr_training_leads
           SET IsEmailGenerated = ?, EmailHTML = ?
           WHERE id = ?`,
          [statusCode, emailHtml, lead.id],
        );
      }
      processed += 1;
    }

    return {
      skipped: false,
      dryRun,
      modelVersion,
      threshold,
      selected: leads.length,
      processed,
      generatedByBedrock,
      generatedByTemplate,
      generatedByOtherFallback,
      isEmailGeneratedLegend: IS_EMAIL_GENERATED_LEGEND,
      bedrockDiagnostics: {
        environment: getBedrockEnvSnapshot(env),
        failureReasonHistogram,
        firstBedrockFailure,
        hint:
          generatedByBedrock === 0 && leads.length > 0
            ? "No rows used Bedrock. If IsEmailGenerated is 1, check SDK install and AWS_REGION/BEDROCK_MODEL_ID. If it is 3, see firstBedrockFailure and errorDetail on each preview row."
            : null,
      },
      preview: dryRun ? preview : undefined,
    };
  } finally {
    isRunning = false;
  }
}

export function startLeadEmailScheduler(pool, env = process.env) {
  const everyMinutes = Math.max(1, Number(env.LEAD_MAIL_SCHEDULE_MINUTES) || 60);
  const intervalMs = everyMinutes * 60 * 1000;

  const run = async () => {
    try {
      await generateLeadEmails(pool, env);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Lead email scheduler failed:", e?.message || String(e));
    }
  };

  setTimeout(run, 10_000);
  const timer = setInterval(run, intervalMs);
  return timer;
}
