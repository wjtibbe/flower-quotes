import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import fs from "node:fs/promises";
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
  if (!exportRecord || !exportRecord.filePath) {
    return new NextResponse("Not found", { status: 404 });
  }

  const absolutePath = path.join(process.cwd(), exportRecord.filePath);
  const buffer = await fs.readFile(absolutePath);
  const fileName = path.basename(exportRecord.filePath);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
