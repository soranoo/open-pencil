/**
 * Download a saved design through the server's dedicated .fig download API.
 *
 * Prerequisites:
 *   1. Start the automation server.
 *   2. Set DESIGN_ID to an existing saved design UUID.
 *   3. Set SERVER_API_KEY to the server's API key.
 *
 * Run:
 *   cd packages/automation-server
 *   DESIGN_ID=00000000-0000-0000-0000-000000000000 bun run examples/download-demo.ts
 */
const BASE_URL = process.env.SERVER_URL ?? "http://localhost:8800/api/v1";
const API_KEY = process.env.SERVER_API_KEY ?? "replace-with-a-shared-server-api-key";
const DESIGN_ID = "1330a099-d7cb-4f19-891a-535125e49cf1";
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? `${DESIGN_ID ?? "design"}.fig`;

interface FrontendUrlResponse {
  designId: string;
  permission: "read" | "write";
  url: string;
}

async function getFrontendUrl(designId: string): Promise<FrontendUrlResponse> {
  const response = await fetch(`${BASE_URL}/design/${designId}/url`, {
    headers: { authorization: `Bearer ${API_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`GET /design/${designId}/url -> ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as FrontendUrlResponse;
}

async function main() {
  if (!DESIGN_ID) {
    throw new Error("DESIGN_ID is required");
  }

  console.log(`1. Request a signed read URL for ${DESIGN_ID}...`);
  const frontendUrl = await getFrontendUrl(DESIGN_ID);

  const downloadUrl = new URL(`${BASE_URL}/design/${DESIGN_ID}/download`);
  const signedUrl = new URL(frontendUrl.url);
  for (const [key, value] of signedUrl.searchParams) {
    downloadUrl.searchParams.set(key, value);
  }

  console.log("2. Download the saved .fig file...");
  const response = await fetch(downloadUrl, {
    headers: { authorization: `Bearer ${API_KEY}` },
  });
  if (!response.ok) {
    throw new Error(
      `GET /design/${DESIGN_ID}/download -> ${response.status}: ${await response.text()}`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(OUTPUT_PATH, bytes);
  console.log(`   saved ${bytes.byteLength} bytes to ${OUTPUT_PATH}`);
  console.log(
    `   content-disposition: ${response.headers.get("content-disposition") ?? "missing"}`,
  );
  console.log("\nDone.");
}

main().catch((error) => {
  console.error("Download demo failed:", error);
  process.exitCode = 1;
});
