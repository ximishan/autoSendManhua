import path from "node:path";
import ExcelJS from "exceljs";
import { SUPPORTED_PLATFORMS, createTask, validateTask } from "../core/task.js";

export const REQUIRED_COLUMNS = ["title", "content", "resource_url", "images", "platforms", "weibo_account"];

function splitValues(value) {
  return String(value || "").split(/[;,；，]/).map((item) => item.trim()).filter(Boolean);
}

export function validateExcelRows(rows, { baseDir = process.cwd(), checkFiles = true, accountExists } = {}) {
  const valid = [];
  const invalid = [];
  rows.forEach((row, index) => {
    const rowNumber = row.__rowNumber || index + 2;
    try {
      const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in row));
      if (missingColumns.length) throw new Error(`缺少列：${missingColumns.join(", ")}`);
      const selectedPlatforms = splitValues(row.platforms).map((item) => item.toLowerCase());
      const invalidPlatforms = selectedPlatforms.filter((item) => !SUPPORTED_PLATFORMS.includes(item) || item === "weibo");
      if (invalidPlatforms.length) throw new Error(`平台名称非法：${invalidPlatforms.join(", ")}`);
      const images = splitValues(row.images).map((filePath) => path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath));
      const accountIds = { weibo: String(row.weibo_account || "").trim() };
      for (const platform of selectedPlatforms) {
        const key = `${platform}_account`;
        if (row[key]) accountIds[platform] = String(row[key]).trim();
      }
      if (!accountIds.weibo) throw new Error("weibo_account 不能为空");
      if (accountExists && !accountExists(accountIds.weibo, "weibo")) throw new Error(`微博账号不存在：${accountIds.weibo}`);
      for (const [platform, accountId] of Object.entries(accountIds)) {
        if (accountId && accountExists && !accountExists(accountId, platform)) throw new Error(`${platform} 账号不存在：${accountId}`);
      }
      const task = createTask({
        title: row.title,
        content: row.content,
        resourceUrl: row.resource_url,
        images,
        selectedPlatforms,
        accountIds
      });
      validateTask(task, { checkFiles });
      valid.push({ rowNumber, task });
    } catch (error) {
      invalid.push({ rowNumber, error: error.message, row });
    }
  });
  return { valid, invalid };
}

export async function readExcel(filePath, options = {}) {
  if(path.extname(filePath).toLowerCase()!=='.xlsx')throw new Error('第一版只支持 .xlsx，请先转换文件格式');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const firstSheet = workbook.worksheets[0];
  if (!firstSheet) throw new Error("Excel 没有可读取的工作表");
  const headers = firstSheet.getRow(1).values.slice(1).map((value) => String(value || "").trim());
  const missing=REQUIRED_COLUMNS.filter(key=>!headers.includes(key));
  if(missing.length)throw new Error('缺少列：'+missing.join(', '));
  const rows = [];
  for (let rowNumber = 2; rowNumber <= firstSheet.rowCount; rowNumber += 1) {
    const excelRow = firstSheet.getRow(rowNumber);
    const row = { __rowNumber: rowNumber };
    headers.forEach((header, index) => { if (header) row[header] = excelRow.getCell(index + 1).text; });
    if (Object.entries(row).some(([key, value]) => key !== "__rowNumber" && value !== "")) rows.push(row);
  }
  return validateExcelRows(rows, { ...options, baseDir: options.baseDir || path.dirname(filePath) });
}

export async function importExcel(database, filePath, options = {}) {
  const accountExists = (id, platform) => database.accounts.get(id)?.platform === platform;
  const result = await readExcel(filePath, { ...options, accountExists });
  const created=[];
  for(const {rowNumber,task} of result.valid){try{created.push({rowNumber,task:database.tasks.create(task,{checkFiles:options.checkFiles!==false})});}catch(e){result.invalid.push({rowNumber,error:e.message});}}
  return { created, invalid: result.invalid };
}

export async function exportResults(database, filePath) {
  const rows = database.tasks.list({ limit: 100000 }).map((task) => {
    const output = {
      task_id: task.id,
      title: task.title,
      status: task.status,
      resource_url: task.resourceUrl,
      weibo_url: task.weibo?.share_url || task.weibo?.canonical_url || "",
      created_at: task.createdAt
    };
    for (const job of task.jobs) {
      output[`${job.platform}_status`] = job.status;
      output[`${job.platform}_result`] = job.result_status;
      output[`${job.platform}_url`] = job.post_url;
      output[`${job.platform}_error`] = job.error_message;
    }
    return output;
  });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("发布结果");
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  sheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(14, Math.min(40, header.length + 6)) }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  await workbook.xlsx.writeFile(filePath);
  return { filePath, count: rows.length };
}

export async function writeImportTemplate(filePath) {
  const rows = [{
    title: "示例标题",
    content: "示例正文",
    resource_url: "K：https://pan.quark.cn/s/example  D：https://pan.baidu.com/s/example?pwd=1111",
    images: "D:/images/1.jpg;D:/images/2.jpg",
    platforms: "zhihu;jianshu;baijiahao;toutiao",
    weibo_account: "wb_01",
    zhihu_account: "zh_01",
    jianshu_account: "js_01",
    baijiahao_account: "bj_01",
    toutiao_account: "tt_01",
    sohu_account: "sh_01",
    netease_account: "wy_01"
  }];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("任务导入");
  sheet.columns = Object.keys(rows[0]).map((key) => ({
    header: key,
    key,
    width: key === "resource_url" ? 58 : key === "content" || key === "images" ? 42 : 22
  }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}
