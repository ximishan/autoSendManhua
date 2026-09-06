import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { readExcel } from "../src/importers/excel.js";

test("Excel 导入逐行校验并保留错误行", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-excel-"));
  const image = path.join(dir, "a.png");
  fs.writeFileSync(image, "fixture");
  const file = path.join(dir, "tasks.xlsx");
  const rows = [
    { title: "有效", content: "正文", resource_url: "https://example.com/a", images: "a.png", platforms: "zhihu;jianshu", weibo_account: "wb" },
    { title: "", content: "正文", resource_url: "bad", images: "missing.png", platforms: "unknown", weibo_account: "" }
  ];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("任务");
  sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key }));
  rows.forEach((row) => sheet.addRow(row));
  await workbook.xlsx.writeFile(file);
  const result = await readExcel(file);
  assert.equal(result.valid.length, 1);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.valid[0].task.images[0], image);
  fs.rmSync(dir, { recursive: true, force: true });
});
