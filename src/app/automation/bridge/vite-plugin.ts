import { spawn } from 'node:child_process'

import type { Plugin } from 'vite'

import { AUTOMATION_HTTP_PORT } from '@open-pencil/core/constants'
import { getSocketPath, platformHasUnixSockets } from '@open-pencil/mcp/transport'
import { serializeDisabledTools } from '@open-pencil/mcp/tools'
import { platformHasUnixSockets } from '@open-pencil/mcp/transport'

import {
  DEV_MCP_RESTART_PATH,
  parseDevMCPConfiguration,
  type DevMCPConfiguration
} from '../mcp/dev-control'

interface AutomationEnvironmentOptions {
  authToken: string | null
  baseEnv: NodeJS.ProcessEnv
  configuration: DevMCPConfiguration
  corsOrigin: string
  discoveryPath: string | null
  httpPort: number
  socketPath: string | null
}

export function createAutomationEnvironment(
  options: AutomationEnvironmentOptions
): NodeJS.ProcessEnv {
  const { authToken, baseEnv, configuration, corsOrigin, discoveryPath, httpPort, socketPath } =
    options
  const childEnv = { ...baseEnv }
  delete childEnv.OPENPENCIL_MCP_SOCKET
  delete childEnv.OPENPENCIL_MCP_AUTH_TOKEN
  const environment: NodeJS.ProcessEnv = {
    ...childEnv,
    PORT: String(httpPort),
    OPENPENCIL_MCP_TCP: '1',
    OPENPENCIL_MCP_AUTH_TOKEN: configuration.authenticationEnabled ? (authToken ?? '') : '',
    OPENPENCIL_MCP_CORS_ORIGIN: corsOrigin,
    OPENPENCIL_MCP_ROOT: configuration.rootDirectory.trim() || process.cwd(),
    OPENPENCIL_MCP_DISABLED_TOOLS: serializeDisabledTools(configuration.disabledTools)
  }
  if (socketPath) environment.OPENPENCIL_MCP_SOCKET = socketPath
  if (discoveryPath) environment.OPENPENCIL_MCP_DISCOVERY_PATH = discoveryPath
  return environment
}

const MAX_CONFIGURATION_BYTES = 70_000
const CHILD_EXIT_TIMEOUT_MS = 2_000

type DevMCPConfigurationErrorStatus = 400 | 413

class DevMCPConfigurationRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: DevMCPConfigurationErrorStatus,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'DevMCPConfigurationRequestError'
  }
}

export class DevMCPConfigurationTooLargeError extends DevMCPConfigurationRequestError {
  constructor() {
    super('Request body is too large', 413)
    this.name = 'DevMCPConfigurationTooLargeError'
  }
}

export class DevMCPConfigurationSyntaxError extends DevMCPConfigurationRequestError {
  constructor(cause: unknown) {
    super('Malformed JSON configuration', 400, { cause })
    this.name = 'DevMCPConfigurationSyntaxError'
  }
}

export function devMCPConfigurationErrorStatus(error: unknown): 400 | 413 | 500 {
  return error instanceof DevMCPConfigurationRequestError ? error.statusCode : 500
}

export async function readDevMCPConfiguration(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    byteLength += buffer.byteLength
    if (byteLength > MAX_CONFIGURATION_BYTES) throw new DevMCPConfigurationTooLargeError()
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new DevMCPConfigurationSyntaxError(error)
  }
}

interface AutomationPluginOptions {
  browserURL: string
  corsOrigin: string
  httpPort: number
  portlessServiceName: string | null
  runtimeId: string
}

function safeRuntimeId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

// TODO: production — bundle MCP server as Tauri sidecar or spawn via shell plugin
export function automationPlugin(authToken: string | null, corsOrigin: string): Plugin {
  let child: ReturnType<typeof spawn> | null = null
  let starting: Promise<void> | null = null

  return {
    name: 'open-pencil-automation',
    async configureServer(server) {
      if (authToken) {
        server.middlewares.use('/__open-pencil/automation-token', (request, response, next) => {
          if (request.method !== 'GET') {
            next()
            return
          }
          response.statusCode = 200
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ token: authToken }))
        })
      }
      if (child || starting) return

      starting = (async () => {
        // Only resolve and forward the socket path on platforms that support
        // Unix domain sockets. On Windows the MCP server falls back to TCP,
        // and forwarding OPENPENCIL_MCP_SOCKET would cause it to attempt a
        // socket listen that cannot succeed.
        const socketPath = platformHasUnixSockets() ? await getSocketPath() : null

        const childEnv = { ...process.env }
        delete childEnv.OPENPENCIL_MCP_SOCKET
        delete childEnv.OPENPENCIL_MCP_AUTH_TOKEN

        const spawned = spawn('bun', ['run', 'packages/mcp/src/index.ts'], {
          stdio: ['ignore', 'inherit', 'pipe'],
          env: {
            ...childEnv,
            PORT: String(AUTOMATION_HTTP_PORT),
            OPENPENCIL_MCP_TCP: '1',
            ...(socketPath ? { OPENPENCIL_MCP_SOCKET: socketPath } : {}),
            ...(authToken ? { OPENPENCIL_MCP_AUTH_TOKEN: authToken } : {}),
            OPENPENCIL_MCP_CORS_ORIGIN: corsOrigin,
            OPENPENCIL_MCP_ROOT: process.cwd()
          }
        })
        child = spawned

        spawned.on('error', (err) => {
          console.error(`[MCP] Failed to spawn automation server: ${err.message}`)
          if (child === spawned) child = null
        })

        spawned.stderr.on('data', (data: Buffer) => {
          const text = data.toString()
          if (text.includes('EADDRINUSE')) {
            console.error(
              `\x1b[31m[MCP] MCP bind failed (port ${AUTOMATION_HTTP_PORT}${socketPath ? ` or socket ${socketPath}` : ''}). Is another OpenPencil instance running?\x1b[0m`
            )
            spawned.kill()
            if (child === spawned) child = null
            return
          }
          process.stderr.write(data)
        })

        spawned.on('exit', (code) => {
          if (code && code !== 0) {
            console.error(`[MCP] Server exited with code ${code}`)
          }
          if (child === spawned) child = null
        })
      })()

      try {
        await starting
      } finally {
        starting = null
      }
    },
    async buildEnd() {
      if (starting) {
        try {
          await starting
        } catch {
          void 0
        }
      }
      child?.kill()
      child = null
      starting = null
    }
  }
}
