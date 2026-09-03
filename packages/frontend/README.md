# @open-pencil/frontend

Small Next.js + HeroUI 3 frontend for prompt-to-design generation.

The browser submits prompts to this app's `/api/generate` route. That route
keeps the automation server API key on the server, queues the request, polls
for completion, and returns a signed read-only OpenPencil editor URL together
with token usage.

## Local setup

1. Start the OpenPencil app in backend mode so signed design URLs can load:

   ```sh
   VITE_IS_BACKEND_MODE=true VITE_OPENPENCIL_SERVER_URL=http://localhost:8787 bun run dev
   ```

2. Start `packages/automation-server` using its `.env.example` and make sure
   its `FRONTEND_URL` points at the OpenPencil app.

3. Copy `.env.example` to `.env`, set `OPENPENCIL_SERVER_API_KEY` to the
   automation server's `SERVER_API_KEY`, then start this package:

   ```sh
   bun run frontend:dev
   ```

The Prompt Studio runs at `http://localhost:3000`.
