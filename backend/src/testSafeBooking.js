const TOTAL_REQUESTS = 20;
const URL = "http://localhost:5050/api/bookings/safe";

async function sendBooking(number) {
  // Alternate between our two existing students
  const studentId = number % 2 === 0 ? 2 : 1;

  try {
    const response = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        studentId,
        courseId: 1,
      }),
    });

    const data = await response.json();

    return {
      request: number,
      status: response.status,
      result: data.message || data.error,
    };
  } catch (error) {
    return {
      request: number,
      status: "ERROR",
      result: error.message,
    };
  }
}

async function runTest() {
  console.log(`Sending ${TOTAL_REQUESTS} concurrent booking requests...\n`);

  // Create all requests immediately
  const requests = [];

  for (let i = 1; i <= TOTAL_REQUESTS; i++) {
    requests.push(sendBooking(i));
  }

  // Wait for all 20 together
  const results = await Promise.all(requests);

  console.table(results);

  const successful = results.filter(
    (result) => result.status === 201
  );

  const rejected = results.filter(
    (result) => result.status === 409
  );

  console.log("\n=== RESULT ===");
  console.log("Total requests:", results.length);
  console.log("Successful bookings:", successful.length);
  console.log("Rejected requests:", rejected.length);
}

runTest();