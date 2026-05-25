import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Whitelist of permitted user emails corresponding to APPROVED_EMAILS in the frontend
  const APPROVED_EMAILS = [
    'jashan.grtlife@gmail.com',
  ];

  // Secure endpoint to auto-attach and bind active workspace Key to authorized admin users
  app.get("/api/get-workspace-key", (req, res) => {
    const email = req.query.email as string;
    
    if (!email) {
      return res.status(400).json({ error: "Email query parameter is required." });
    }

    const isAuthorized = APPROVED_EMAILS.some(
      approved => approved.toLowerCase() === email.toLowerCase()
    );

    if (!isAuthorized) {
      return res.status(403).json({ error: "Access denied. Email is not whitelisted for workspace bindings." });
    }

    const apiKey = process.env.GEMINI_API_KEY || "";
    return res.json({ 
      apiKey,
      status: "success",
      msg: "Workspace context matched. API key fetched successfully." 
    });
  });

  // Health endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
