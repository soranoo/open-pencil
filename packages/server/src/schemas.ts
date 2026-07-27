import z from "zod";

// --- Base Error Schema ---
export const errorResponseSchema = z.object({
  error: z.string(),
});

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
  result: z
    .object({
      designId: z.string(),
      summary: z.string(),
      toolCallCount: z.number(),
      hitStepLimit: z.boolean(),
      toolLog: z.array(
        z.object({
          tool: z.string(),
          mutates: z.boolean(),
        }),
      ),
    })
    .nullable(),
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
  isReadOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const getFrontendUrlResponseSchema = z.object({
  designId: z.string(),
  isReadOnly: z.boolean(),
  url: z.string().url(),
});
