import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  authMock,
  hasUnlockCookieMock,
  listFolderFilesMock,
  getFileMetaMock,
  downloadFileStreamMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  hasUnlockCookieMock: vi.fn(),
  listFolderFilesMock: vi.fn(),
  getFileMetaMock: vi.fn(),
  downloadFileStreamMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/attio-unlock", async () => {
  const actual = await vi.importActual<typeof import("@/lib/attio-unlock")>(
    "@/lib/attio-unlock",
  );
  return {
    ...actual,
    hasUnlockCookie: hasUnlockCookieMock,
    getAttioApiKey: vi.fn(() => "test-attio"),
  };
});
// Mock the Drive client at the module boundary so the routes exercise their
// own logic but never reach for real credentials.
vi.mock("@/lib/clients/driveClient", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/clients/driveClient")
  >("@/lib/clients/driveClient");
  return {
    ...actual,
    listFolderFiles: listFolderFilesMock,
    getFileMeta: getFileMetaMock,
    downloadFileStream: downloadFileStreamMock,
    getFolderConfig: () => ({
      checklistFolderId: "checklist-folder",
      contractsFolderId: "contracts-folder",
      footageFolderId: "footage-folder",
    }),
  };
});

import { GET as healthGET } from "@/app/api/demos/health/route";
import { GET as checklistGET } from "@/app/api/demos/checklist/route";
import { GET as contractsGET } from "@/app/api/demos/contracts/route";
import { GET as footageGET } from "@/app/api/demos/footage/route";
import { GET as fileGET } from "@/app/api/demos/file/[id]/route";

beforeEach(() => {
  authMock.mockReset();
  hasUnlockCookieMock.mockReset();
  listFolderFilesMock.mockReset();
  getFileMetaMock.mockReset();
  downloadFileStreamMock.mockReset();
});

// Bearer/cookie are interchangeable for the routes' point of view —
// authedUserFromRequest checks Bearer first, then falls through to NextAuth.
// We exercise the cookie path here because mocking the JWT verifier would
// add cost without coverage. authedUser() below populates auth() + the
// unlock-cookie reader so the cookie path resolves to a real user.
function authedRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function unauthedRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function authedUser() {
  authMock.mockResolvedValue({ user: { email: "ops@micro-agi.com" } });
  hasUnlockCookieMock.mockResolvedValue(false);
}

const sampleFile = {
  id: "file-1",
  name: "Sales Checklist.pdf",
  mimeType: "application/pdf",
  modifiedTime: "2026-04-26T15:00:00.000Z",
  size: 123456,
};

