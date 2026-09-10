import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const scheduleCells = sqliteTable("schedule_cells", {
  rowKey: text("row_key").notNull(), hourIndex: integer("hour_index").notNull(),
  value: integer("value").notNull().default(0), updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.rowKey, table.hourIndex] })]);
export const shutdownSettings = sqliteTable("shutdown_settings", {
  key: text("key").primaryKey(), value: text("value").notNull(), updatedAt: text("updated_at").notNull(),
});
export const shutdownNotes = sqliteTable("shutdown_notes", {
  rowKey: text("row_key").primaryKey(), content: text("content").notNull().default(""), updatedAt: text("updated_at").notNull(),
});
