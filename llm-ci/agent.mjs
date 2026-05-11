import { readFileSync } from "node:fs";
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
  const systemPrompt = process.env.LLM_CI_SYSTEM ?? "";
  const userPrompt = readFileSync(promptPath, "utf8");

  const fsServer =
    process.env.MCP_FILESYSTEM_SERVER_PACKAGE ??
    "@modelcontextprotocol/server-filesystem@2026.1.14";

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
    const { tools: mcpTools } = await client.listTools();

    const openaiTools = mcpTools.map((t) => ({
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

    async function chat(messages, { withTools = true } = {}) {
      const base = {
        messages,
        max_tokens: openaiKey || useOllama ? 8192 : 16384,
        temperature: 0.2,
      };
      if (withTools && openaiTools.length > 0) {
        base.tools = openaiTools;
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
            ? " Enable GitHub Models for the org, set LLM_MODELS_PAT, OPENAI_API_KEY, or USE_OLLAMA=true (default in this repo’s workflow)."
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
        const raw = await client.callTool({ name, arguments: args });
        const content = toolResultToString(raw);
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