describe("/api/demos/health", () => {
  it("returns 200 with counts when the three folders list successfully", async () => {
    authedUser();
    listFolderFilesMock
      .mockResolvedValueOnce([sampleFile])
      .mockResolvedValueOnce([sampleFile, sampleFile])
      .mockResolvedValueOnce([sampleFile, sampleFile, sampleFile]);
    const res = await healthGET(authedRequest("/api/demos/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; counts: Record<string, number> };
    expect(body.ok).toBe(true);
    expect(body.counts).toEqual({ checklist: 1, contracts: 2, footage: 3 });
  });

  it("returns 401 without auth", async () => {
    authMock.mockResolvedValue(null);
    hasUnlockCookieMock.mockResolvedValue(false);
    const res = await healthGET(unauthedRequest("/api/demos/health"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthenticated");
  });

  it("returns 500 with the underlying error if a folder list fails", async () => {
    authedUser();
    listFolderFilesMock.mockRejectedValueOnce(new Error("Drive API outage"));
    const res = await healthGET(authedRequest("/api/demos/health"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Drive API outage");
  });
});

describe("/api/demos/contracts", () => {
  it("returns the files array with the iOS-codable shape", async () => {
    authedUser();
    listFolderFilesMock.mockResolvedValueOnce([sampleFile]);
    const res = await contractsGET(authedRequest("/api/demos/contracts"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: Array<Record<string, unknown>>;
    };
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toEqual({
      id: "file-1",
      name: "Sales Checklist.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2026-04-26T15:00:00.000Z",
      size: 123456,
    });
  });

  it("returns 401 without auth", async () => {
    authMock.mockResolvedValue(null);
    hasUnlockCookieMock.mockResolvedValue(false);
    const res = await contractsGET(unauthedRequest("/api/demos/contracts"));
    expect(res.status).toBe(401);
  });

  it("uses the contracts folder, not checklist or footage", async () => {
    authedUser();
    listFolderFilesMock.mockResolvedValueOnce([]);
    await contractsGET(authedRequest("/api/demos/contracts"));
    expect(listFolderFilesMock).toHaveBeenCalledWith("contracts-folder");
  });
});

describe("/api/demos/footage", () => {
  it("returns 401 without auth", async () => {
    authMock.mockResolvedValue(null);
    hasUnlockCookieMock.mockResolvedValue(false);
    const res = await footageGET(unauthedRequest("/api/demos/footage"));
    expect(res.status).toBe(401);
  });

  it("uses the footage folder", async () => {
    authedUser();
    listFolderFilesMock.mockResolvedValueOnce([]);
    await footageGET(authedRequest("/api/demos/footage"));
    expect(listFolderFilesMock).toHaveBeenCalledWith("footage-folder");
  });
});

describe("/api/demos/checklist", () => {
  it("returns the newest file (first list entry)", async () => {
    authedUser();
    const newer = { ...sampleFile, id: "newer", modifiedTime: "2026-04-26T20:00:00.000Z" };
    const older = { ...sampleFile, id: "older", modifiedTime: "2026-04-25T20:00:00.000Z" };
    // listFolderFiles already returns newest first (orderBy modifiedTime desc).
    listFolderFilesMock.mockResolvedValueOnce([newer, older]);
    const res = await checklistGET(authedRequest("/api/demos/checklist"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: { id: string } | null };
    expect(body.file?.id).toBe("newer");
  });

  it("returns null file when the folder is empty", async () => {
    authedUser();
    listFolderFilesMock.mockResolvedValueOnce([]);
    const res = await checklistGET(authedRequest("/api/demos/checklist"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: unknown };
    expect(body.file).toBeNull();
  });

  it("returns 401 without auth", async () => {
    authMock.mockResolvedValue(null);
    hasUnlockCookieMock.mockResolvedValue(false);
    const res = await checklistGET(unauthedRequest("/api/demos/checklist"));
    expect(res.status).toBe(401);
  });
});

describe("/api/demos/file/[id]", () => {
  it("returns 404 when the requested id's parents don't include any configured folder", async () => {
    authedUser();
    getFileMetaMock.mockResolvedValueOnce({
      id: "evil",
      name: "secrets.txt",
      mimeType: "text/plain",
      parents: ["some-other-folder"],
    });
    const res = await fileGET(
      authedRequest("/api/demos/file/evil"),
      { params: Promise.resolve({ id: "evil" }) },
    );
    expect(res.status).toBe(404);
    expect(downloadFileStreamMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the file doesn't exist", async () => {
    authedUser();
    getFileMetaMock.mockResolvedValueOnce(null);
    const res = await fileGET(
      authedRequest("/api/demos/file/missing"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("streams the file and sets Content-Type when the parent is allowlisted", async () => {
    authedUser();
    getFileMetaMock.mockResolvedValueOnce({
      id: "ok",
      name: "deck.pdf",
      mimeType: "application/pdf",
      size: 42,
      parents: ["contracts-folder"],
    });
    // Tiny readable stream of two chunks.
    const { Readable } = await import("node:stream");
    downloadFileStreamMock.mockResolvedValueOnce(
      Readable.from([Buffer.from("hello"), Buffer.from(" world")]),
    );
    const res = await fileGET(
      authedRequest("/api/demos/file/ok"),
      { params: Promise.resolve({ id: "ok" }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Length")).toBe("42");
    const text = await res.text();
    expect(text).toBe("hello world");
  });

  it("returns 401 without auth (and does not even hit Drive)", async () => {
    authMock.mockResolvedValue(null);
    hasUnlockCookieMock.mockResolvedValue(false);
    const res = await fileGET(
      unauthedRequest("/api/demos/file/anything"),
      { params: Promise.resolve({ id: "anything" }) },
    );
    expect(res.status).toBe(401);
    expect(getFileMetaMock).not.toHaveBeenCalled();
    expect(downloadFileStreamMock).not.toHaveBeenCalled();
  });
});
