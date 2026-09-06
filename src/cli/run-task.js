import fs from "node:fs";
import { createRuntime } from "./runtime.js";

const argument = process.argv[2];
if (!argument) {
  console.error("用法：npm run run:task -- <taskId|task.json>");
  process.exit(2);
}

const runtime = createRuntime();
try {
  let taskId = argument;
  if (fs.existsSync(argument)) {
    const input = JSON.parse(fs.readFileSync(argument, "utf8"));
    taskId = runtime.database.tasks.create(input).id;
  }
  const result = await runtime.workflow.runTask(taskId);
  console.log(JSON.stringify(result, null, 2));
  if (!["completed", "partial_failed"].includes(result.status)) process.exitCode = 1;
} finally {
  await runtime.browserManager.closeAll();
  runtime.database.close();
}
