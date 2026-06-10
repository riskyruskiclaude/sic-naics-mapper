import { pgTable, serial, varchar, text, integer, timestamp, boolean, index, pgEnum } from "drizzle-orm/pg-core";

export const mappingMethodEnum = pgEnum("mapping_method", [
  "census_xwalk",           // direct 1:1 from Census crosswalk
  "census_xwalk_disambiguated", // multiple xwalk options, AI picked best
  "ai_generated",           // no xwalk match, AI generated
  "user_override",          // manually set by a user
]);

export const naicsCodes = pgTable("naics_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 6 }).notNull().unique(),
  title: text("title").notNull(),
  level: integer("level").notNull(), // 2=sector, 3=subsector, 4=group, 5=industry, 6=national
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
  sicCode: varchar("sic_code", { length: 4 }).notNull().unique(), // one active mapping per SIC
  naicsCode: varchar("naics_code", { length: 6 }).notNull(),      // 4, 5, or 6 digit
  naicsLevel: integer("naics_level").notNull().default(6),         // level of the mapped NAICS code
  confidence: integer("confidence").notNull().default(0),          // 0–100
  method: mappingMethodEnum("method").notNull(),
  rationale: text("rationale"),                                    // explanation of why this match
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("mapping_sic_idx").on(t.sicCode),
  index("mapping_naics_idx").on(t.naicsCode),
  index("mapping_method_idx").on(t.method),
  index("mapping_confidence_idx").on(t.confidence),
]);

// Full audit trail — every state the mapping has ever been in
export const mappingRevisions = pgTable("mapping_revisions", {
  id: serial("id").primaryKey(),
  mappingId: integer("mapping_id").notNull(),
  sicCode: varchar("sic_code", { length: 4 }).notNull(),
  naicsCode: varchar("naics_code", { length: 6 }).notNull(),
  naicsLevel: integer("naics_level").notNull(),
  confidence: integer("confidence").notNull(),
  method: mappingMethodEnum("method").notNull(),
  rationale: text("rationale"),
  changedBy: text("changed_by").notNull().default("system"), // "system" or user identifier
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("revision_mapping_idx").on(t.mappingId),
  index("revision_sic_idx").on(t.sicCode),
]);
