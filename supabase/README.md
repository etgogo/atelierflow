# AtelierFlow Supabase database foundation

This folder contains the first, verified-by-file migration set for the backend foundation of AtelierFlow.

## Created files

- `supabase/migrations/202611110001_initial_schema.sql`
- `supabase/migrations/202611110002_rls_and_policies.sql`
- `supabase/migrations/202611110003_business_rules.sql`

## Purpose

These scripts create the database schema, access-control layer, and PostgreSQL business rules needed for the garage management domain:

- garage and membership management
- roles and permissions
- client and vehicle records
- work orders and appointments
- planning conflict detection
- mileage entry/exit validation
- key custody history
- checklist templates, inspections and anomalies
- parts, quotes, reports and audit logs

## Important notes

- The prototype currently in the repository remains untouched.
- The SQL files are created on the dedicated branch `feature/supabase-database-foundation`.
- These migrations are created as repository files. They are not executed here against a live Supabase database because there is no direct migration runner or project credentials in this environment.
- The migration files are written for Supabase PostgreSQL and are intended to be applied through the Supabase SQL editor or CLI once the project is configured.

## Next verification step

Before integrating the front-end, apply the migrations in Supabase and verify with SQL checks such as:

- `SELECT * FROM public.garages;`
- `SELECT * FROM public.work_orders;`
- `SELECT * FROM public.mileage_readings;`
- `SELECT * FROM public.appointment_mechanics;`
- `SELECT * FROM public.v_vehicle_key_status;`

Then test the RLS and conflict guard by creating data through the authenticated app session.
