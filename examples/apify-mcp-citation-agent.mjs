import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const apifyToken = process.env.APIFY_TOKEN;
const qwenKey = process.env.QWEN_API_KEY;
if (!apifyToken || !qwenKey) {
  throw new Error("APIFY_TOKEN and QWEN_API_KEY are required");
}

const client = new Client({ name: "citation-gate-agent", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(
  new URL("https://mcp.apify.com?tools=franksterino/ai-citation-auditor"),
  { requestInit: { headers: { Authorization: `Bearer ${apifyToken}` } } },
);

async function complete(messages, tools) {
  const response = await fetch(
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${qwenKey}`,
      },
      body: JSON.stringify({
        model: "qwen3.7-plus",
        temperature: 0,
        messages,
        tools,
        tool_choice: "auto",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Qwen request failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  return body.choices?.[0]?.message;
}

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const exposed = listed.tools.filter((tool) =>
    [
      "franksterino--ai-citation-auditor",
      "get-actor-run",
      "get-dataset-items",
      "get-key-value-store-record",
    ].includes(tool.name),
  );
  const tools = exposed.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  const messages = [
    {
      role: "system",
      content:
        "You are a pre-publication citation gate. Use the Apify Actor tool, then retrieve its dataset rows. Base your final answer only on tool output.",
    },
    {
      role: "user",
      content:
        "Audit these two claims against https://en.wikipedia.org/wiki/Eiffel_Tower: (1) The Eiffel Tower is 330 metres tall. (2) The Eiffel Tower is located in Berlin. Return each verdict and quote the evidence.",
    },
  ];
  const trace = [];

  for (let turn = 0; turn < 6; turn += 1) {
    const message = await complete(messages, tools);
    if (!message) throw new Error("The model returned no message");
    messages.push(message);

    if (!message.tool_calls?.length) {
      console.log(JSON.stringify({ trace, finalAnswer: message.content }, null, 2));
      break;
    }

    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      trace.push({ tool: toolCall.function.name, arguments: args });
      const result = await client.callTool({
        name: toolCall.function.name,
        arguments: args,
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(
          result.structuredContent ??
            result.content?.filter((item) => item.type === "text") ??
            result,
        ),
      });
    }
  }
} finally {
  await transport.close();
}
