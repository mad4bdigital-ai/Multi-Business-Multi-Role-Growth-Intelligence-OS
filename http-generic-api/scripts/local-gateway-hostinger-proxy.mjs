#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const DOMAIN = "local.mad4b.com";
const ROOT = `/home/u338416126/domains/${DOMAIN}/public_html`;
const AUTH_TARGET = "https://auth.mad4b.com";

function parseArgs(argv = process.argv.slice(2)) {
  const out = { apply: false };
  for (const arg of argv) {
    if (arg === "--apply") out.apply = true;
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const htaccess = `# Managed by Growth Intelligence Platform local gateway proxy\nDirectoryIndex index.php\nRewriteEngine On\nRewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]\nRewriteCond %{REQUEST_FILENAME} !-f\nRewriteCond %{REQUEST_FILENAME} !-d\nRewriteRule ^ index.php [L,QSA]\n`;

const indexPhp = `<?php
// Managed by Growth Intelligence Platform local gateway proxy.
// Purpose: keep https://local.mad4b.com as the public gateway while dispatching
// to the Auth/Hostinger runtime that owns /local/tools and /local/tools/call.

$targetBase = '${AUTH_TARGET}';
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$target = $targetBase . $requestUri;

$headers = [];
foreach ($_SERVER as $key => $value) {
    if (strpos($key, 'HTTP_') !== 0) continue;
    $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
    $lower = strtolower($name);
    if (in_array($lower, ['host', 'content-length', 'connection', 'accept-encoding'])) continue;
    $headers[] = $name . ': ' . $value;
}
if (isset($_SERVER['CONTENT_TYPE'])) {
    $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
}
$headers[] = 'X-Forwarded-Host: ${DOMAIN}';
$headers[] = 'X-Forwarded-Proto: https';
$headers[] = 'X-Local-Gateway-Proxy: hostinger-php';

$body = file_get_contents('php://input');
$ch = curl_init($target);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_ENCODING, '');
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
curl_setopt($ch, CURLOPT_TIMEOUT, 60);
if (!in_array($method, ['GET', 'HEAD']) && $body !== false) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
if ($response === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => ['code' => 'local_gateway_proxy_failed', 'message' => curl_error($ch)]]);
    curl_close($ch);
    exit;
}

$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$rawHeaders = substr($response, 0, $headerSize);
$responseBody = substr($response, $headerSize);
curl_close($ch);

http_response_code($status ?: 502);
foreach (explode("\r\n", $rawHeaders) as $line) {
    if (stripos($line, 'HTTP/') === 0 || trim($line) === '') continue;
    $parts = explode(':', $line, 2);
    if (count($parts) !== 2) continue;
    $name = strtolower(trim($parts[0]));
    if (in_array($name, ['transfer-encoding', 'content-length', 'connection', 'content-encoding'])) continue;
    header($line, false);
}
echo $responseBody;
`;

async function readIfExists(file) {
  try { return await fs.readFile(file, "utf8"); } catch (err) { if (err.code === "ENOENT") return null; throw err; }
}

async function backupIfExists(file, stamp) {
  const existing = await readIfExists(file);
  if (existing === null) return null;
  const backup = `${file}.bak-${stamp}`;
  await fs.writeFile(backup, existing, "utf8");
  return backup;
}

async function main() {
  const args = parseArgs();
  const stat = await fs.stat(ROOT).catch((err) => {
    const e = new Error(`Hostinger local gateway root is not available: ${ROOT}`);
    e.code = "local_gateway_root_missing";
    e.cause = err;
    throw e;
  });
  if (!stat.isDirectory()) throw new Error(`Local gateway root is not a directory: ${ROOT}`);

  const files = [
    { path: path.join(ROOT, ".htaccess"), content: htaccess },
    { path: path.join(ROOT, "index.php"), content: indexPhp },
  ];

  const result = {
    ok: true,
    action: "install-local-gateway-hostinger-proxy",
    applied: args.apply,
    domain: DOMAIN,
    root: ROOT,
    target: AUTH_TARGET,
    files: files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content, "utf8") })),
    backups: [],
  };

  if (args.apply) {
    const stamp = nowStamp();
    for (const file of files) {
      const backup = await backupIfExists(file.path, stamp);
      if (backup) result.backups.push(backup);
      await fs.writeFile(file.path, file.content, "utf8");
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "local_gateway_proxy_install_failed", message: err.message } }, null, 2));
  process.exitCode = 1;
});
