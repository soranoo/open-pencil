import z from "zod";

import { generateResultSchema } from "./generate";

// --- Base Error Schema ---
export const errorResponseSchema = z.object({
  error: z.string(),
});

export const designPermissionSchema = z.enum(["read", "write"]);

// --- Health Check ---
export const healthCheckResponseSchema = z.object({
  status: z.string(),
});

// --- Generate Endpoint ---
export const generateBodySchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  designId: z.string().optional(),
});

export const generateResponseSchema = z.object({
  requestId: z.string(),
  queuePosition: z.number().int().min(1),
});

export const generateStatusParamsSchema = z.object({
  requestId: z.uuid(),
});

export const generateStatusResponseSchema = z.object({
  requestId: z.string(),
  completed: z.boolean(),
  queuePosition: z.number().int().min(0).nullable(),
  failed: z.boolean(),
  error: z.string().nullable(),
  result: generateResultSchema.nullable(),
});

// --- Save Endpoint (POST /designs/:designId/save) ---
export const saveParamsSchema = z.object({
  designId: z.uuid(),
});

export const saveResponseSchema = z.object({
  designId: z.string(),
  savedBytes: z.number(),
});

// --- Get Design Endpoint (GET /designs/:designId) ---
export const getDesignParamsSchema = z.object({
  designId: z.uuid(),
});

export const getDesignQuerySchema = z.object({
  format: z.enum(["json"]).optional(),
});

export const getDesignJsonResponseSchema = z.object({
  designId: z.string(),
  metadata: z.object({
    id: z.string(),
    promptHistory: z.array(z.any()),
    s3Key: z.string(),
  }),
  dataBase64: z.string(),
});

// --- Put Design Endpoint (PUT /designs/:designId) ---
export const putDesignParamsSchema = z.object({
  designId: z.uuid(),
});

export const putDesignResponseSchema = z.object({
  designId: z.string(),
  savedBytes: z.number(),
});

export const queueSizeResponseSchema = z.object({
  queue: z.string(),
  size: z.number().int().min(0),
});

// --- Frontend URL Endpoint (GET /design/:designId/url) ---
export const getFrontendUrlParamsSchema = z.object({
  designId: z.uuid(),
});

export const getFrontendUrlQuerySchema = z.object({
  permission: designPermissionSchema.optional(),
});

export const getFrontendUrlResponseSchema = z.object({
  designId: z.string(),
  permission: designPermissionSchema,
  url: z.url(),
});

export const designAuthParamsSchema = z.object({
  designId: z.uuid(),
});

export const designAuthQuerySchema = z.object({
  design: z.uuid().optional(),
  key: z.string().min(1).optional(),
  expiry: z.string().optional(),
  permission: designPermissionSchema.optional(),
  sign: z.string().min(1).optional(),
});

export const designAuthResponseSchema = z.object({
  authenticated: z.literal(true),
  designId: z.string(),
  permission: designPermissionSchema,
  refreshIntervalMs: z.number().int().min(1),
  cookieExpiresAt: z.number().int().min(1),
  source: z.enum(["cookie", "signed-url"]),
});
