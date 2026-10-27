import express from "express";

const app = express();
const PORT = Number(process.env.API_PORT ?? 4000);

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "PharmaSathi API",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found.",
  });
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`PharmaSathi API listening on http://127.0.0.1:${PORT}`);
});

function shutdown() {
  server.close(() => {
    console.log("PharmaSathi API stopped.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
