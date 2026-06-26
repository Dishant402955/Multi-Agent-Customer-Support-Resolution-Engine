/**
 * admin.ts — the agent service's live config-store API.
 *
 * These routes let the application API (and only the API — they're behind a
 * shared-secret header) mutate the agent's runtime configuration without a
 * restart: KB docs, declarative use cases, and SSRF-safe HTTP tools. Each
 * mutation validates input and hot-reloads the affected part.
 */
import { Router } from "express";
import { ENV } from "./env";
import { deleteKbDoc, listKbDocs, readKbDoc, writeKbDoc } from "./shared/kb/store";
import {
  deleteUseCase,
  listAgentNames,
  listUseCases,
  upsertUseCase,
} from "./shared/handlers/usecase-store";
import { listSpecs, deleteSpec, reloadHttpTools, upsertSpec } from "./shared/tools/http-store";
import { listTools } from "./shared/tools/registry";
import { registerAllTools } from "./shared/tools/index";

export const adminRouter = Router();

// Ensure built-ins + stored HTTP tools are present before serving config reads.
registerAllTools();

adminRouter.use((req, res, next) => {
  if ((req.header("x-admin-token") || "") !== ENV.ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

function fail(res: any, err: unknown) {
  res.status(400).json({ error: (err as Error).message || "bad request" });
}

// ---- KB --------------------------------------------------------------------
adminRouter.get("/kb", (_req, res) => res.json({ docs: listKbDocs() }));

adminRouter.put("/kb/:file", (req, res) => {
  try {
    const content = String((req.body ?? {}).content ?? "");
    res.json({ doc: writeKbDoc(req.params.file, content) });
  } catch (e) {
    fail(res, e);
  }
});

adminRouter.delete("/kb/:file", (req, res) => {
  try {
    deleteKbDoc(req.params.file);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// ---- Use cases -------------------------------------------------------------
adminRouter.get("/usecases", (_req, res) =>
  res.json({ agents: listAgentNames(), usecases: listUseCases() })
);

adminRouter.put("/usecases/:agent", (req, res) => {
  try {
    res.json(upsertUseCase(req.params.agent, req.body));
  } catch (e) {
    fail(res, e);
  }
});

adminRouter.delete("/usecases/:agent/:id", (req, res) => {
  try {
    res.json({ ids: deleteUseCase(req.params.agent, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

// ---- Tools -----------------------------------------------------------------
adminRouter.get("/tools", (_req, res) => {
  const declarativeNames = new Set(listSpecs().map((s) => s.name));
  const builtins = listTools()
    .map((t) => ({ name: t.name, description: t.description }))
    .filter((t) => !declarativeNames.has(t.name));
  res.json({ builtins, declarative: listSpecs() });
});

adminRouter.put("/tools/:name", (req, res) => {
  try {
    const spec = upsertSpec({ ...req.body, name: req.params.name });
    res.json({ spec });
  } catch (e) {
    fail(res, e);
  }
});

adminRouter.delete("/tools/:name", (req, res) => {
  try {
    deleteSpec(req.params.name);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

adminRouter.post("/reload", (_req, res) => {
  reloadHttpTools();
  res.json({ ok: true });
});
