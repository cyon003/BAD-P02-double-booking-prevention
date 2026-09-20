-- Issue #8: database safety for protected bookings.
-- This migration is safe to re-run against the existing project schema.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.courses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%available_seats >= 0%'
  ) THEN
    ALTER TABLE public.courses
      ADD CONSTRAINT courses_available_seats_nonnegative_check
      CHECK (available_seats >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.courses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%available_seats <= capacity%'
  ) THEN
    ALTER TABLE public.courses
      ADD CONSTRAINT courses_available_seats_capacity_check
      CHECK (available_seats <= capacity);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.bookings'::regclass AND attname = 'student_id'),
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.bookings'::regclass AND attname = 'course_id')
      ]::smallint[]
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_student_course_unique
      UNIQUE (student_id, course_id);
  END IF;
END
$$;

COMMIT;
