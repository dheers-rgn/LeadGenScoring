import ExcelJS from "exceljs";
import mysql from "mysql2/promise";

function toSnakeCase(input) {
  const s = String(input ?? "")
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return s || "unnamed";
}

function isPercentFormattedCell(cell) {
  const numFmt = cell?.numFmt ?? cell?.style?.numFmt;
  return typeof numFmt === "string" && numFmt.includes("%");
}

function cellToDbValue(cell) {
  if (!cell) return null;
  const text = typeof cell.text === "string" ? cell.text.trim() : "";
  if (text) return text;
  const v = cell.value;
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v.trim() || null;
  try {
    const s = JSON.stringify(v);
    return s && s !== "{}" ? s : null;
  } catch {
    return String(v);
  }
}

async function main() {
  const filePath = process.env.ALL_EXCEL_PATH || "/docs/Leads_analysis.xlsx";
  const tableName = "dr_all_country_course";
  const sheetName = "Country_Course";
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet not found: ${sheetName}`);

  const headerRow = ws.getRow(1);
  const maxCol = Math.max(ws.actualColumnCount || 0, headerRow.cellCount || 0);
  const used = new Set();
  const plan = [];
  for (let c = 1; c <= maxCol; c += 1) {
    const headerText = (headerRow.getCell(c).text || headerRow.getCell(c).value || "")
      .toString()
      .trim();
    let base = headerText ? toSnakeCase(headerText) : `col_${c}`;
    let col = base;
    let i = 2;
    while (used.has(col)) {
      col = `${base}_${i}`;
      i += 1;
    }
    used.add(col);

    let percent = false;
    for (let r = 2; r <= Math.min(ws.actualRowCount || 0, 500); r += 1) {
      if (isPercentFormattedCell(ws.getRow(r).getCell(c))) {
        percent = true;
        break;
      }
    }
    if (!percent) plan.push({ colIndex: c, colName: col });
  }

  const rows = [];
  for (let r = 2; r <= (ws.actualRowCount || 0); r += 1) {
    const row = ws.getRow(r);
    const rec = plan.map((p) => cellToDbValue(row.getCell(p.colIndex)));
    if (rec.some((v) => v != null && v !== "")) rows.push(rec);
  }

  const conn = await mysql.createConnection(databaseUrl);
  try {
    await conn.query(`TRUNCATE TABLE \`${tableName}\``);
    if (rows.length) {
      const colSql = plan.map((p) => `\`${p.colName}\``).join(", ");
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const valueSql = chunk.map(() => `(${plan.map(() => "?").join(",")})`).join(", ");
        await conn.query(
          `INSERT INTO \`${tableName}\` (${colSql}) VALUES ${valueSql}`,
          chunk.flat(),
        );
      }
    }
    const [countRows] = await conn.query(`SELECT COUNT(*) AS row_count FROM \`${tableName}\``);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ table: tableName, rowsInExcel: rows.length, rowsInDb: countRows[0].row_count }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

