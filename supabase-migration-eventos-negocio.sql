-- =========================================
-- Miga Dashboard — Registro de eventos de negocio
-- Ejecutar en: Supabase Dashboard -> SQL Editor
-- (mismo proyecto de Supabase que usa miga-pos-v2, pero esta tabla es
-- exclusiva del dashboard — no la toca la tablet)
-- =========================================

CREATE TABLE IF NOT EXISTS eventos_negocio (
  id          BIGSERIAL PRIMARY KEY,
  fecha       TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  categoria   TEXT NOT NULL DEFAULT 'otro',
  creado_en   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE eventos_negocio ENABLE ROW LEVEL SECURITY;

-- Mismo patron que el resto de las tablas del proyecto hermano: cualquier
-- usuario autenticado (con sesion valida) puede leer/escribir. No hay
-- multiples usuarios con permisos distintos, es solo el dueño logueado.
CREATE POLICY eventos_negocio_select ON eventos_negocio FOR SELECT TO authenticated USING (true);
CREATE POLICY eventos_negocio_insert ON eventos_negocio FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY eventos_negocio_delete ON eventos_negocio FOR DELETE TO authenticated USING (true);
