/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/dist-smoke.mjs
 *	@Date: 2026-11-12T22:03:42-08:00 (1794549822)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T23:15:06-08:00 (1794554106)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Loads the built package once, so a build that can't load (or that drags
 * qrcode into the main entry again) fails before publish. Run by `npm run build` after tsup.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = (file) => join(root, "dist", file);
const fail = (msg) => {
	console.error(`dist smoke test failed: ${msg}`);
	process.exit(1);
};

const main = await import(pathToFileURL(dist("index.mjs")).href);
if (typeof main.verifyCode !== "function" || typeof main.stepOtp !== "function") fail("dist/index.mjs is missing its API");
if ("renderQr" in main) fail("dist/index.mjs still exports renderQr; it belongs on the ./qr subpath");
if (/["']qrcode["']/.test(readFileSync(dist("index.mjs"), "utf8"))) fail("dist/index.mjs imports qrcode");

const viaRequire = createRequire(import.meta.url)(dist("index.cjs"));
if (viaRequire.verifyCode !== main.verifyCode) fail("dist/index.cjs does not re-export dist/index.mjs");

const qr = await import(pathToFileURL(dist("qr.mjs")).href);
const svg = await qr.renderQr("otpauth://totp/smoke?secret=GEZDGNBVGY3TQOJQ", { format: "svg" });
if (typeof svg !== "string" || !svg.includes("<svg")) fail("dist/qr.mjs renderQr did not render an SVG");
try {
	await qr.renderQr("x", { format: "nope" });
	fail("dist/qr.mjs renderQr accepted an unknown format");
} catch (err) {
	if (!(err instanceof main.OtpError)) fail("dist/qr.mjs throws a different OtpError class than dist/index.mjs");
}
console.log("dist smoke test: dist/index.mjs, dist/index.cjs and dist/qr.mjs load");
