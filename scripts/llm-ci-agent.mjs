import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const workspace = process.env.LLM_CI_WORKSPACE || process.cwd();
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const model = process.env.LLM_MODEL || "openai/gpt-4o-mini";
  const promptRel = process.env.LLM_CI_PROMPT_FILE || "llm-ci.txt";
  const promptPath = join(workspace, promptRel);
  const systemPrompt = process.env.LLM_CI_SYSTEM ?? "";
  const userPrompt = readFileSync(promptPath, "utf8");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", workspace],
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

    async function chat(messages) {
      const res = await fetch(
        "https://models.github.ai/inference/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            model,
            messages,
            tools: openaiTools,
            tool_choice: "auto",
            max_tokens: 16384,
            temperature: 0.2,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub Models inference HTTP ${res.status}: ${text}`);
      }
      return res.json();
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
        const text = typeof msg.content === "string" ? msg.content : "";
        process.stdout.write(`${text.trimEnd()}\n`);
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
