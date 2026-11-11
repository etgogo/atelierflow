-- Migration 03: PostgreSQL business rules for planning conflicts, mileage integrity and history

CREATE OR REPLACE FUNCTION public.check_mechanic_appointment_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.appointment_mechanics new_am
    JOIN public.appointments new_a ON new_a.id = new_am.appointment_id
    JOIN public.appointment_mechanics existing_am ON existing_am.mechanic_profile_id = new_am.mechanic_profile_id
    JOIN public.appointments existing_a ON existing_a.id = existing_am.appointment_id
    WHERE new_am.id = NEW.id
      AND existing_am.id <> NEW.id
      AND existing_a.garage_id = new_a.garage_id
      AND existing_a.starts_at < new_a.ends_at
      AND existing_a.ends_at > new_a.starts_at
  ) THEN
    RAISE EXCEPTION 'Overlapping appointment detected for the same mechanic in the same garage.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointment_mechanics_overlap_guard
BEFORE INSERT OR UPDATE ON public.appointment_mechanics
FOR EACH ROW
EXECUTE FUNCTION public.check_mechanic_appointment_overlap();

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
    ORDER BY recorded_at DESC
    LIMIT 1;

    IF v_entry_mileage IS NOT NULL AND NEW.mileage < v_entry_mileage THEN
      RAISE EXCEPTION 'Exit mileage cannot be lower than entry mileage for the same work order.';
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
RETURNS TRIGGER AS $$
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.record_audit_triggers()
RETURNS VOID AS $$
BEGIN
  -- The audit trigger is created per table to avoid mass operations on protected tables.
  -- It uses auth.uid() and the current user identity if available.
  NULL;
END;
$$ LANGUAGE plpgsql;

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
