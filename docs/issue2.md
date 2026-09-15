Issue #2 --- Implement Course and Booking Read APIs


Goal

Provide API endpoints that the frontend and testing tools can use to
read the current course and booking data from Neon PostgreSQL.

Requirements

Course API

Keep the existing endpoint:

GET /api/courses

It should return the courses stored in Neon, including information such
as course ID, course code, course name, capacity, and available seats.

Booking API

Add:

GET /api/bookings

It should return the current booking records stored in Neon.

Why We Need This

These endpoints allow us to check the database before and after each
concurrency experiment.

Example:

Before test:
CS101
Capacity: 1
Available seats: 1
Bookings: 0

After test:
Bookings: actual number created

Expected Result

The frontend and test runner can retrieve the real current state from
Neon.

Done When

GET /api/courses works.

GET /api/bookings works.

Both endpoints use Neon PostgreSQL.

API errors return clear responses.

No database credentials are committed to Git.