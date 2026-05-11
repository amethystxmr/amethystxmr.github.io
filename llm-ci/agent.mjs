import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePromptPath() {
  const raw = process.env.LLM_CI_PROMPT_FILE;
  if (raw) {
    return isAbsolute(raw) ? raw : join(process.env.LLM_CI_PROMPT_ROOT ?? __dirname, raw);
  }
  return join(__dirname, "prompt.txt");
}

function assistantTextContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  }
  return "";
}

/** Strict OK / FAIL: lines only; strips unrelated prose from small models. */
function extractProtocolOutput(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const failLines = lines.filter((l) => l.startsWith("FAIL:"));
  if (failLines.length > 0) {
    return `${failLines.join("\n")}\n`;
  }
  const okCount = lines.filter((l) => l === "OK").length;
  const nonOk = lines.filter((l) => l !== "OK");
  if (okCount === 1 && nonOk.length === 0) {
    return "OK\n";
  }
  return null;
}

function inferenceUrls() {
  if (process.env.GITHUB_MODELS_INFERENCE_URL) {
    return [process.env.GITHUB_MODELS_INFERENCE_URL];
  }
  const urls = ["https://models.github.ai/inference/chat/completions"];
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo?.includes("/")) {
    const owner = repo.split("/")[0];
    if (owner) {
      urls.push(
        `https://models.github.ai/orgs/${encodeURIComponent(owner)}/inference/chat/completions`,
      );
    }
  }
  return urls;
}

function truthyEnv(v) {
  return /^(1|true|yes)$/i.test((v || "").trim());
}

