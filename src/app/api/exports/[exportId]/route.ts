import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import path from "node:path";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Uploaded/generated files are never served from /public - this route
// enforces the same authenticated-session check as every other page before
// streaming a file back (section 25: "geen publieke toegang tot uploads").
export async function GET(_req: Request, { params }: { params: { exportId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const exportRecord = await prisma.quoteExport.findUnique({ where: { id: params.exportId } });
  if (!exportRecord || !exportRecord.fileData) {
    return new NextResponse("Not found", { status: 404 });
  }

  const fileName = exportRecord.filePath ? path.basename(exportRecord.filePath) : "export.xlsx";

  return new NextResponse(new Uint8Array(exportRecord.fileData), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
