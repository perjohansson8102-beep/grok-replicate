import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

type Env = {
  REPLICATE_API_TOKEN: string;
  MCP_ACCESS_TOKEN: string;
};

function resultText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorText(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "grok-replicate",
    version: "1.0.0",
  });

  server.registerTool(
    "generate_image",
    {
      description:
        "Generate an image with Replicate. Use model as owner/name. For community models, also provide a version hash. Extra model-specific inputs can be supplied as a JSON object in input_json.",
      inputSchema: {
        prompt: z.string().min(1).describe("Image prompt"),
        model: z
          .string()
          .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
          .describe("Replicate model in owner/name format"),
        version: z
          .string()
          .optional()
          .describe("Optional Replicate model version hash for community models"),
        input_json: z
          .string()
          .optional()
          .describe(
            'Optional JSON object with additional model inputs, for example {"aspect_ratio":"1:1"}'
          ),
      },
    },
    async ({ prompt, model, version, input_json }) => {
      if (!env.REPLICATE_API_TOKEN) {
        return errorText("REPLICATE_API_TOKEN is not configured.");
      }

      let extraInput: Record<string, unknown> = {};
      if (input_json) {
        try {
          const parsed = JSON.parse(input_json);
          if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
            return errorText("input_json must contain a JSON object.");
          }
          extraInput = parsed as Record<string, unknown>;
        } catch {
          return errorText("input_json is not valid JSON.");
        }
      }

      const input = { ...extraInput, prompt };
      const [owner, name] = model.split("/");

      const endpoint = version
        ? "https://api.replicate.com/v1/predictions"
        : `https://api.replicate.com/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`;

      const body = version ? { version, input } : { input };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          
          "Cancel-After": "2m",
        },
        body: JSON.stringify(body),
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        return errorText(
          `Replicate returned HTTP ${response.status}: ${JSON.stringify(data)}`
        );
      }

      const outputUrl = Array.isArray(data.output)
  ? data.output[0]
  : data.output;

if (data.status === "succeeded" && typeof outputUrl === "string") {
  return {
    content: [
      {
        type: "text" as const,
        text: `Image generated successfully.\n[Öppna genererad bild](${outputUrl})`,
      },
    ],
  };
}

return resultText({
  id: data.id,
  status: data.status,
  output: data.output ?? null,
  error: data.error ?? null,
  prediction_url: data.urls?.get ?? null,
  web_url: data.urls?.web ?? null,
});
    }
  );

  server.registerTool(
    "get_prediction",
    {
      description:
        "Check a Replicate prediction that is still starting or processing.",
      inputSchema: {
        prediction_id: z.string().min(1).describe("Replicate prediction ID"),
      },
    },
    async ({ prediction_id }) => {
      if (!env.REPLICATE_API_TOKEN) {
        return errorText("REPLICATE_API_TOKEN is not configured.");
      }

      const response = await fetch(
        `https://api.replicate.com/v1/predictions/${encodeURIComponent(prediction_id)}`,
        {
          headers: {
            Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
          },
        }
      );

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        return errorText(
          `Replicate returned HTTP ${response.status}: ${JSON.stringify(data)}`
        );
      }

      return resultText({
        id: data.id,
        status: data.status,
        output: data.output ?? null,
        error: data.error ?? null,
        prediction_url: data.urls?.get ?? null,
        web_url: data.urls?.web ?? null,
      });
    }
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("grok-replicate MCP server is alive");
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    const accessToken = url.searchParams.get("token");

if (!env.MCP_ACCESS_TOKEN || accessToken !== env.MCP_ACCESS_TOKEN) {
  return new Response("Not found", { status: 404 });
}

    return createMcpHandler(() => createServer(env), {
      route: "/mcp",
    })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
