import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { describeRoute, openAPIRouteHandler, resolver, validator } from "hono-openapi";
import { swaggerUI } from "@hono/swagger-ui";

import { env } from "@/env";
import { generateRoute } from "@/routes/generate.js";
import { saveRoute } from "@/routes/save.js";
import { getDesignRoute } from "@/routes/get.js";
import { putDesignRoute } from "@/routes/put.js";
import {
  errorResponseSchema,
  generateBodySchema,
  generateResponseSchema,
  getDesignJsonResponseSchema,
  getDesignParamsSchema,
  getDesignQuerySchema,
  healthCheckResponseSchema,
  putDesignParamsSchema,
  putDesignResponseSchema,
  saveParamsSchema,
  saveResponseSchema,
} from "@/schemas.js";

const app = new Hono();

// Global CORS Middleware
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT"],
  }),
);

const api = app.basePath("/api/v1");

// Health Check
api.get(
  "/health",
  describeRoute({
    summary: "Health check endpoint",
    description: "Returns a simple JSON object indicating the server is running.",
    responses: {
      200: {
        description: "Server is healthy",
        content: {
          "application/json": { schema: resolver(healthCheckResponseSchema) },
        },
      },
    },
  }),
  (c) => c.json({ status: "ok" }),
);

// Generate Design Endpoint
api.post(
  "/generate",
  describeRoute({
    summary: "Generate or update a design",
    description:
      "Runs AI prompt processing to create a new design or refine an existing design session.",
    responses: {
      200: {
        description: "Design generated successfully",
        content: {
          "application/json": { schema: resolver(generateResponseSchema) },
        },
      },
      400: {
        description: "Invalid input or missing prompt",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
      404: {
        description: "Saved design not found for provided designId",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
    },
  }),
  validator("json", generateBodySchema),
  generateRoute,
);

// Save Session Endpoint
api.post(
  "/designs/:uuid/save",
  describeRoute({
    summary: "Save design session to server",
    description: "Serializes and persists an in-memory session design graph to storage.",
    responses: {
      200: {
        description: "Design saved successfully",
        content: {
          "application/json": { schema: resolver(saveResponseSchema) },
        },
      },
      400: {
        description: "Invalid params",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
      404: {
        description: "No active session found for the provided UUID",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
    },
  }),
  validator("param", saveParamsSchema),
  saveRoute,
);

// Get Design Endpoint
api.get(
  "/designs/:uuid",
  describeRoute({
    summary: "Fetch design payload or raw binary file",
    description:
      "Retrieves design data. Returns base64 metadata payload when ?format=json query is provided, or binary file download by default.",
    responses: {
      200: {
        description: "Design retrieved successfully",
        content: {
          "application/octet-stream": { schema: { type: "string", format: "binary" } },
          "application/json": { schema: resolver(getDesignJsonResponseSchema) },
        },
      },
      400: {
        description: "Invalid UUID parameter",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
      404: {
        description: "Design not found",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
    },
  }),
  validator("param", getDesignParamsSchema),
  validator("query", getDesignQuerySchema),
  getDesignRoute,
);

// Put Design Endpoint (Client-side sync)
api.put(
  "/designs/:uuid",
  describeRoute({
    summary: "Upload modified design bytes",
    description: "Accepts raw file binary edited client-side and saves it directly into storage.",
    responses: {
      200: {
        description: "Design updated successfully",
        content: {
          "application/json": { schema: resolver(putDesignResponseSchema) },
        },
      },
      400: {
        description: "Missing UUID or empty file payload",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
    },
  }),
  validator("param", putDesignParamsSchema),
  putDesignRoute,
);

if (env.ENABLE_OPENAPI_DOCS) {
  api.get(
    "/openapi",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "OpenPencil Headless Server API",
          version: "1.0.0",
          description: "OpenPencil Headless Server API",
        },
        servers: [{ url: `http://localhost:${env.PORT}`, description: "Local Server" }],
      },
    }),
  );
  api.get(
    "/openapi/docs",
    swaggerUI({
      url: `/openapi`,
    }),
  );
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`openpencil headless server listening on http://localhost:${info.port}`);
});
