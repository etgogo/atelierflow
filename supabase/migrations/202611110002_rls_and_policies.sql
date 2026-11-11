-- Migration 02: security + RLS + permission helpers
-- These policies implement access-control at the database layer, not only in the browser.

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_garage_ids()
RETURNS TABLE(garage_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $
  SELECT gm.garage_id
  FROM public.garage_memberships gm
  WHERE gm.profile_id = public.current_profile_id()
    AND gm.is_active = TRUE;
$$;

CREATE OR REPLACE FUNCTION public.is_garage_member(p_garage_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $
  SELECT EXISTS (
    SELECT 1
    FROM public.garage_memberships gm
    WHERE gm.garage_id = p_garage_id
      AND gm.profile_id = public.current_profile_id()
      AND gm.is_active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_garage_admin(p_garage_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $
  SELECT EXISTS (
    SELECT 1
    FROM public.garage_memberships gm
    WHERE gm.garage_id = p_garage_id
      AND gm.profile_id = public.current_profile_id()
      AND gm.is_active = TRUE
      AND gm.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_garage_id UUID, p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $
  SELECT COALESCE(
    (
      EXISTS (
        SELECT 1
        FROM public.garage_memberships gm
        LEFT JOIN public.membership_permissions mp
          ON mp.membership_id = gm.id AND mp.permission_key = p_permission_key
        WHERE gm.garage_id = p_garage_id
          AND gm.profile_id = public.current_profile_id()
          AND gm.is_active = TRUE
          AND (gm.role = 'admin' OR COALESCE(mp.allowed, FALSE) = TRUE)
      )
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_work_order(p_work_order_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $
  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders wo
    JOIN public.garage_memberships gm
      ON gm.garage_id = wo.garage_id
    WHERE wo.id = p_work_order_id
      AND gm.profile_id = public.current_profile_id()
      AND gm.is_active = TRUE
  );
$$;

-- garage tables
CREATE POLICY "garage_select_members"
ON public.garages
FOR SELECT
USING (public.is_garage_member(id));

CREATE POLICY "garage_admin_update"
ON public.garages
FOR UPDATE
USING (public.is_garage_admin(id));

CREATE POLICY "garage_admin_insert"
ON public.garages
FOR INSERT
WITH CHECK (public.is_garage_admin(id));

-- profiles
CREATE POLICY "profiles_self_read"
ON public.profiles
FOR SELECT
USING (id = public.current_profile_id());

CREATE POLICY "profiles_member_read"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.garage_memberships gm
    WHERE gm.profile_id = public.profiles.id
      AND gm.is_active = TRUE
      AND gm.garage_id IN (SELECT garage_id FROM public.current_garage_ids())
  )
);

CREATE POLICY "profiles_self_update"
ON public.profiles
FOR UPDATE
USING (id = public.current_profile_id());

-- A profile may edit its contact details, but cannot reactivate/deactivate itself
-- or change its identity through the self-service update policy.
CREATE OR REPLACE FUNCTION public.prevent_profile_security_field_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Profile identity and activation state can only be changed by an authorized administrator.';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS profiles_protect_security_fields ON public.profiles;
CREATE TRIGGER profiles_protect_security_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_security_field_changes();

CREATE POLICY "profiles_self_insert"
ON public.profiles
FOR INSERT
WITH CHECK (id = auth.uid());

-- garage_memberships
CREATE POLICY "garage_memberships_read_members"
ON public.garage_memberships
FOR SELECT
USING (
  profile_id = public.current_profile_id()
  OR garage_id IN (SELECT garage_id FROM public.current_garage_ids())
);

CREATE POLICY "garage_memberships_admin_manage"
ON public.garage_memberships
FOR ALL
USING (public.is_garage_admin(garage_id));

-- permission definition
CREATE POLICY "permission_definitions_member_read"
ON public.permission_definitions
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "permission_definitions_admin_manage"
ON public.permission_definitions
FOR ALL
USING (public.is_garage_admin(garage_id));

-- membership permissions
CREATE POLICY "membership_permissions_member_read"
ON public.membership_permissions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.garage_memberships gm
    WHERE gm.id = membership_permissions.membership_id
      AND gm.garage_id IN (SELECT garage_id FROM public.current_garage_ids())
  )
);

CREATE POLICY "membership_permissions_admin_manage"
ON public.membership_permissions
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.garage_memberships gm
    WHERE gm.id = membership_permissions.membership_id
      AND public.is_garage_admin(gm.garage_id)
  )
);

-- mechanic profiles
CREATE POLICY "mechanic_profiles_member_read"
ON public.mechanic_profiles
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "mechanic_profiles_admin_manage"
ON public.mechanic_profiles
FOR ALL
USING (public.is_garage_admin(garage_id));

-- clients
CREATE POLICY "clients_member_read"
ON public.clients
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "clients_admin_manage"
ON public.clients
FOR ALL
USING (public.is_garage_admin(garage_id));

-- vehicles
CREATE POLICY "vehicles_member_read"
ON public.vehicles
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "vehicles_admin_manage"
ON public.vehicles
FOR ALL
USING (public.is_garage_admin(garage_id));

-- work orders
CREATE POLICY "work_orders_member_read"
ON public.work_orders
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "work_orders_admin_manage"
ON public.work_orders
FOR ALL
USING (public.is_garage_admin(garage_id));

-- appointments
CREATE POLICY "appointments_member_read"
ON public.appointments
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "appointments_admin_manage"
ON public.appointments
FOR ALL
USING (public.is_garage_admin(garage_id));

-- appointment mechanics
CREATE POLICY "appointment_mechanics_member_read"
ON public.appointment_mechanics
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "appointment_mechanics_admin_manage"
ON public.appointment_mechanics
FOR ALL
USING (public.is_garage_admin(garage_id));

-- mileage readings
CREATE POLICY "mileage_readings_member_read"
ON public.mileage_readings
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "mileage_readings_admin_manage"
ON public.mileage_readings
FOR ALL
USING (public.is_garage_admin(garage_id));

-- keys
CREATE POLICY "key_custody_events_member_read"
ON public.key_custody_events
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "key_custody_events_admin_manage"
ON public.key_custody_events
FOR ALL
USING (public.is_garage_admin(garage_id));

-- checklist templates and categories/items
CREATE POLICY "checklist_templates_member_read"
ON public.checklist_templates
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "checklist_templates_admin_manage"
ON public.checklist_templates
FOR ALL
USING (public.is_garage_admin(garage_id));

CREATE POLICY "checklist_categories_member_read"
ON public.checklist_categories
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "checklist_categories_admin_manage"
ON public.checklist_categories
FOR ALL
USING (public.is_garage_admin(garage_id));

CREATE POLICY "checklist_items_member_read"
ON public.checklist_items
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "checklist_items_admin_manage"
ON public.checklist_items
FOR ALL
USING (public.is_garage_admin(garage_id));

-- inspections and results
CREATE POLICY "inspections_member_read"
ON public.inspections
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "inspections_admin_manage"
ON public.inspections
FOR ALL
USING (public.is_garage_admin(garage_id));

CREATE POLICY "inspection_results_member_read"
ON public.inspection_results
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "inspection_results_admin_manage"
ON public.inspection_results
FOR ALL
USING (public.is_garage_admin(garage_id));

-- anomalies
CREATE POLICY "anomalies_member_read"
ON public.anomalies
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "anomalies_admin_manage"
ON public.anomalies
FOR ALL
USING (public.is_garage_admin(garage_id));

-- attachments
CREATE POLICY "attachments_member_read"
ON public.attachments
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "attachments_admin_manage"
ON public.attachments
FOR ALL
USING (public.is_garage_admin(garage_id));

-- parts
CREATE POLICY "parts_member_read"
ON public.parts
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "parts_admin_manage"
ON public.parts
FOR ALL
USING (public.is_garage_admin(garage_id));

-- work order parts
CREATE POLICY "work_order_parts_member_read"
ON public.work_order_parts
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "work_order_parts_admin_manage"
ON public.work_order_parts
FOR ALL
USING (public.is_garage_admin(garage_id));

-- quotes
CREATE POLICY "quotes_member_read"
ON public.quotes
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "quotes_admin_manage"
ON public.quotes
FOR ALL
USING (public.is_garage_admin(garage_id));

CREATE POLICY "quote_items_member_read"
ON public.quote_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.id = quote_items.quote_id
      AND public.is_garage_member(q.garage_id)
  )
);

CREATE POLICY "quote_items_admin_manage"
ON public.quote_items
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.id = quote_items.quote_id
      AND public.is_garage_admin(q.garage_id)
  )
);

CREATE POLICY "quote_decisions_member_read"
ON public.quote_decisions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.id = quote_decisions.quote_id
      AND public.is_garage_member(q.garage_id)
  )
);

CREATE POLICY "quote_decisions_admin_manage"
ON public.quote_decisions
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.id = quote_decisions.quote_id
      AND public.is_garage_admin(q.garage_id)
  )
);

-- reports and audit
CREATE POLICY "reports_member_read"
ON public.reports
FOR SELECT
USING (public.is_garage_member(garage_id));

CREATE POLICY "reports_admin_manage"
ON public.reports
FOR ALL
USING (public.is_garage_admin(garage_id));

CREATE POLICY "audit_logs_member_read"
ON public.audit_logs
FOR SELECT
USING (public.is_garage_member(garage_id));

-- Audit rows are append-only. Inserts are performed by the SECURITY DEFINER
-- audit trigger; application roles receive read access only through the policy above.

-- The attachments policies are defined once above; duplicate policy names
-- cause PostgreSQL to abort this migration.
