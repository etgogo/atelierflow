-- Migration 04: explicit API grants and secure first-garage bootstrap.
-- Apply only after migrations 001-003 have been reviewed and tested on a clean project.

CREATE SCHEMA IF NOT EXISTS atelierflow_private;
REVOKE ALL ON SCHEMA atelierflow_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS atelierflow_private.garage_creation_claims (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  garage_id UUID UNIQUE REFERENCES public.garages(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON TABLE atelierflow_private.garage_creation_claims
FROM PUBLIC, anon, authenticated;

-- A signed-in user can create their first garage exactly once.
-- This function creates the profile, garage and initial administrator membership
-- atomically, without opening direct garage INSERT privileges to ordinary users.
CREATE OR REPLACE FUNCTION public.create_garage_with_admin(
  p_name TEXT,
  p_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_postal_code TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT 'Europe/Brussels'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, atelierflow_private
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_garage_id UUID;
  v_full_name TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to create a garage.'
      USING ERRCODE = '28000';
  END IF;

  IF NULLIF(BTRIM(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Garage name is required.'
      USING ERRCODE = '22023';
  END IF;

  v_full_name := COALESCE(
    NULLIF(BTRIM(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    NULLIF(BTRIM(auth.jwt() ->> 'email'), ''),
    'Utilisateur'
  );

  INSERT INTO public.profiles (id, full_name)
  VALUES (v_user_id, v_full_name)
  ON CONFLICT (id) DO NOTHING;

  -- The primary key is a one-time claim. A second call for the same profile fails.
  INSERT INTO atelierflow_private.garage_creation_claims (profile_id)
  VALUES (v_user_id);

  INSERT INTO public.garages (
    name, address, city, postal_code, phone, email, timezone
  )
  VALUES (
    BTRIM(p_name), p_address, p_city, p_postal_code, p_phone, p_email,
    COALESCE(NULLIF(BTRIM(p_timezone), ''), 'Europe/Brussels')
  )
  RETURNING id INTO v_garage_id;

  INSERT INTO public.garage_memberships (
    garage_id, profile_id, role, is_active
  )
  VALUES (v_garage_id, v_user_id, 'admin', TRUE);

  UPDATE atelierflow_private.garage_creation_claims
  SET garage_id = v_garage_id
  WHERE profile_id = v_user_id;

  RETURN v_garage_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_garage_with_admin(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_garage_with_admin(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

-- Revoke default PUBLIC/anonymous access, then grant the authenticated API role
-- the SQL privileges required for RLS policies to make the actual access decision.
REVOKE ALL ON TABLE
  public.garages,
  public.profiles,
  public.garage_memberships,
  public.permission_definitions,
  public.membership_permissions,
  public.mechanic_profiles,
  public.clients,
  public.vehicles,
  public.work_orders,
  public.appointments,
  public.appointment_mechanics,
  public.mileage_readings,
  public.key_custody_events,
  public.checklist_templates,
  public.checklist_categories,
  public.checklist_items,
  public.inspections,
  public.inspection_results,
  public.anomalies,
  public.attachments,
  public.parts,
  public.work_order_parts,
  public.quotes,
  public.quote_items,
  public.quote_decisions,
  public.reports,
  public.audit_logs
FROM PUBLIC, anon;

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.garages,
  public.profiles,
  public.garage_memberships,
  public.permission_definitions,
  public.membership_permissions,
  public.mechanic_profiles,
  public.clients,
  public.vehicles,
  public.work_orders,
  public.appointments,
  public.appointment_mechanics,
  public.mileage_readings,
  public.key_custody_events,
  public.checklist_templates,
  public.checklist_categories,
  public.checklist_items,
  public.inspections,
  public.inspection_results,
  public.anomalies,
  public.attachments,
  public.parts,
  public.work_order_parts,
  public.quotes,
  public.quote_items,
  public.quote_decisions,
  public.reports
TO authenticated;

GRANT SELECT ON TABLE public.audit_logs TO authenticated;
REVOKE ALL ON TABLE public.v_vehicle_key_status FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_vehicle_key_status TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_garage_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_garage_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_garage_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_work_order(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.record_audit_triggers() FROM PUBLIC, anon, authenticated;

-- The key-status view must evaluate underlying table permissions and RLS
-- as the requesting user, not as the view owner.
ALTER VIEW public.v_vehicle_key_status SET (security_invoker = true);
