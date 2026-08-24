const PROFILE_FEATURE_KEYS = ["city", "country", "course", "qualification", "study_mode"];
const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_BATCH_SIZE = 100;

/** dr_profile_generation_status.code (mirrors dr_email_generation_status codes) */
export const PROFILE_GEN_PENDING = 0;
export const PROFILE_GEN_TEMPLATE = 1;
export const PROFILE_GEN_BEDROCK = 2;
export const PROFILE_GEN_OTHER_FALLBACK = 3;

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

/**
 * Fallback template that generates a plain-text summary and 5 targeting Q&A pairs
 * when Bedrock is not available.
 */
function fallbackProfileContent(lead, factors) {
  const firstName = escapeHtml(parseFirstName(lead.name));
  const city = hasText(lead.city) ? String(lead.city).trim() : "";
  const country = hasText(lead.country) ? String(lead.country).trim() : "";
  const course = hasText(lead.course) ? String(lead.course).trim() : "a programme";
  const qualification = hasText(lead.qualification) ? String(lead.qualification).trim() : "";
  const studyMode = hasText(lead.study_mode) ? String(lead.study_mode).trim() : "";
  const regionBits = [city, country].filter(Boolean).join(", ");

  // Build summary
  const summaryParts = [];
  summaryParts.push(`${firstName} is a prospective learner interested in ${escapeHtml(course)}.`);
  if (regionBits) {
    summaryParts.push(`They are based in ${escapeHtml(regionBits)}.`);
  }
  if (qualification) {
    summaryParts.push(`Their educational background includes ${escapeHtml(qualification)}.`);
  }
  if (studyMode) {
    summaryParts.push(`They prefer a ${escapeHtml(studyMode)} study format.`);
  }
  const factorBlock = buildFactorInferenceNarrative(factors, lead.course);
  if (factorBlock) {
    summaryParts.push(`Profile insights: ${factorBlock.replace(/<\/?p>/g, "").replace(/<\/?strong>/g, "")}`);
  }
  const summary = summaryParts.join(" ");

  // Escaped profile values used to personalise the targeting questions.
  const ec = escapeHtml(course);
  const eqq = hasText(qualification) ? escapeHtml(qualification) : "";
  const esm = hasText(studyMode) ? escapeHtml(studyMode) : "";
  const er = regionBits ? escapeHtml(regionBits) : "";
  const ecntry = hasText(country) ? escapeHtml(country) : "";
  const ecity = hasText(city) ? escapeHtml(city) : "";

  // Build 5 quality targeting Q&A pairs (question + suggested answer guard), each
  // personalised to the applicant's actual qualification, study mode, and location.
  const questions = [];
  questions.push({
    question: eqq
      ? `How do you hope completing ${ec} will build directly on your background in ${eqq}, and what career step are you aiming for next?`
      : `What career goal or outcome would you most want ${ec} to unlock, and what timeline are you working toward?`,
    answer: eqq
      ? `A direct link between their existing ${eqq} experience and the course outcome signals a realistic, ready-to-act candidate. If they describe a concrete next role or promotion, urgency is high.`
      : `Listen for a specific target role (career change, promotion, or new skill) and a rough start date. A named goal plus a deadline points to genuine intent to enrol.`,
  });

  questions.push({
    question: eqq
      ? `Which parts of your ${eqq} background do you feel are most relevant to ${ec}, and where do you see the biggest gap you want this course to close?`
      : `What prior experience or self-driven learning do you already have that relates to ${ec}, and what gap do you most want to fill?`,
    answer: eqq
      ? `Look for how far their qualification already covers the course content. The clearer they are about a gap, the more specific your follow-up can be on how the course bridges it.`
      : `Relevant work history, projects, or self-study makes early progress easier. Probe how close they already are so you can show an achievable path through the course.`,
  });

  questions.push({
    question: esm
      ? `With a ${esm} study format in mind, what schedule or outside commitments might make it harder for you to begin ${ec} soon?`
      : `What work, family, or study commitments could affect when you would realistically start and finish ${ec}?`,
    answer: esm
      ? `Probe for workload and timetable fit. A clear, practical schedule for a ${esm} format signals they can keep momentum; flag any stated conflict as the main obstacle to a start date.`
      : `Surface the practical blockers. Naming the single biggest constraint early gives the advisor a concrete objection to address before asking for commitment.`,
  });

  questions.push({
    question: ecntry || ecity
      ? `How do you picture using ${ec} to open up opportunities where you are based${er ? ` in ${er}` : ""}?`
      : `What does your longer-term plan look like, and how does ${ec} support the next move you want to make?`,
    answer: ecntry || ecity
      ? `A local, concrete link between the course and real roles in their area indicates follow-through intent. Ask what a successful outcome would look like for them there.`
      : `Probe for the specific next step they want and how the course fits it. A clear plan of action is a strong sign they will convert.`,
  });

  questions.push({
    question: esm
      ? `What support or guidance would help you feel confident committing to a ${esm} pace of ${ec}, and what is the main decision left before you enrol?`
      : `What support or guidance would help you feel confident enrolling in ${ec}, and what is the main decision still on your mind?`,
    answer: esm
      ? `What they ask for reveals the remaining friction. Confirm the study schedule, who they can reach for help, and a named next step with a point of contact to move them to enrolment.`
      : `Their requested help identifies what would remove the last obstacle. Set a clear next step, confirm preferred contact, and assign a named point of contact.`,
  });

  return {
    summary,
    questions,
  };
}


