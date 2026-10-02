export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "../../../lib/db";
import { conManejoErrores } from "../../../lib/api-utils";

export const GET = conManejoErrores(async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT id, concepto, importe, dia, meses_alternos_desde FROM gastos_fijos ORDER BY orden ASC, id ASC
  `;
  return NextResponse.json({ gastosFijos: rows });
});

export const POST = conManejoErrores(async function POST(request) {
  await ensureSchema();
  const { concepto, importe, dia, meses_alternos_desde } = await request.json();
  if (!concepto) {
    return NextResponse.json({ error: "Falta concepto" }, { status: 400 });
  }
  const [{ max }] = await sql`SELECT COALESCE(MAX(orden), -1) AS max FROM gastos_fijos`;
  const [row] = await sql`
    INSERT INTO gastos_fijos (concepto, importe, dia, orden, meses_alternos_desde)
    VALUES (${concepto}, ${Number(importe) || 0}, ${dia || ""}, ${max + 1}, ${meses_alternos_desde || null})
    RETURNING id, concepto, importe, dia, meses_alternos_desde
  `;
  return NextResponse.json({ gastoFijo: row });
});

export const PUT = conManejoErrores(async function PUT(request) {
  await ensureSchema();
  const { id, concepto, importe, dia, meses_alternos_desde } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 });
  }
  const [row] = await sql`
    UPDATE gastos_fijos
    SET concepto = ${concepto}, importe = ${Number(importe) || 0}, dia = ${dia || ""},
        meses_alternos_desde = ${meses_alternos_desde || null}
    WHERE id = ${id}
    RETURNING id, concepto, importe, dia, meses_alternos_desde
  `;
  return NextResponse.json({ gastoFijo: row });
});

export const DELETE = conManejoErrores(async function DELETE(request) {
  await ensureSchema();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 });
  }
  await sql`DELETE FROM gastos_fijos WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
});
