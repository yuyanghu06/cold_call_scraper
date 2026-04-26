// Google Drive client for the iOS Demos section. The service account has
// read access to three specific folders; this module caches the auth +
// drive client across requests on the same Vercel lambda instance so we
// don't re-init per request.
//
// Security: never log GOOGLE_SERVICE_ACCOUNT_JSON, even partially.
// Folder IDs are the only allowed root for /api/demos/file/:id — the
// route-side parent-folder check is what keeps this from being an open
// Drive proxy for any file the service account can see.

import { google, type drive_v3 } from "googleapis";
import type { Readable } from "node:stream";

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

// DemoFile is the iOS Codable shape — keep field names verbatim.
export interface DemoFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: number;
}

export interface FolderConfig {
  checklistFolderId: string;
  contractsFolderId: string;
  footageFolderId: string;
}

let cachedDrive: drive_v3.Drive | null = null;

function loadServiceAccountCredentials(): Record<string, unknown> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Don't echo the raw value in the error — even a truncated copy can
    // surface the private key.
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
}

export function getDriveClient(): drive_v3.Drive {
  if (cachedDrive) return cachedDrive;
  const credentials = loadServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  cachedDrive = google.drive({ version: "v3", auth });
  return cachedDrive;
}

// For tests: lets a vitest mock replace the cached drive client without
// touching env. Production code never calls this.
export function _setDriveClientForTests(client: drive_v3.Drive | null): void {
  cachedDrive = client;
}

export function getFolderConfig(): FolderConfig {
  const checklistFolderId = process.env.DEMOS_CHECKLIST_FOLDER_ID?.trim();
  const contractsFolderId = process.env.DEMOS_CONTRACTS_FOLDER_ID?.trim();
  const footageFolderId = process.env.DEMOS_FOOTAGE_FOLDER_ID?.trim();
  if (!checklistFolderId) throw new Error("DEMOS_CHECKLIST_FOLDER_ID is not set");
  if (!contractsFolderId) throw new Error("DEMOS_CONTRACTS_FOLDER_ID is not set");
  if (!footageFolderId) throw new Error("DEMOS_FOOTAGE_FOLDER_ID is not set");
  return { checklistFolderId, contractsFolderId, footageFolderId };
}

function toDemoFile(f: drive_v3.Schema$File): DemoFile | null {
  if (!f.id || !f.name || !f.mimeType || !f.modifiedTime) return null;
  const out: DemoFile = {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
  };
  if (typeof f.size === "string") {
    const n = Number(f.size);
    if (Number.isFinite(n)) out.size = n;
  } else if (typeof f.size === "number" && Number.isFinite(f.size)) {
    out.size = f.size;
  }
  return out;
}

// List non-trashed files in a single folder, newest first. Folders are
// expected to be small (<1000 files), so we don't paginate.
export async function listFolderFiles(folderId: string): Promise<DemoFile[]> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,modifiedTime,size)",
    orderBy: "modifiedTime desc",
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const raw = res.data.files ?? [];
  const out: DemoFile[] = [];
  for (const f of raw) {
    const mapped = toDemoFile(f);
    if (mapped) out.push(mapped);
  }
  return out;
}

// Metadata fetch used by /api/demos/file/:id for the parent-folder check.
// Returns null if the file doesn't exist or the service account can't see
// it — same outward signal so the caller can 404 either case.
export async function getFileMeta(
  fileId: string,
): Promise<{
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  parents: string[];
} | null> {
  const drive = getDriveClient();
  try {
    const res = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size,parents",
      supportsAllDrives: true,
    });
    const f = res.data;
    if (!f.id || !f.name || !f.mimeType) return null;
    let size: number | undefined;
    if (typeof f.size === "string") {
      const n = Number(f.size);
      if (Number.isFinite(n)) size = n;
    } else if (typeof f.size === "number") {
      size = f.size;
    }
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size,
      parents: f.parents ?? [],
    };
  } catch (err) {
    const status = (err as { code?: number; status?: number })?.code
      ?? (err as { code?: number; status?: number })?.status;
    if (status === 404) return null;
    throw err;
  }
}

// Returns a node Readable streaming the file's bytes. Caller is responsible
// for piping it to the HTTP response without buffering — these files can be
// large videos.
export async function downloadFileStream(fileId: string): Promise<Readable> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    {
      fileId,
      alt: "media",
      supportsAllDrives: true,
    },
    { responseType: "stream" },
  );
  return res.data as unknown as Readable;
}
