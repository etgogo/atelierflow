-- Migration 03: PostgreSQL business rules for planning conflicts, mileage integrity and history

-- Serialize scheduling changes by mechanic using transaction-scoped advisory locks.
-- The lock key depends only on mechanic_profile_id: different mechanics never block
-- each other's appointments, even when their time ranges are identical.
CREATE OR REPLACE FUNCTION public.check_mechanic_appointment_overlap()
RETURNS TRIGGER AS $$
DECLARE
  v_garage_id UUID;
  v_starts_at TIMESTAMPTZ;
  v_ends_at TIMESTAMPTZ;
BEGIN
  -- Lock/read the parent appointment first. This also ensures this trigger sees
  -- the committed time window if a concurrent appointment update just completed.
  SELECT a.garage_id, a.starts_at, a.ends_at
    INTO v_garage_id, v_starts_at, v_ends_at
  FROM public.appointments AS a
  WHERE a.id = NEW.appointment_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment % does not exist', NEW.appointment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- The assigned mechanic must belong to the same garage as the appointment.
  IF NOT EXISTS (
    SELECT 1
    FROM public.mechanic_profiles AS mp
    WHERE mp.id = NEW.mechanic_profile_id
      AND mp.garage_id = v_garage_id
  ) THEN
    RAISE EXCEPTION 'Assigned mechanic must belong to the appointment garage.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Same-mechanic writes serialize; unrelated mechanics use different locks.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.mechanic_profile_id::TEXT, 0)
  );

  -- Half-open intervals permit back-to-back appointments (10:00 end, 10:00 start).
  -- Exclude this appointment so INSERT and UPDATE both work using NEW values.
  IF EXISTS (
    SELECT 1
    FROM public.appointment_mechanics AS assigned
    JOIN public.appointments AS other_appointment
      ON other_appointment.id = assigned.appointment_id
    WHERE assigned.mechanic_profile_id = NEW.mechanic_profile_id
      AND assigned.appointment_id <> NEW.appointment_id
      AND other_appointment.status IN ('scheduled', 'in_progress')
      AND other_appointment.starts_at < v_ends_at
      AND other_appointment.ends_at > v_starts_at
  ) THEN
    RAISE EXCEPTION
      'Planning conflict: mechanic % already has an overlapping appointment',
      NEW.mechanic_profile_id
      USING ERRCODE = 'exclusion_violation';
  END IF;

  -- Keep the denormalized garage field consistent with its parent appointment.
  NEW.garage_id := v_garage_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointment_mechanics_overlap_guard
  ON public.appointment_mechanics;
CREATE TRIGGER appointment_mechanics_overlap_guard
BEFORE INSERT OR UPDATE OF appointment_id, mechanic_profile_id
ON public.appointment_mechanics
FOR EACH ROW
EXECUTE FUNCTION public.check_mechanic_appointment_overlap();

-- Changing appointment times must run the same check for every assigned mechanic.
-- Locks are acquired in a stable order so multi-mechanic appointments avoid
-- deadlocks with other updates affecting the same set of mechanics.
CREATE OR REPLACE FUNCTION public.check_appointment_time_overlap()
RETURNS TRIGGER AS $$
DECLARE
  v_mechanic_id UUID;
BEGIN
  IF NEW.status IN ('cancelled', 'completed') THEN
    RETURN NEW;
  END IF;

  FOR v_mechanic_id IN
    SELECT DISTINCT am.mechanic_profile_id
    FROM public.appointment_mechanics AS am
    WHERE am.appointment_id = NEW.id
    ORDER BY am.mechanic_profile_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_mechanic_id::TEXT, 0)
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.appointment_mechanics AS assigned
    JOIN public.appointment_mechanics AS other_assigned
      ON other_assigned.mechanic_profile_id = assigned.mechanic_profile_id
    JOIN public.appointments AS other_appointment
      ON other_appointment.id = other_assigned.appointment_id
    WHERE assigned.appointment_id = NEW.id
      AND other_assigned.appointment_id <> NEW.id
      AND other_appointment.status IN ('scheduled', 'in_progress')
      AND other_appointment.starts_at < NEW.ends_at
      AND other_appointment.ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION
      'Planning conflict: changing appointment % would overlap another appointment for an assigned mechanic',
      NEW.id
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_time_overlap_guard ON public.appointments;
CREATE TRIGGER appointments_time_overlap_guard
BEFORE UPDATE OF starts_at, ends_at, status
ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.check_appointment_time_overlap();

