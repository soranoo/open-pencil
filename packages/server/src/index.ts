import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { env } from './env.js'
import { generateRoute } from './routes/generate.js'
import { saveRoute } from './routes/save.js'
import { getDesignRoute } from './routes/get.js'
import { putDesignRoute } from './routes/put.js'

const app = new Hono()

// The forked web client calls this server directly from the browser (different origin/
// port), so it needs CORS. Tighten `origin` to your actual app's origin(s) before
// deploying anywhere past localhost.
// app.use('*', cors({ origin: env.corsOrigin, allowMethods: ['GET', 'POST', 'PUT'] }))
app.use('*', cors({ origin: "http://localhost:1420", allowMethods: ['GET', 'POST', 'PUT'] }))

app.get('/health', (c) => c.json({ status: 'ok' }))

app.post('/generate', generateRoute)
app.post('/designs/:uuid/save', saveRoute)
app.get('/designs/:uuid', getDesignRoute)
app.put('/designs/:uuid', putDesignRoute)

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`openpencil headless server listening on http://localhost:${info.port}`)
})
