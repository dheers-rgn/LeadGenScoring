import ExcelJS from "exceljs";

function toSnakeCase(input) {
  const s = String(input ?? "")
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return s || "unnamed";
}

function disambiguateName(base, used) {
  let name = base;
  let i = 2;
  while (used.has(name)) {
    name = `${base}_${i}`;
    i += 1;
  }
  used.add(name);
  return name;
}

function isPercentFormattedCell(cell) {
  const numFmt = cell?.numFmt ?? cell?.style?.numFmt;
  if (typeof numFmt === "string" && numFmt.includes("%")) return true;
  return false;
}

function cellToDbValue(cell) {
  if (!cell) return null;
  const text = typeof cell.text === "string" ? cell.text.trim() : "";
  if (text) return text;

  const v = cell.value;
  if (v == null) return null;

  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }

  // exceljs may return rich objects (formula, hyperlink, etc.)
  try {
    const s = JSON.stringify(v);
    return s && s !== "{}" ? s : null;
  } catch {
    return String(v);
  }
}

async function loadWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return wb;
}

async function ensureTable(pool, tableName, columns) {
  const colDefs = columns.map((c) => `\`${c}\` TEXT NULL`).join(", ");
  const sql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${colDefs}) CHARACTER SET utf8mb4`;
  await pool.query(sql);
}

async function truncateTable(pool, tableName) {
  await pool.query(`TRUNCATE TABLE \`${tableName}\``);
}

async function insertRows(pool, tableName, columns, rows, chunkSize = 500) {
  if (!rows.length) return 0;
  const colSql = columns.map((c) => `\`${c}\``).join(", ");
  let inserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const valuesSql = chunk
      .map(() => `(${columns.map(() => "?").join(",")})`)
      .join(", ");
    const flat = chunk.flat();
    await pool.query(`INSERT INTO \`${tableName}\` (${colSql}) VALUES ${valuesSql}`, flat);
    inserted += chunk.length;
  }
  return inserted;
}

function getHeaderRow(worksheet) {
  const row = worksheet.getRow(1);
  return row;
}

function buildColumnPlan(worksheet, maxScanRows = 200) {
  const headerRow = getHeaderRow(worksheet);
  const maxCol = Math.max(worksheet.actualColumnCount || 0, headerRow.cellCount || 0);
  if (maxCol <= 0) return null;

  const usedColNames = new Set();
  const plan = [];

  for (let col = 1; col <= maxCol; col += 1) {
    const headerCell = headerRow.getCell(col);
    const headerText = (headerCell?.text ?? headerCell?.value ?? "").toString().trim();
    const baseName = headerText ? toSnakeCase(headerText) : `col_${col}`;
    const colName = disambiguateName(baseName, usedColNames);

    let isPercentCol = false;
    const scanTo = Math.min(worksheet.actualRowCount || 0, maxScanRows);
    for (let r = 2; r <= scanTo; r += 1) {
      const cell = worksheet.getRow(r).getCell(col);
      if (isPercentFormattedCell(cell)) {
        isPercentCol = true;
        break;
      }
    }

    plan.push({ colIndex: col, colName, include: !isPercentCol });
  }

  const included = plan.filter((p) => p.include);
  if (!included.length) return null;
  return { plan, included };
}

async function importWorksheetToTable({ pool, worksheet, tableName }) {
  const colPlan = buildColumnPlan(worksheet);
  if (!colPlan) {
    return { tableName, rowsInserted: 0, reason: "no_columns" };
  }

  const included = colPlan.included;
  const columns = included.map((p) => p.colName);

  await ensureTable(pool, tableName, columns);
  await truncateTable(pool, tableName);

  const rows = [];
  const lastRow = worksheet.actualRowCount || 0;
  for (let r = 2; r <= lastRow; r += 1) {
    const row = worksheet.getRow(r);
    if (!row || row.cellCount === 0) continue;

    const record = included.map((p) => cellToDbValue(row.getCell(p.colIndex)));
    const allNull = record.every((v) => v == null || v === "");
    if (allNull) continue;
    rows.push(record);
  }

  const rowsInserted = await insertRows(pool, tableName, columns, rows);
  return { tableName, rowsInserted };
}

export async function importWorkbook({ pool, filePath, tablePrefix }) {
  const wb = await loadWorkbook(filePath);
  const usedTableNames = new Set();
  const results = [];

  for (const ws of wb.worksheets) {
    const base = `${tablePrefix}${toSnakeCase(ws.name)}`;
    const tableName = disambiguateName(base, usedTableNames);
    const r = await importWorksheetToTable({ pool, worksheet: ws, tableName });
    results.push({ sheet: ws.name, ...r });
  }

  return results;
}

export async function runFullImport({ pool, allExcelPath, convExcelPath }) {
  const all = await importWorkbook({
    pool,
    filePath: allExcelPath,
    tablePrefix: "dr_all_",
  });
  const conv = await importWorkbook({
    pool,
    filePath: convExcelPath,
    tablePrefix: "dr_conv_",
  });
  return { all, conv };
}

