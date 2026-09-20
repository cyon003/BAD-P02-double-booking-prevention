# Database migrations

Migration files are applied in filename order with a direct PostgreSQL/Neon
connection. Run them from the repository root with a development database:

```sh
psql "$DATABASE_URL" -f backend/migrations/001_booking_safety.sql
```

Do not point this command at production. The Issue #8 migration is
re-runnable: it keeps the existing lower-bound and student/course rules and
adds the `available_seats <= capacity` check when it is missing.
