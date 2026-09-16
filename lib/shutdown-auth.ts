import { cookies } from "next/headers";
import { env } from "cloudflare:workers";
import type { EditRole } from "./shutdown-permissions";
export function configuredPins(): Record<EditRole,string> {
  const values = env as unknown as Record<string,string | undefined>;
  return { admin: values.ADMIN_PIN || values.EDIT_PIN || "PS2026", prod: values.PROD_PIN || "Prod26", main: values.MAIN_PIN || "Main26" };
}
export async function editToken(value: string) { const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`ild-shutdown-plan:${value}`)); return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join(""); }
export async function currentRole(): Promise<EditRole | null> {
  const cookie = (await cookies()).get("shutdown_edit")?.value;
  if (!cookie) return null;
  for (const [role,pin] of Object.entries(configuredPins())) if (pin && cookie === await editToken(`${role}:${pin}`)) return role as EditRole;
  return null;
}
