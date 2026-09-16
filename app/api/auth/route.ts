import { cookies } from "next/headers";
import { configuredPins, editToken, currentRole } from "@/lib/shutdown-auth";
import type { EditRole } from "@/lib/shutdown-permissions";
export async function POST(request: Request) {
  const body = await request.json().catch(()=>null);
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  const role = (Object.entries(configuredPins()).find(([,value])=>value && value === pin)?.[0] || null) as EditRole | null;
  if (!role) return Response.json({ok:false},{status:401});
  (await cookies()).set("shutdown_edit",await editToken(`${role}:${pin}`),{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:60*60*8});
  return Response.json({ok:true,role});
}
export async function DELETE() { (await cookies()).set("shutdown_edit","",{httpOnly:true,secure:true,sameSite:"strict",path:"/",expires:new Date(0)}); return Response.json({ok:true}); }
export async function GET() { const role = await currentRole(); return Response.json({canEdit:Boolean(role),role}); }
