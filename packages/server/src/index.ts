import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { env } from "@/env";
import { generateRoute } from "@/routes/generate.js";
import { saveRoute } from "@/routes/save.js";
import { getDesignRoute } from "@/routes/get.js";
import { putDesignRoute } from "@/routes/put.js";

const app = new Hono();

app.use('*', cors({ origin: env.CORS_ORIGIN, allowMethods: ['GET', 'POST', 'PUT'] }))

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/generate", generateRoute);
app.post("/designs/:uuid/save", saveRoute);
app.get("/designs/:uuid", getDesignRoute);
app.put("/designs/:uuid", putDesignRoute);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`openpencil headless server listening on http://localhost:${info.port}`);
});
