import { cookies } from "next/headers";
import { env } from "cloudflare:workers";
const encoder = new TextEncoder();
async function token(pin: string) { const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(`ild-shutdown-plan:${pin}`)); return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
type EditRole = "admin" | "input";
async function editRole(): Promise<EditRole | null> { const values = env as unknown as Record<string, string | undefined>; const admin = values.ADMIN_PIN || values.EDIT_PIN || "2026"; const input = values.INPUT_PIN || ""; const cookie = (await cookies()).get("shutdown_edit")?.value; if (cookie === await token(`admin:${admin}`)) return "admin"; if (input && cookie === await token(`input:${input}`)) return "input"; return null; }
function inputMayEditCell(rowKey: string) { return /-actual$/.test(rowKey); }
function inputMayEditNote(rowKey: string) { return /-note(?:-h-\d+|-color-\d+|-merges)?$/.test(rowKey); }
export async function GET() {
  const [cells, settings, notes] = await Promise.all([
    env.DB.prepare("SELECT row_key AS rowKey, hour_index AS hourIndex, value FROM schedule_cells WHERE value <> 0 ORDER BY row_key, hour_index").all(),
    env.DB.prepare("SELECT key, value FROM shutdown_settings").all(),
    env.DB.prepare("SELECT row_key AS rowKey, content FROM shutdown_notes WHERE content <> ''").all(),
  ]); return Response.json({ cells: cells.results, settings: settings.results, notes: notes.results });
}
type Payload = { cells?: { rowKey: string; hourIndex: number; value: number }[]; settings?: { key: string; value: string }[]; notes?: { rowKey: string; content: string }[] };
export async function PATCH(request: Request) {
  const role = await editRole(); if (!role) return Response.json({ message: "Cần mở khóa chỉnh sửa" }, { status: 403 });
  const body = (await request.json()) as Payload; const now = new Date().toISOString(); const statements: D1PreparedStatement[] = [];
  for (const cell of (body.cells || []).slice(0, 500)) { if (!/^[a-z0-9-]{2,60}$/.test(cell.rowKey) || (role === "input" && !inputMayEditCell(cell.rowKey)) || !Number.isInteger(cell.hourIndex) || cell.hourIndex < 0 || cell.hourIndex > 95) continue; const value = Number.isFinite(cell.value) ? Math.max(0, Math.min(999, Math.trunc(cell.value))) : 0; statements.push(env.DB.prepare("INSERT INTO schedule_cells (row_key, hour_index, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(row_key, hour_index) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(cell.rowKey, cell.hourIndex, value, now)); }
  for (const setting of (body.settings || []).slice(0, 10)) { if (role !== "admin" || !/^[a-zA-Z0-9_-]{2,40}$/.test(setting.key) || setting.value.length > 100) continue; statements.push(env.DB.prepare("INSERT INTO shutdown_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(setting.key, setting.value, now)); }
  for (const note of (body.notes || []).slice(0, 50)) { if (!/^[a-z0-9-]{2,60}$/.test(note.rowKey) || (role === "input" && !inputMayEditNote(note.rowKey)) || note.content.length > 600) continue; statements.push(env.DB.prepare("INSERT INTO shutdown_notes (row_key, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(row_key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at").bind(note.rowKey, note.content, now)); }
  if (statements.length) await env.DB.batch(statements); return Response.json({ ok: true, updatedAt: now });
}
