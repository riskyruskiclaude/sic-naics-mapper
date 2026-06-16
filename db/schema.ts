import { pgTable, serial, varchar, text, integer, timestamp, boolean, index, pgEnum } from "drizzle-orm/pg-core";

export const mappingMethodEnum = pgEnum("mapping_method", [
  "census_xwalk",
  "census_xwalk_disambiguated",
  "ai_generated",
  "user_override",
]);

export const naicsCodes = pgTable("naics_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 6 }).notNull().unique(),
  title: text("title").notNull(),
  level: integer("level").notNull(),
  parentCode: varchar("parent_code", { length: 6 }),
}, (t) => [
  index("naics_code_idx").on(t.code),
  index("naics_parent_idx").on(t.parentCode),
]);

export const sicCodes = pgTable("sic_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 4 }).notNull().unique(),
  description: text("description").notNull(),
  divisionCode: varchar("division_code", { length: 1 }).notNull(),
  divisionTitle: text("division_title").notNull(),
  majorGroupCode: varchar("major_group_code", { length: 2 }).notNull(),
  majorGroupTitle: text("major_group_title").notNull(),
  industryGroupCode: varchar("industry_group_code", { length: 3 }).notNull(),
  industryGroupTitle: text("industry_group_title").notNull(),
}, (t) => [
  index("sic_code_idx").on(t.code),
  index("sic_division_idx").on(t.divisionCode),
  index("sic_major_group_idx").on(t.majorGroupCode),
]);

export const mappings = pgTable("mappings", {
  id: serial("id").primaryKey(),
  sicCode: varchar("sic_code", { length: 4 }).notNull().unique(),
  naicsCode: varchar("naics_code", { length: 6 }).notNull(),
  naicsLevel: integer("naics_level").notNull().default(6),
  confidence: integer("confidence").notNull().default(0),
  method: mappingMethodEnum("method").notNull(),
  rationale: text("rationale"),
  xwalkFamiliesCount: integer("xwalk_families_count"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("mapping_sic_idx").on(t.sicCode),
  index("mapping_naics_idx").on(t.naicsCode),
  index("mapping_method_idx").on(t.method),
  index("mapping_confidence_idx").on(t.confidence),
]);

export const mappingRevisions = pgTable("mapping_revisions", {
  id: serial("id").primaryKey(),
  mappingId: integer("mapping_id").notNull(),
  sicCode: varchar("sic_code", { length: 4 }).notNull(),
  naicsCode: varchar("naics_code", { length: 6 }).notNull(),
  naicsLevel: integer("naics_level").notNull(),
  confidence: integer("confidence").notNull(),
  method: mappingMethodEnum("method").notNull(),
  rationale: text("rationale"),
  changedBy: text("changed_by").notNull().default("system"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("revision_mapping_idx").on(t.mappingId),
  index("revision_sic_idx").on(t.sicCode),
]);

// --- Validation (blind re-evaluation) ---

// One row per validation run — lets you compare multiple runs over time
export const validationRuns = pgTable("validation_runs", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),          // e.g. "Blind pass 1 – Jun 2026"
  model: text("model").notNull(),           // claude model used
  totalCodes: integer("total_codes").notNull().default(0),
  agreedCount: integer("agreed_count").notNull().default(0),   // exact NAICS match
  familyCount: integer("family_count").notNull().default(0),   // same 4-digit parent
  disagreedCount: integer("disagreed_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One row per SIC code per validation run
export const validationResults = pgTable("validation_results", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  sicCode: varchar("sic_code", { length: 4 }).notNull(),
  // What the blind AI suggested
  suggestedNaicsCode: varchar("suggested_naics_code", { length: 6 }).notNull(),
  suggestedNaicsLevel: integer("suggested_naics_level").notNull(),
  suggestedConfidence: integer("suggested_confidence").notNull(),
  suggestedRationale: text("suggested_rationale"),
  // What the official mapping says (snapshot at time of run)
  officialNaicsCode: varchar("official_naics_code", { length: 6 }).notNull(),
  officialMethod: mappingMethodEnum("official_method").notNull(),
  officialConfidence: integer("official_confidence").notNull(),
  // Agreement verdict
  verdict: varchar("verdict", { length: 16 }).notNull(), // "agree" | "family" | "disagree"
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("val_run_idx").on(t.runId),
  index("val_sic_idx").on(t.sicCode),
  index("val_verdict_idx").on(t.verdict),
]);
