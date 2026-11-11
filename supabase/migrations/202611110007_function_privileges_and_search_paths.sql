-- Migration 07: tighten function execution and pin trigger-function search paths.
-- Review and apply only after validating the installed policies and trigger behavior.
-- RLS helper functions remain callable by authenticated users because policies invoke them.

ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.check_mechanic_appointment_overlap() SET search_path = pg_catalog, public;
ALTER FUNCTION public.check_appointment_time_overlap() SET search_path = pg_catalog, public;
ALTER FUNCTION public.check_mileage_consistency() SET search_path = pg_catalog, public;
ALTER FUNCTION public.ensure_work_order_has_required_mileage() SET search_path = pg_catalog, public;
ALTER FUNCTION public.record_audit_triggers() SET search_path = pg_catalog, public;

-- RLS helpers: signed-in users need EXECUTE for policy evaluation, anonymous users do not.
REVOKE ALL ON FUNCTION public.current_profile_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_garage_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_garage_member(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_garage_admin(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_permission(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_work_order(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_garage_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_garage_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_garage_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_work_order(UUID) TO authenticated;

-- These functions are invoked by PostgreSQL triggers, not by browser/API clients.
REVOKE ALL ON FUNCTION public.audit_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_audit_triggers() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_mechanic_appointment_overlap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_appointment_time_overlap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_mileage_consistency() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_work_order_has_required_mileage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_profile_security_field_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
