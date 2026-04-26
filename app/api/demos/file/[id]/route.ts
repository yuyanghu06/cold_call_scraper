// GET /api/demos/file/:id
//
// Streams a single Drive file's bytes through to the client. The crucial
// security check is the parent-folder match: without it this endpoint
// would proxy any file the service account can see. We 404 (not 403) on
// mismatch so the route doesn't leak file existence.

import { Readable } from "node:stream";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import {
  downloadFileStream,
  getFileMeta,
  getFolderConfig,
} from "@/lib/clients/driveClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authedUserFromRequest(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = await params;
  if (!id) {
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let allowedFolders: Set<string>;
  try {
    const { checklistFolderId, contractsFolderId, footageFolderId } =
      getFolderConfig();
    allowedFolders = new Set([
      checklistFolderId,
      contractsFolderId,
      footageFolderId,
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let meta;
  try {
    meta = await getFileMeta(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 404 on either "doesn't exist" or "exists but parent isn't in our
  // allowlist" — same outward signal so we don't leak which case it is.
  if (!meta) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const inAllowedFolder = (meta.parents ?? []).some((p) => allowedFolders.has(p));
  if (!inAllowedFolder) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let nodeStream;
  try {
    nodeStream = await downloadFileStream(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Convert the node Readable to a web ReadableStream so Next pipes it
  // straight through without buffering the whole file in memory.
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  const headers = new Headers();
  headers.set("Content-Type", meta.mimeType);
  if (typeof meta.size === "number") {
    headers.set("Content-Length", String(meta.size));
  }
  if (meta.name) {
    // RFC 5987 encoding for non-ASCII filenames.
    const safeName = encodeURIComponent(meta.name);
    headers.set(
      "Content-Disposition",
      `inline; filename*=UTF-8''${safeName}`,
    );
  }
  return new Response(webStream, { status: 200, headers });
}
