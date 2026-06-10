import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mappings, mappingRevisions, naicsCodes } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { naicsCode, rationale, changedBy } = body;

  if (!naicsCode || typeof naicsCode !== "string") {
    return NextResponse.json({ error: "naicsCode required" }, { status: 400 });
  }

  // Look up the NAICS level for this code
  const naics = await db.select().from(naicsCodes).where(eq(naicsCodes.code, naicsCode)).limit(1);
  if (!naics.length) {
    return NextResponse.json({ error: "NAICS code not found" }, { status: 400 });
  }

  const mappingId = parseInt(id);
  const existing = await db.select().from(mappings).where(eq(mappings.id, mappingId)).limit(1);
  if (!existing.length) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const current = existing[0];

  // Save current state to history before updating
  await db.insert(mappingRevisions).values({
    mappingId,
    sicCode: current.sicCode,
    naicsCode: current.naicsCode,
    naicsLevel: current.naicsLevel,
    confidence: current.confidence,
    method: current.method,
    rationale: current.rationale,
    changedBy: "system",
  });

  // Apply the update
  const updated = await db
    .update(mappings)
    .set({
      naicsCode,
      naicsLevel: naics[0].level,
      method: "user_override",
      confidence: 100,
      rationale: rationale || null,
      updatedAt: new Date(),
    })
    .where(eq(mappings.id, mappingId))
    .returning();

  // Record the new state in history too
  await db.insert(mappingRevisions).values({
    mappingId,
    sicCode: updated[0].sicCode,
    naicsCode: updated[0].naicsCode,
    naicsLevel: updated[0].naicsLevel,
    confidence: updated[0].confidence,
    method: updated[0].method,
    rationale: updated[0].rationale,
    changedBy: changedBy || "user",
  });

  return NextResponse.json(updated[0]);
}
