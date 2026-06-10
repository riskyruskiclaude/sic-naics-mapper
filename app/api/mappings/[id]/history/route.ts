import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mappingRevisions, naicsCodes } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const revisions = await db
    .select({
      revision: mappingRevisions,
      naicsTitle: naicsCodes.title,
    })
    .from(mappingRevisions)
    .leftJoin(naicsCodes, eq(mappingRevisions.naicsCode, naicsCodes.code))
    .where(eq(mappingRevisions.mappingId, parseInt(id)))
    .orderBy(desc(mappingRevisions.createdAt));

  return NextResponse.json(revisions);
}
