import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { config as hfConfig, higgsfield } from "@higgsfield/client/v2";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");
dotenv.config({ path: envPath, quiet: true });
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const keyNames: Record<string, string> = {
  higgsfield: "HF_CREDENTIALS", openai: "OPENAI_API_KEY", replicate: "REPLICATE_API_TOKEN",
  runway: "RUNWAY_API_KEY", kling: "KLING_API_KEY", other: "OTHER_API_KEY"
};
let credentials = (process.env.HF_CREDENTIALS || "").trim();
if (credentials) {
  try { hfConfig({ credentials }); } catch { /* UI reports configuration issues on request */ }
}
const app = express();
const port = Number(process.env.PORT || 8787);
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(root, "public")));

function safeCredentialStatus() {
  return { configured: Boolean(credentials && credentials.includes(":") && !credentials.includes("PEGA_AQUI")), hosted: process.env.NODE_ENV === "production" };
}
app.get("/api/status", (_req, res) => {
  const saved = readEnvFile();
  const configuredKeys = Object.entries(keyNames).filter(([_, envName]) => Boolean(process.env[envName] || saved[envName] || (envName === "HF_CREDENTIALS" ? credentials : ""))).map(([provider]) => provider);
  res.json({ app: "FAMA Video Studio", server: "online", ...safeCredentialStatus(), model: "bytedance/seedance-2.5/text-to-video", configuredKeys });
});

function readEnvFile(): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return result;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return result;
}
function writeEnvFile(values: Record<string, string>) {
  const lines = Object.entries(values).filter(([key, value]) => /^[A-Z0-9_]+$/.test(key) && value.length > 0).map(([key, value]) => `${key}="${value.replace(/[\r\n"]/g, "")}"`);
  fs.writeFileSync(envPath, lines.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
}
app.get("/api/keys", (_req, res) => {
  const env = readEnvFile();
  const providers = Object.entries(keyNames).map(([provider, envName]) => ({ provider, configured: Boolean((provider === "higgsfield" ? credentials : process.env[envName]) || env[envName]), connected: provider === "higgsfield" && Boolean(credentials) }));
  res.json({ providers, hosted: process.env.NODE_ENV === "production" });
});
app.post("/api/keys", (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(403).json({ error: "En la web, agrega las claves como variables privadas en Render. No las introduzcas en el navegador." });
  const provider = String(req.body?.provider || "");
  const value = String(req.body?.credential || "").trim();
  if (!keyNames[provider]) return res.status(400).json({ error: "Selecciona un proveedor válido." });
  if (!value || value.length < 8 || /[\r\n]/.test(value)) return res.status(400).json({ error: "La clave está vacía o no parece válida." });
  if (provider === "higgsfield" && !value.includes(":")) return res.status(400).json({ error: "Higgsfield requiere la credencial completa ID:SECRETO." });
  try {
    const env = readEnvFile(); env[keyNames[provider]] = value;
    writeEnvFile(env);
    if (provider === "higgsfield") { credentials = value; hfConfig({ credentials }); }
    res.json({ ok: true, message: "Clave guardada de forma privada en este equipo. No se devuelve ni se muestra." });
  } catch (e) { res.status(500).json({ error: "No se pudo guardar la clave localmente.", details: e instanceof Error ? e.message : "Error desconocido" }); }
});

// In local mode the credential may be stored on this computer. Hosted deployments reject browser-submitted credentials; set HF_CREDENTIALS as a private environment variable.
app.post("/api/credentials", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "En la versión web, configura HF_CREDENTIALS en las variables privadas del alojamiento. No pegues la clave en esta página." });
  }
  const submitted = String(req.body?.credentials || "").trim();
  if (!submitted || !submitted.includes(":") || submitted.length < 30) {
    return res.status(400).json({ error: "La credencial no parece tener el formato ID:SECRETO." });
  }
  try {
    const safe = submitted.replace(/[\r\n"]/g, "");
    const env = readEnvFile(); env.HF_CREDENTIALS = safe; env.PORT = String(port); writeEnvFile(env);
    credentials = safe;
    hfConfig({ credentials });
    return res.json({ ok: true, message: "Credencial guardada localmente. No se muestra ni se devuelve." });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo guardar la credencial localmente.", details: e instanceof Error ? e.message : "Error desconocido" });
  }
});

app.post("/api/generate", async (req, res) => {
  if (!safeCredentialStatus().configured) return res.status(400).json({ error: "Primero configura la credencial de Higgsfield desde Ajustes de API." });
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "Escribe una descripción para la escena." });
  const duration = Number(req.body?.duration || 5);
  if (![5, 10, 15].includes(duration)) return res.status(400).json({ error: "La duración seleccionada no es válida." });
  try {
    hfConfig({ credentials });
    const result = await higgsfield.subscribe("bytedance/seedance-2.5/text-to-video", {
      input: {
        prompt,
        duration,
        resolution: req.body?.resolution === "1080p" ? "1080p" : "720p",
        aspect_ratio: ["16:9", "9:16", "1:1"].includes(req.body?.aspect_ratio) ? req.body.aspect_ratio : "16:9",
        output_format: "mp4",
        generate_audio: Boolean(req.body?.generate_audio)
      },
      withPolling: true
    });
    if (!result.isCompleted) {
      return res.status(502).json({ error: "La generación no terminó correctamente.", state: "not_completed" });
    }
    const videoUrl = result.jobs?.[0]?.results?.raw?.url;
    if (!videoUrl) return res.status(502).json({ error: "Higgsfield no devolvió una URL de video.", state: "missing_video_url" });
    res.json({ ok: true, status: "completed", videoUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    res.status(502).json({ error: "Higgsfield no pudo completar la solicitud.", details: message });
  }
});

const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
app.listen(port, host, () => {
  console.log(`FAMA Video Studio escuchando en ${host}:${port}`);
});
