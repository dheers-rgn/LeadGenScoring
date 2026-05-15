import "dotenv/config";
import { createPool } from "../db.js";
import { runFullImport } from "./importExcels.js";

async function main() {
  const allExcelPath = process.env.ALL_EXCEL_PATH;
  const convExcelPath = process.env.CONV_EXCEL_PATH;
  if (!allExcelPath || !convExcelPath) {
    throw new Error("Missing ALL_EXCEL_PATH or CONV_EXCEL_PATH");
  }

  const pool = createPool(process.env);
  const result = await runFullImport({ pool, allExcelPath, convExcelPath });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, result }, null, 2));
  await pool.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