function buildPrompt(lead, factors) {
  const firstName = parseFirstName(lead.name);
  const fp = factorsForPrompt(factors);
  const fit = overallFitBand(lead);

  const lines = [
    "You are an admissions advisor. Given the following lead profile, produce two sections in valid JSON only (no markdown code fences, no extra commentary).",
    "",
    'Section 1 \u2014 "summary": A concise natural-language profile summary (2\u20133 paragraphs) describing who this person is, their background, what they are looking for, and key observations about their fit for the course. Do NOT use the words "lead" or "leads". Use "applicant", "candidate", "learner", or similar. Do NOT mention model, training data, probability, percentage, or any numeric statistics.',
    "",
    'Section 2 \u2014 "questions": An array of exactly 5 thoughtful, open-ended targeting question-and-answer pairs an admissions advisor would use to qualify this applicant. Each item is a JSON object with a "question" (the exact question to ask) and an "answer" (a short suggested/expected response guide describing what a strong applicant reply reveals and how the advisor should read it). The questions must be specific to the applicant\u2019s profile (course, location, background, study mode) and focus on the highest-value signals: motivation, urgency, readiness, and constraints. Do not use generic questions.',
    "",
    "CRITICAL formatting rules:",
    'Output ONLY a JSON object with keys "summary" (string) and "questions" (array of exactly 5 objects, each with a "question" string and an "answer" string).',
    "The 'answer' for each question is the suggested/expected response guide for the advisor: what a strong applicant response would reveal about motivation, timeline, urgency, readiness, or constraints, and what to probe next. Keep every answer short (1\u20133 sentences) and plain text.",
    "Do NOT wrap in markdown code fences or any other formatting.",
    "Do NOT include any text before or after the JSON object.",
    "The summary must be plain text (no HTML).",
    "Each question must be a complete, specific sentence ending with a question mark.",
    "",
    "Internal context (do not mention these terms in the output): overall_fit_band is a rough qualitative hint only:",
    fit,
    "",
    "Profile JSON (values only; use for personalization \u2014 never restate as data analysis):",
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

async function ensureProfileGenerationLookup(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dr_profile_generation_status (
      code TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      label VARCHAR(96) NOT NULL,
      description VARCHAR(512) NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  const rows = [
    [PROFILE_GEN_PENDING, "Pending", "Not yet generated; eligible when conversion probability > threshold and latest model version"],
    [PROFILE_GEN_TEMPLATE, "Template", "Profile summary and questions generated using the built-in template (Bedrock not used or not configured)"],
    [PROFILE_GEN_BEDROCK, "Bedrock", "Profile summary and questions generated using the configured AWS Bedrock model"],
    [
      PROFILE_GEN_OTHER_FALLBACK,
      "Other fallback",
      "Bedrock was invoked but failed or returned empty; built-in template was used as fallback",
    ],
  ];
  for (const [code, label, description] of rows) {
    await pool.query(
      `INSERT INTO dr_profile_generation_status (code, label, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description)`,
      [code, label, description],
    );
  }
}

async function ensureProfileColumns(pool) {
  const [dbRows] = await pool.query(`SELECT DATABASE() AS db_name`);
  const dbName = dbRows[0]?.db_name;
  if (!dbName) return;

  const ensureColumn = async (name, ddl) => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM information_schema.columns
       WHERE table_schema = ?
         AND table_name = 'dr_training_leads'
         AND column_name = ?`,
      [dbName, name],
    );
    if (Number(rows[0]?.c || 0) === 0) {
      await pool.query(`ALTER TABLE dr_training_leads ADD COLUMN ${ddl}`);
    }
  };

  await ensureColumn(
    "ProfileSummary",
    "ProfileSummary TEXT NULL COMMENT 'natural-language summary of the lead profile generated by Bedrock or template'",
  );
  await ensureColumn(
    "TargetingQuestions",
    "TargetingQuestions TEXT NULL COMMENT 'JSON array of 5 targeting question-and-answer pairs generated by Bedrock or template'",
  );
  await ensureColumn(
    "IsProfileGenerated",
    "IsProfileGenerated TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'dr_profile_generation_status.code: 0 pending, 1 template, 2 bedrock, 3 other fallback'",
  );
}

async function ensureProfileSchema(pool) {
  await ensureProfileGenerationLookup(pool);
  await ensureProfileColumns(pool);
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
  for (const key of PROFILE_FEATURE_KEYS) maps.set(key, new Map());
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

async function tryBedrockProfile(env, prompt) {
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
      content: null,
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
      content: null,
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
    const rawText = extractResponseText(result);
    if (!rawText) {
      return {
        ok: false,
        content: null,
        attempted: true,
        error: "empty_response",
        errorDetail: "Model returned no text content blocks",
        meta: { ...snap, sdkLoaded: true },
      };
    }

    // Parse the JSON response
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from the response if it has extra wrapping
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          return {
            ok: false,
            content: null,
            attempted: true,
            error: "parse_failed",
            errorDetail: "Response was not valid JSON after extraction attempt",
            meta: { ...snap, sdkLoaded: true },
          };
        }
      } else {
        return {
          ok: false,
          content: null,
          attempted: true,
          error: "parse_failed",
          errorDetail: "Response was not valid JSON and no JSON object found",
          meta: { ...snap, sdkLoaded: true },
        };
      }
    }

    if (!parsed.summary || typeof parsed.summary !== "string") {
      return {
        ok: false,
        content: null,
        attempted: true,
        error: "invalid_structure",
        errorDetail: "Response JSON missing 'summary' string field",
        meta: { ...snap, sdkLoaded: true },
      };
    }
    if (!Array.isArray(parsed.questions) || parsed.questions.length !== 5) {
      return {
        ok: false,
        content: null,
        attempted: true,
        error: "invalid_structure",
        errorDetail: `Response JSON 'questions' must be an array of exactly 5 items, got ${parsed.questions?.length ?? 0}`,
        meta: { ...snap, sdkLoaded: true },
      };
    }
    if (
      !parsed.questions.every(
        (item) =>
          item &&
          typeof item.question === "string" &&
          item.question.trim() &&
          typeof item.answer === "string" &&
          item.answer.trim(),
      )
    ) {
      return {
        ok: false,
        content: null,
        attempted: true,
        error: "invalid_structure",
        errorDetail:
          "Response JSON 'questions' items must be objects with non-empty 'question' and 'answer' string fields",
        meta: { ...snap, sdkLoaded: true },
      };
    }

    return {
      ok: true,
      content: { summary: parsed.summary, questions: parsed.questions },
      attempted: true,
      error: null,
      errorDetail: null,
      meta: { ...snap, sdkLoaded: true },
    };
  } catch (e) {
    return {
      ok: false,
      content: null,
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

const IS_PROFILE_GENERATED_LEGEND = {
  0: "Pending \u2014 eligible for generation when conversion_probability > threshold and scored_model_version matches latest",
  1: "Template \u2014 Bedrock was not invoked (missing SDK, region/model, or configuration)",
  2: "Bedrock \u2014 Profile summary and questions produced by configured Bedrock model",
  3: "Other fallback \u2014 Bedrock was invoked but failed or returned empty; template content was used",
};

export async function generateLeadProfiles(pool, env = process.env, options = {}) {
  if (isRunning) {
    return {
      skipped: true,
      reason: "Already running",
      bedrockDiagnostics: { environment: getBedrockEnvSnapshot(env) },
    };
  }
  isRunning = true;
  try {
    await ensureProfileSchema(pool);
    const modelVersion = await resolveLatestModelVersion(pool);
    const threshold = Number(options.threshold ?? DEFAULT_THRESHOLD);
    const batchSize = Math.min(Math.max(Number(options.batchSize) || DEFAULT_BATCH_SIZE, 1), 1000);
    const dryRun = Boolean(options.dryRun);
    const statMap = await loadFeatureStatMaps(pool, modelVersion);

    const [leads] = await pool.query(
      `SELECT id, name, email, city, country, course, qualification, study_mode, conversion_probability
       FROM dr_training_leads
       WHERE conversion_probability > ?
         AND COALESCE(IsProfileGenerated, 0) = 0
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

      let profileSummary = "";
      let targetingQuestions = "[]";
      let statusCode = PROFILE_GEN_TEMPLATE;

      const bedrock = await tryBedrockProfile(env, prompt);
      const outcomeKey = bedrockOutcomeKey(bedrock);
      failureReasonHistogram[outcomeKey] = (failureReasonHistogram[outcomeKey] || 0) + 1;
      if (bedrock.attempted && !bedrock.ok && !firstBedrockFailure) {
        firstBedrockFailure = {
          leadId: lead.id,
          error: bedrock.error,
          errorDetail: bedrock.errorDetail || null,
        };
      }

      if (bedrock.ok && bedrock.content) {
        profileSummary = bedrock.content.summary;
        targetingQuestions = JSON.stringify(bedrock.content.questions);
        statusCode = PROFILE_GEN_BEDROCK;
        generatedByBedrock += 1;
      } else {
        const fallback = fallbackProfileContent(lead, factors);
        profileSummary = fallback.summary;
        targetingQuestions = JSON.stringify(fallback.questions);
        if (bedrock.attempted) {
          statusCode = PROFILE_GEN_OTHER_FALLBACK;
          generatedByOtherFallback += 1;
        } else {
          statusCode = PROFILE_GEN_TEMPLATE;
          generatedByTemplate += 1;
        }
      }

      preview.push({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        conversion_probability: lead.conversion_probability,
        factors,
        profileSummary,
        targetingQuestions,
        IsProfileGenerated: statusCode,
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
           SET IsProfileGenerated = ?, ProfileSummary = ?, TargetingQuestions = ?
           WHERE id = ?`,
          [statusCode, profileSummary, targetingQuestions, lead.id],
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
      isProfileGeneratedLegend: IS_PROFILE_GENERATED_LEGEND,
      bedrockDiagnostics: {
        environment: getBedrockEnvSnapshot(env),
        failureReasonHistogram,
        firstBedrockFailure,
        hint:
          generatedByBedrock === 0 && leads.length > 0
            ? "No rows used Bedrock. If IsProfileGenerated is 1, check SDK install and AWS_REGION/BEDROCK_MODEL_ID. If it is 3, see firstBedrockFailure and errorDetail on each preview row."
            : null,
      },
      preview: dryRun ? preview : undefined,
    };
  } finally {
    isRunning = false;
  }
}

export function startLeadProfileScheduler(pool, env = process.env) {
  const everyMinutes = Math.max(1, Number(env.LEAD_PROFILE_SCHEDULE_MINUTES) || 60);
  const intervalMs = everyMinutes * 60 * 1000;

  const run = async () => {
    try {
      await generateLeadProfiles(pool, env);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Lead profile scheduler failed:", e?.message || String(e));
    }
  };

  setTimeout(run, 10_000);
  const timer = setInterval(run, intervalMs);
  return timer;
}