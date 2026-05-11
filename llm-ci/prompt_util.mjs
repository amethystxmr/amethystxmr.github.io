import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolvePromptPath() {
  const raw = process.env.LLM_CI_PROMPT_FILE;
  if (raw) {
    return isAbsolute(raw) ? raw : join(process.env.LLM_CI_PROMPT_ROOT ?? __dirname, raw);
  }
  return join(__dirname, "prompt.txt");
}

export function splitPromptDataFiles(text) {
  const begin = "---LLM_CI_DATA_FILES---";
  const end = "---END_LLM_CI_DATA_FILES---";
  const lines = text.split(/\r?\n/);
  let i = -1;
  let j = -1;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].trim() === begin) {
      i = k;
      break;
    }
  }
  if (i === -1) {
    return { body: text.trimEnd(), dataFiles: [] };
  }
  for (let k = i + 1; k < lines.length; k++) {
    if (lines[k].trim() === end) {
      j = k;
      break;
    }
  }
  if (j === -1) {
    return { body: text.trimEnd(), dataFiles: [] };
  }
  const body = [...lines.slice(0, i), ...lines.slice(j + 1)].join("\n").trim();
  const dataFiles = lines
    .slice(i + 1, j)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));
  return { body, dataFiles };
}
