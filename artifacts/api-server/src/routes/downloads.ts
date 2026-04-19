import { Router } from "express";
import path from "path";
import fs from "fs";

const ASSET_DIR = path.resolve("/home/runner/workspace/artifacts/ai-strategy");

const router = Router();

router.get("/downloads/infographic", (_req, res) => {
  const file = path.join(ASSET_DIR, "infographic.html");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", "inline; filename=\"ai-strategy.html\"");
  res.send(fs.readFileSync(file, "utf-8"));
});

router.get("/downloads/strategy", (_req, res) => {
  const file = path.join(ASSET_DIR, "strategy.md");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"ai-strategy.md\"");
  res.send(fs.readFileSync(file, "utf-8"));
});

export default router;
