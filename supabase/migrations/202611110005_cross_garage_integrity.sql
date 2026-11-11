-- Migration 05: enforce tenant consistency across related records.
-- RLS controls who may access rows; these triggers prevent an authorized member
-- from linking a row in their garage to a parent record owned by another garage.

CREATE OR REPLACE FUNCTION public.enforce_same_garage_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_parent_id UUID;
  v_parent_garage_id UUID;
BEGIN
  v_parent_id := NULLIF(to_jsonb(NEW) ->> TG_ARGV[1], '')::UUID;
  IF v_parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT garage_id FROM %s WHERE id = $1',
    TG_ARGV[0]::regclass
  )
  INTO v_parent_garage_id
  USING v_parent_id;

  IF v_parent_garage_id IS NULL THEN
    RAISE EXCEPTION 'Referenced record % does not exist in %.',
      v_parent_id, TG_ARGV[0]
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_parent_garage_id IS DISTINCT FROM NEW.garage_id THEN
    RAISE EXCEPTION 'Cross-garage reference rejected for %.% (garage % vs %).',
      TG_TABLE_NAME, TG_ARGV[1], NEW.garage_id, v_parent_garage_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_same_garage_reference() FROM PUBLIC, anon, authenticated;

-- Vehicles and work orders.
DROP TRIGGER IF EXISTS vehicles_client_garage_guard ON public.vehicles;
CREATE TRIGGER vehicles_client_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, client_id ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.clients', 'client_id');

DROP TRIGGER IF EXISTS work_orders_vehicle_garage_guard ON public.work_orders;
CREATE TRIGGER work_orders_vehicle_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, vehicle_id ON public.work_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.vehicles', 'vehicle_id');

DROP TRIGGER IF EXISTS work_orders_client_garage_guard ON public.work_orders;
CREATE TRIGGER work_orders_client_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, client_id ON public.work_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.clients', 'client_id');

-- Appointments and mechanic assignments.
DROP TRIGGER IF EXISTS appointments_work_order_garage_guard ON public.appointments;
CREATE TRIGGER appointments_work_order_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, work_order_id ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.work_orders', 'work_order_id');

DROP TRIGGER IF EXISTS appointment_mechanics_appointment_garage_guard ON public.appointment_mechanics;
CREATE TRIGGER appointment_mechanics_appointment_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, appointment_id ON public.appointment_mechanics
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.appointments', 'appointment_id');

DROP TRIGGER IF EXISTS appointment_mechanics_mechanic_garage_guard ON public.appointment_mechanics;
CREATE TRIGGER appointment_mechanics_mechanic_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, mechanic_profile_id ON public.appointment_mechanics
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.mechanic_profiles', 'mechanic_profile_id');

-- Mileage and key custody.
DROP TRIGGER IF EXISTS mileage_readings_work_order_garage_guard ON public.mileage_readings;
CREATE TRIGGER mileage_readings_work_order_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, work_order_id ON public.mileage_readings
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.work_orders', 'work_order_id');

DROP TRIGGER IF EXISTS mileage_readings_vehicle_garage_guard ON public.mileage_readings;
CREATE TRIGGER mileage_readings_vehicle_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, vehicle_id ON public.mileage_readings
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.vehicles', 'vehicle_id');

DROP TRIGGER IF EXISTS key_events_work_order_garage_guard ON public.key_custody_events;
CREATE TRIGGER key_events_work_order_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, work_order_id ON public.key_custody_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.work_orders', 'work_order_id');

DROP TRIGGER IF EXISTS key_events_vehicle_garage_guard ON public.key_custody_events;
CREATE TRIGGER key_events_vehicle_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, vehicle_id ON public.key_custody_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.vehicles', 'vehicle_id');

-- Inspection templates, categories, inspections and results.
DROP TRIGGER IF EXISTS checklist_categories_template_garage_guard ON public.checklist_categories;
CREATE TRIGGER checklist_categories_template_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, template_id ON public.checklist_categories
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.checklist_templates', 'template_id');

DROP TRIGGER IF EXISTS checklist_items_category_garage_guard ON public.checklist_items;
CREATE TRIGGER checklist_items_category_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, category_id ON public.checklist_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.checklist_categories', 'category_id');

DROP TRIGGER IF EXISTS inspections_work_order_garage_guard ON public.inspections;
CREATE TRIGGER inspections_work_order_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, work_order_id ON public.inspections
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.work_orders', 'work_order_id');

DROP TRIGGER IF EXISTS inspections_template_garage_guard ON public.inspections;
CREATE TRIGGER inspections_template_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, template_id ON public.inspections
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.checklist_templates', 'template_id');

DROP TRIGGER IF EXISTS inspection_results_inspection_garage_guard ON public.inspection_results;
CREATE TRIGGER inspection_results_inspection_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, inspection_id ON public.inspection_results
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.inspections', 'inspection_id');

DROP TRIGGER IF EXISTS inspection_results_item_garage_guard ON public.inspection_results;
CREATE TRIGGER inspection_results_item_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, item_id ON public.inspection_results
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.checklist_items', 'item_id');

-- Anomalies and attachments.
DROP TRIGGER IF EXISTS anomalies_work_order_garage_guard ON public.anomalies;
CREATE TRIGGER anomalies_work_order_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, work_order_id ON public.anomalies
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.work_orders', 'work_order_id');

DROP TRIGGER IF EXISTS anomalies_vehicle_garage_guard ON public.anomalies;
CREATE TRIGGER anomalies_vehicle_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, vehicle_id ON public.anomalies
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.vehicles', 'vehicle_id');

DROP TRIGGER IF EXISTS attachments_work_order_garage_guard ON public.attachments;
CREATE TRIGGER attachments_work_order_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, work_order_id ON public.attachments
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.work_orders', 'work_order_id');

DROP TRIGGER IF EXISTS attachments_vehicle_garage_guard ON public.attachments;
CREATE TRIGGER attachments_vehicle_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, vehicle_id ON public.attachments
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.vehicles', 'vehicle_id');

DROP TRIGGER IF EXISTS attachments_anomaly_garage_guard ON public.attachments;
CREATE TRIGGER attachments_anomaly_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, anomaly_id ON public.attachments
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.anomalies', 'anomaly_id');

-- Stock usage, quotes and generated reports.
DROP TRIGGER IF EXISTS work_order_parts_order_garage_guard ON public.work_order_parts;
CREATE TRIGGER work_order_parts_order_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, work_order_id ON public.work_order_parts
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.work_orders', 'work_order_id');

DROP TRIGGER IF EXISTS work_order_parts_part_garage_guard ON public.work_order_parts;
CREATE TRIGGER work_order_parts_part_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, part_id ON public.work_order_parts
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.parts', 'part_id');

DROP TRIGGER IF EXISTS quotes_work_order_garage_guard ON public.quotes;
CREATE TRIGGER quotes_work_order_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, work_order_id ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.work_orders', 'work_order_id');

DROP TRIGGER IF EXISTS quotes_vehicle_garage_guard ON public.quotes;
CREATE TRIGGER quotes_vehicle_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, vehicle_id ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.vehicles', 'vehicle_id');

DROP TRIGGER IF EXISTS reports_work_order_garage_guard ON public.reports;
CREATE TRIGGER reports_work_order_garage_guard
BEFORE INSERT OR UPDATE OF garage_id, work_order_id ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_garage_reference('public.work_orders', 'work_order_id');
