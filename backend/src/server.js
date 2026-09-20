require("dotenv").config();

const bookingRoutes = require("./routes/bookingRoutes");
const courseRoutes = require("./routes/courseRoutes");
const testRoutes = require("./routes/testRoutes");
const express = require("express");
const cors = require("cors");
const redisClient = require("./config/redis");
const { sendError } = require("./utils/httpResponses");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/bookings", bookingRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/test", testRoutes);

app.get("/api/health", async (req, res) => {
  try {
    const redisResponse = await redisClient.ping();

    res.json({
      status: "ok",
      redis: redisResponse,
    });
  } catch (error) {
    console.error("Health check failed:", error);

    res.status(500).json({
      status: "error",
      redis: "disconnected",
    });
  }
});

app.use((req, res) => {
  return sendError(res, 404, "ROUTE_NOT_FOUND", "Route not found");
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return sendError(
      res,
      400,
      "INVALID_JSON",
      "Request body is not valid JSON"
    );
  }

  console.error("Unhandled request error:", error);

  return sendError(
    res,
    500,
    "INTERNAL_SERVER_ERROR",
    "An unexpected error occurred"
  );
});

const PORT = process.env.PORT || 5050;

async function startServer() {
  try {
    await redisClient.connect();

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();