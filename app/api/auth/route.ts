import { cookies } from "next/headers";
import { env } from "cloudflare:workers";
const encoder = new TextEncoder();
async function editToken(pin: string) { const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(`ild-shutdown-plan:${pin}`)); return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
type EditRole = "admin" | "input";
function configuredPins() {
  const values = env as unknown as Record<string, string | undefined>;

  return {
    admin: values.ADMIN_PIN || values.EDIT_PIN || "PS2026",
    input: values.INPUT_PIN || "INPUT2026"
  };
}
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { pin?: string } | null; const pin = body?.pin?.trim() || "";
  const pins = configuredPins(); const role: EditRole | null = pin === pins.admin ? "admin" : pins.input && pin === pins.input ? "input" : null;
  if (!role) return Response.json({ ok: false }, { status: 401 });
  (await cookies()).set("shutdown_edit", await editToken(`${role}:${pin}`), { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 60 * 60 * 8 });
  return Response.json({ ok: true, role });
}
export async function DELETE() { (await cookies()).delete("shutdown_edit"); return Response.json({ ok: true }); }
export async function GET() {
  try {
    const role = await currentRole();

    return Response.json({
      canEdit: Boolean(role),
      role
    });
  } catch (error) {
    console.error("AUTH GET ERROR:", error);

    return Response.json({
      canEdit: false,
      role: null
    });
  }
}
