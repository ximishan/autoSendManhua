import path from "node:path";
import { openDatabase } from "../db/index.js";
import { importExcel } from "../importers/excel.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("用法：npm run import:excel -- <任务表.xlsx>");
  process.exit(2);
}
const database = openDatabase();
try {
  const result = await importExcel(database, path.resolve(filePath));
  console.log(JSON.stringify({ created: result.created.map((item) => ({ rowNumber: item.rowNumber, taskId: item.task.id })), invalid: result.invalid }, null, 2));
  if (result.invalid.length) process.exitCode = 1;
} finally {
  database.close();
}