CREATE OR REPLACE FUNCTION public.check_mileage_consistency()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_mileage INTEGER;
BEGIN
  IF NEW.reading_type = 'exit' THEN
    SELECT mileage INTO v_entry_mileage
    FROM public.mileage_readings
    WHERE work_order_id = NEW.work_order_id
      AND reading_type = 'entry'
      AND id IS DISTINCT FROM NEW.id
    ORDER BY recorded_at DESC
    LIMIT 1;

    IF v_entry_mileage IS NOT NULL AND NEW.mileage < v_entry_mileage THEN
      RAISE EXCEPTION 'Exit mileage cannot be lower than entry mileage for the same work order.';
    END IF;
  ELSIF NEW.reading_type = 'entry' THEN
    SELECT mileage INTO v_entry_mileage
    FROM public.mileage_readings
    WHERE work_order_id = NEW.work_order_id
      AND reading_type = 'exit'
      AND id IS DISTINCT FROM NEW.id
    ORDER BY recorded_at DESC
    LIMIT 1;

    IF v_entry_mileage IS NOT NULL AND NEW.mileage > v_entry_mileage THEN
      RAISE EXCEPTION 'Entry mileage cannot be higher than exit mileage for the same work order.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mileage_readings_consistency_guard
BEFORE INSERT OR UPDATE ON public.mileage_readings
FOR EACH ROW
EXECUTE FUNCTION public.check_mileage_consistency();

CREATE OR REPLACE FUNCTION public.audit_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    garage_id,
    entity_type,
    entity_id,
    action,
    actor_profile_id,
    details
  )
  VALUES (
    COALESCE(NEW.garage_id, OLD.garage_id),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    auth.uid(),
    jsonb_build_object(
      'old', to_jsonb(OLD),
      'new', to_jsonb(NEW)
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_audit_triggers()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'garage_memberships',
    'permission_definitions',
    'mechanic_profiles',
    'clients',
    'vehicles',
    'work_orders',
    'appointments',
    'appointment_mechanics',
    'mileage_readings',
    'key_custody_events',
    'checklist_templates',
    'checklist_categories',
    'checklist_items',
    'inspections',
    'inspection_results',
    'anomalies',
    'attachments',
    'parts',
    'work_order_parts',
    'quotes',
    'reports'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_change_row ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER audit_change_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_change()',
      v_table
    );
  END LOOP;
END;
$$;

SELECT public.record_audit_triggers();

-- Example of a helper view for planning cells and key status.
CREATE OR REPLACE VIEW public.v_vehicle_key_status AS
SELECT
  v.id AS vehicle_id,
  v.garage_id,
  v.registration_number,
  COALESCE(
    (
      SELECT ke.event_type
      FROM public.key_custody_events ke
      WHERE ke.vehicle_id = v.id
      ORDER BY ke.recorded_at DESC
      LIMIT 1
    ),
    'returned'
  ) AS latest_key_event,
  COALESCE(
    (
      SELECT ke.keys_count
      FROM public.key_custody_events ke
      WHERE ke.vehicle_id = v.id
      ORDER BY ke.recorded_at DESC
      LIMIT 1
    ),
    0
  ) AS keys_count,
  COALESCE(
    (
      SELECT ke.recorded_at
      FROM public.key_custody_events ke
      WHERE ke.vehicle_id = v.id
      ORDER BY ke.recorded_at DESC
      LIMIT 1
    ),
    NULL
  ) AS last_key_event_at
FROM public.vehicles v;

-- Additional constraints to enforce consistent key state.
ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_key_count_not_negative
  CHECK (keys_count >= 0);

ALTER TABLE public.key_custody_events
  ADD CONSTRAINT key_custody_events_count_not_negative
  CHECK (keys_count >= 0);

ALTER TABLE public.appointment_mechanics
  ADD CONSTRAINT appointment_mechanics_unique_per_mechanic
  UNIQUE (garage_id, mechanic_profile_id, appointment_id);

CREATE OR REPLACE FUNCTION public.ensure_work_order_has_required_mileage()
RETURNS TRIGGER AS $$
DECLARE
  v_has_entry BOOLEAN := FALSE;
  v_has_exit BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.mileage_readings mr
    WHERE mr.work_order_id = NEW.id
      AND mr.reading_type = 'entry'
  ) INTO v_has_entry;

  SELECT EXISTS (
    SELECT 1
    FROM public.mileage_readings mr
    WHERE mr.work_order_id = NEW.id
      AND mr.reading_type = 'exit'
  ) INTO v_has_exit;

  IF NEW.status = 'closed' AND (NOT v_has_entry OR NOT v_has_exit) THEN
    RAISE EXCEPTION 'Closed work orders require both entry and exit mileage readings.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_orders_mileage_guard
AFTER INSERT OR UPDATE OF status ON public.work_orders
FOR EACH ROW
EXECUTE FUNCTION public.ensure_work_order_has_required_mileage();
