import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { describeRoute, openAPIRouteHandler, resolver, validator } from "hono-openapi";
import { cors } from "hono/cors";

import { requireServerApiKey } from "@/auth/api-key.js";
import { env } from "@/env";
import { designAuthRoute } from "@/routes/design-auth.js";
import { downloadDesignRoute } from "@/routes/download.js";
import { getFrontendUrlRoute } from "@/routes/frontend-url.js";
import { generateStatusRoute } from "@/routes/generate-status.js";
import { generateRoute } from "@/routes/generate.js";
import { getDesignRoute } from "@/routes/get.js";
import { putDesignRoute } from "@/routes/put.js";
import { queueSizeRoute } from "@/routes/queue-size.js";
import { saveRoute } from "@/routes/save.js";
import {
  errorResponseSchema,
  designAuthParamsSchema,
  designAuthQuerySchema,
  designAuthResponseSchema,
  generateBodySchema,
  generateResponseSchema,
  generateStatusParamsSchema,
  generateStatusResponseSchema,
  getDesignJsonResponseSchema,
  getDesignParamsSchema,
  getDesignQuerySchema,
  getFrontendUrlParamsSchema,
  getFrontendUrlQuerySchema,
  getFrontendUrlResponseSchema,
  healthCheckResponseSchema,
  putDesignParamsSchema,
  putDesignResponseSchema,
  queueSizeResponseSchema,
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
    credentials: true,
  }),
);

const api = app.basePath("/api/v1");
const api_generate = api.basePath("/generate");
const api_generateStatus = api_generate.basePath("/status");
const api_design = api.basePath("/design");
const api_openapi = api.basePath("/openapi");

api_generate.use("*", requireServerApiKey);

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
api_generate.post(
  "/",
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

api_generateStatus.get(
  "/:requestId",
  describeRoute({
    summary: "Get queued generation request status",
    description:
      "Returns queue position while pending and completion/failure details once generation has finished.",
    responses: {
      200: {
        description: "Generation request status returned",
        content: {
          "application/json": { schema: resolver(generateStatusResponseSchema) },
        },
      },
      404: {
        description: "Request ID not found",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
    },
  }),
  validator("param", generateStatusParamsSchema),
  generateStatusRoute,
);

api_generateStatus.get(
  "/size",
  describeRoute({
    summary: "Get generate queue size",
    description: "Returns the current pending job count in the generation queue.",
    responses: {
      200: {
        description: "Queue size returned",
        content: {
          "application/json": { schema: resolver(queueSizeResponseSchema) },
        },
      },
    },
  }),
  queueSizeRoute,
);

// Save Session Endpoint
api_design.post(
  "/:designId/save",
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
        description: "No active session found for the provided Design ID",
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
api_design.get(
  "/:designId/auth",
  describeRoute({
    summary: "Authenticate frontend design access",
    description:
      "Validates the signed design query on first load or refreshes an existing design cookie on subsequent loads.",
    responses: {
      200: {
        description: "Design access authenticated",
        content: {
          "application/json": { schema: resolver(designAuthResponseSchema) },
        },
      },
      400: {
        description: "Invalid Design ID parameter",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
      401: {
        description: "Signed URL invalid, expired, or cookie missing",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
    },
  }),
  validator("param", designAuthParamsSchema),
  validator("query", designAuthQuerySchema),
  designAuthRoute,
);

api_design.get(
  "/:designId/url",
  describeRoute({
    summary: "Build frontend URL for a design",
    description:
      "Returns a signed frontend URL for a design. Read access is the default, and write access enables client saves.",
    responses: {
      200: {
        description: "Frontend URL generated",
        content: {
          "application/json": { schema: resolver(getFrontendUrlResponseSchema) },
        },
      },
      400: {
        description: "Invalid request parameters",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
    },
  }),
  requireServerApiKey,
  validator("param", getFrontendUrlParamsSchema),
  validator("query", getFrontendUrlQuerySchema),
  getFrontendUrlRoute,
);

api_design.get(
  "/:designId/download",
  describeRoute({
    summary: "Download design .fig file",
    description: "Downloads the saved design as a .fig file.",
    responses: {
      200: {
        description: "Design file downloaded successfully",
        content: {
          "application/octet-stream": { schema: { type: "string", format: "binary" } },
        },
      },
      400: {
        description: "Invalid Design ID parameter",
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
  downloadDesignRoute,
);

api_design.get(
  "/:designId",
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
        description: "Invalid Design ID parameter",
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
api_design.put(
  "/:designId",
  describeRoute({
    summary: "Upload modified design bytes",
    description: "Accepts raw file binary edited client-side and saves it directly into storage.",
    requestBody: {
      required: true,
      content: {
        "application/octet-stream": {
          schema: {
            type: "string",
            format: "binary",
          },
        },
      },
    },
    responses: {
      200: {
        description: "Design updated successfully",
        content: {
          "application/json": { schema: resolver(putDesignResponseSchema) },
        },
      },
      400: {
        description: "Missing Design ID or empty file payload",
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
  api_openapi.get(
    "/",
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
  api_openapi.get(
    "/docs",
    swaggerUI({
      url: `/api/v1/openapi`,
    }),
  );
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`openpencil headless server listening on http://localhost:${info.port}`);
});
