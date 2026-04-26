import { NextResponse } from "next/server";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import { getFolderConfig, listFolderFiles } from "@/lib/clients/driveClient";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const user = await authedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  try {
    const { checklistFolderId, contractsFolderId, footageFolderId } =
      getFolderConfig();
    const [checklist, contracts, footage] = await Promise.all([
      listFolderFiles(checklistFolderId),
      listFolderFiles(contractsFolderId),
      listFolderFiles(footageFolderId),
    ]);
    return NextResponse.json({
      ok: true,
      counts: {
        checklist: checklist.length,
        contracts: contracts.length,
        footage: footage.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
