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
});

// --- Save Endpoint (POST /designs/:uuid/save) ---
export const saveParamsSchema = z.object({
  uuid: z.string().uuid().or(z.string()),
});

export const saveResponseSchema = z.object({
  designId: z.string(),
  savedBytes: z.number(),
});

// --- Get Design Endpoint (GET /designs/:uuid) ---
export const getDesignParamsSchema = z.object({
  uuid: z.string(),
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

// --- Put Design Endpoint (PUT /designs/:uuid) ---
export const putDesignParamsSchema = z.object({
  uuid: z.string(),
});

export const putDesignResponseSchema = z.object({
  designId: z.string(),
  savedBytes: z.number(),
});
