require("dotenv").config();

const bookingRoutes = require("./routes/bookingRoutes");
const courseRoutes = require("./routes/courseRoutes");
const express = require("express");
const cors = require("cors");
const redisClient = require("./config/redis");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/bookings", bookingRoutes);
app.use("/api/courses", courseRoutes);

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
