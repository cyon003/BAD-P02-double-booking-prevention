Issue #12 --- Build Frontend Comparison Dashboard

Goal

Create a simple React/Vite interface that lets a user run and understand
the double-booking experiment.

User Should Be Able To

1. Open the frontend
2. See CS101 and current availability
3. Choose number of concurrent requests
4. Run WITHOUT Redis experiment
5. See the actual result
6. Reset experiment
7. Run WITH Redis experiment
8. See the protected result
9. Compare both results

Suggested Screen

================================================
          DOUBLE BOOKING PREVENTION
================================================

Course: CS101
Maximum Available Place: 1

Concurrent Requests: [ 20 ]

[ Run Without Redis ]
[ Reset Experiment ]
[ Run With Redis ]

------------------------------------------------
RESULTS
------------------------------------------------
                    WITHOUT REDIS   WITH REDIS
Requests Sent            20             20
Bookings Created       actual          actual
Allowed                    1             1
Rejected                actual          actual
Double Booking          YES/NO            NO
------------------------------------------------

API Connections

The frontend will use the backend APIs, including:

GET  /api/courses
GET  /api/bookings
POST /api/experiment/reset
POST /api/bookings/unsafe
POST /api/bookings/safe

The exact way the concurrent runner is connected can be decided during
integration.

Important

Do not hard-code fake experiment numbers.

Display results returned/collected from the real backend experiment.

Keep the UI simple. The main purpose is to make the problem vs
solution obvious.

Expected Result

A lecturer/user can run the demonstration from the frontend and clearly
understand:

WITHOUT Redis → race-condition/double-booking risk

WITH Redis → protected valid booking state

Done When

Course information is visible.

Request count can be selected/entered.

Without-Redis test can be run.

Reset can be run.

With-Redis test can be run.

Actual results are displayed.

Both states are easy to compare.

Loading and error states are handled.

Frontend is ready for final demo.