async function postJson(url, body, headers) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} (${url}): ${text || "(empty body)"}`);
  }
  return JSON.parse(text);
}

async function main() {
  const workspace = process.env.LLM_CI_WORKSPACE || process.cwd();
  const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
  const useOllama = truthyEnv(process.env.USE_OLLAMA);
  const useGithubModels = !openaiKey && !useOllama;
  const pat = (process.env.LLM_INFERENCE_TOKEN || "").trim();
  const githubInferenceToken = pat || (process.env.GITHUB_TOKEN || "").trim();

  if (!openaiKey && !useOllama && !githubInferenceToken) {
    throw new Error(
      "No inference credentials: set OPENAI_API_KEY, USE_OLLAMA=true, or GitHub Models (LLM_MODELS_PAT or GITHUB_TOKEN with models: read).",
    );
  }

  const githubModel = process.env.LLM_MODEL || "openai/gpt-4o-mini";
  const openaiModel = process.env.OPENAI_LLM_MODEL || "gpt-4o-mini";
  const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2:1b";
  const ollamaUrl = (
    process.env.OLLAMA_URL || "http://127.0.0.1:11434/v1/chat/completions"
  ).trim();

  const promptPath = resolvePromptPath();
  let systemPrompt = process.env.LLM_CI_SYSTEM ?? "";
  let userPrompt = readFileSync(promptPath, "utf8");
  if (useGithubModels && !truthyEnv(process.env.LLM_CI_FULL_PROMPT)) {
    systemPrompt =
      "CI reviewer with MCP filesystem tools. Obey llm-ci/prompt.txt for checks and reply only with OK or FAIL: lines as defined there.";
    userPrompt = [
      `Workspace: ${workspace}`,
      "GitHub Models limits request size; full rules are in llm-ci/prompt.txt (read with tools).",
      "",
      "Read before concluding:",
      "- llm-ci/prompt.txt — checks and exact OK / FAIL: output format",
      "- .llm-ci-pr.diff — PR diff (base...head)",
    ].join("\n");
  }

  const fsServer =
    process.env.MCP_FILESYSTEM_SERVER_PACKAGE ??
    "@modelcontextprotocol/server-filesystem@2026.1.14";

  const mcpLogRaw = (process.env.LLM_CI_MCP_LOG || "").trim();
  const mcpLogPath = mcpLogRaw
    ? isAbsolute(mcpLogRaw)
      ? mcpLogRaw
      : join(workspace, mcpLogRaw)
    : join(workspace, "llm-ci", "mcp-access.log");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", fsServer, workspace],
    cwd: workspace,
  });

  const client = new Client(
    { name: "amethyst-llm-ci", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    writeFileSync(mcpLogPath, "", "utf8");
    const { tools: mcpTools } = await client.listTools();

    /** Read-only tools enough for CI review; keeps GitHub Models requests under small token caps. */
    const rawGithubTools = (process.env.LLM_GITHUB_MCP_TOOLS || "").trim();
    const githubToolAllowlist = new Set(
      rawGithubTools
        ? rawGithubTools.split(",").map((s) => s.trim()).filter(Boolean)
        : [
            "read_text_file",
            "read_multiple_files",
            "list_directory",
            "get_file_info",
            "search_files",
          ],
    );
    const mcpToolsGithub = mcpTools.filter((t) => githubToolAllowlist.has(t.name));
    const toolsForGithubList = mcpToolsGithub.length > 0 ? mcpToolsGithub : mcpTools;

    /** Full JSON Schema from MCP (large). */
    const openaiToolsFull = mcpTools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters:
          typeof t.inputSchema === "object" && t.inputSchema !== null
            ? t.inputSchema
            : { type: "object", properties: {} },
      },
    }));

    /**
     * MCP `listTools()` JSON Schemas can be huge ($ref trees). GitHub Models enforces a
     * small total request budget for some models — use tiny hand-written schemas instead.
     */
    const githubToolParamSchemas = {
      read_text_file: {
        type: "object",
        properties: {
          path: { type: "string" },
          head: { type: "number" },
          tail: { type: "number" },
        },
        required: ["path"],
      },
      read_multiple_files: {
        type: "object",
        properties: {
          paths: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["paths"],
      },
      list_directory: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      get_file_info: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      search_files: {
        type: "object",
        properties: {
          path: { type: "string" },
          pattern: { type: "string" },
          excludePatterns: { type: "array", items: { type: "string" } },
        },
        required: ["path", "pattern"],
      },
    };

    const githubToolShortDesc = {
      read_text_file: "Read a UTF-8 text file under the workspace (path; optional head/tail line limits).",
      read_multiple_files: "Read several text files in one call (paths array).",
      list_directory: "List non-hidden entries in a directory (path).",
      get_file_info: "Return metadata for a file or directory (path).",
      search_files: "Glob search under path for pattern; optional excludePatterns.",
    };

    const githubToolsCompact = toolsForGithubList.map((t) => {
      const params = githubToolParamSchemas[t.name];
      if (!params) {
        throw new Error(
          `GitHub Models CI: tool "${t.name}" has no compact schema; extend githubToolParamSchemas or LLM_GITHUB_MCP_TOOLS.`,
        );
      }
      return {
        type: "function",
        function: {
          name: t.name,
          description:
            githubToolShortDesc[t.name] ?? String(t.description ?? "").slice(0, 100),
          parameters: params,
        },
      };
    });

    const githubToolCharBudget = Number(
      (process.env.LLM_GITHUB_TOOL_CHARS || "").trim() || "3500",
    );

    function clampGithubToolPayload(text) {
      const s = String(text);
      if (!useGithubModels) return s;
      if (s.length <= githubToolCharBudget) return s;
      return `${s.slice(0, githubToolCharBudget)}\n\n[...truncated ${s.length - githubToolCharBudget} chars for GitHub Models request size]`;
    }

    function toolsForChat() {
      if (openaiKey || useOllama) return openaiToolsFull;
      return githubToolsCompact;
    }

    async function chat(messages, { withTools = true } = {}) {
      const toolsList = toolsForChat();
      const base = {
        messages,
        max_tokens: openaiKey || useOllama ? 8192 : 2048,
        temperature: 0.2,
      };
      if (withTools && toolsList.length > 0) {
        base.tools = toolsList;
        base.tool_choice = "auto";
      }

      if (openaiKey) {
        return postJson(
          "https://api.openai.com/v1/chat/completions",
          { ...base, model: openaiModel },
          { Authorization: `Bearer ${openaiKey}` },
        );
      }

      if (useOllama) {
        return postJson(
          ollamaUrl,
          { ...base, model: ollamaModel, stream: false },
          {},
        );
      }

      const body = JSON.stringify({ ...base, model: githubModel });
      const headers = {
        Authorization: `Bearer ${githubInferenceToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": process.env.GITHUB_API_VERSION || "2022-11-28",
        "User-Agent": "amethyst-llm-ci/1.0 (GitHub Actions)",
      };
      const urls = inferenceUrls();
      let lastErr;
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const res = await fetch(url, { method: "POST", headers, body });
        const text = await res.text();
        if (res.ok) {
          return JSON.parse(text);
        }
        const hint =
          res.status === 403
            ? " Enable GitHub Models for the org/repo, set LLM_MODELS_PAT, OPENAI_API_KEY, or USE_OLLAMA=true for local/Ollama CI."
            : "";
        lastErr = new Error(
          `GitHub Models inference HTTP ${res.status} (${url}): ${text || "(empty body)"}${hint}`,
        );
        if (res.status === 403 && i < urls.length - 1) {
          continue;
        }
        throw lastErr;
      }
      throw lastErr;
    }

    function toolResultToString(result) {
      if (result.isError) {
        return `TOOL_ERROR: ${JSON.stringify(result.content)}`;
      }
      return (result.content ?? [])
        .map((block) => {
          if (block.type === "text") {
            return block.text;
          }
          return JSON.stringify(block);
        })
        .join("\n");
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const MAX_ROUNDS = 32;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const data = await chat(messages);
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error("No choice in model response");
      }
      const msg = choice.message;
      messages.push(msg);

      const toolCalls = msg.tool_calls;
      if (!toolCalls?.length) {
        let out = extractProtocolOutput(assistantTextContent(msg.content));
        if (!out) {
          messages.push({
            role: "user",
            content:
              "Your previous reply was not in the required format. Respond with ONLY the single line OK (if all checks pass) or ONLY lines starting with FAIL: (one per issue). No JSON, markdown, code fences, or other text.",
          });
          const dataRetry = await chat(messages, { withTools: false });
          const choiceR = dataRetry.choices?.[0];
          if (!choiceR) {
            throw new Error("No choice in model response (format retry)");
          }
          const msgR = choiceR.message;
          messages.push(msgR);
          if (msgR.tool_calls?.length) {
            out =
              "FAIL: LLM CI reviewer returned tool calls on a no-tools format retry.\n";
          } else {
            out = extractProtocolOutput(assistantTextContent(msgR.content));
          }
        }
        if (!out) {
          out =
            "FAIL: LLM CI reviewer did not return a strict OK / FAIL: block after a format retry.\n";
        }
        process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
        return;
      }

      for (const tc of toolCalls) {
        const name = tc.function.name;
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        const logLine = `${new Date().toISOString()}\t${name}\t${JSON.stringify(args)}\n`;
        appendFileSync(mcpLogPath, logLine, "utf8");
        const raw = await client.callTool({ name, arguments: args });
        const content = clampGithubToolPayload(toolResultToString(raw));
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content,
        });
      }
    }
    throw new Error("Exceeded max tool rounds");
  } finally {
    await client.close();
  }
}

await main();
