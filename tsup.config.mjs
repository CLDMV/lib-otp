/**
 *
 *	@Project: @cldmv/otp
 *	@Filename: /tsup.config.mjs
 *	@Date: 2026-11-12T18:02:07-08:00 (1794535327)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T18:03:03-08:00 (1794535383)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "tsup";

export default defineConfig([
	{
		// ESM library entry → dist/index.mjs (the only bundled output; a second CJS
		// bundle would duplicate the package — see docs/conventions/package-layout.md).
		entry: { index: "src/index.mjs" },
		format: ["esm"],
		outDir: "dist",
		target: "node20", // matches package.json engines.node (>=20.19.0)
		platform: "node",
		splitting: false,
		sourcemap: true,
		dts: false, // declarations come from `npm run types:build` (tsc) instead
		minify: true,
		// Keep function and class names through minification (`fn.name`, stack traces).
		keepNames: true,
		// Keep `node:` specifiers on built-in imports (tsup strips them by default).
		removeNodeProtocol: false,
		clean: true,
		outExtension() {
			return { js: ".mjs" };
		},
		// dist/index.cjs is never a second bundle: src/index.cjs — the thin,
		// hand-written CJS shim that require()s its sibling index.mjs — is copied
		// verbatim, so it resolves `./index.mjs` identically in src/ and dist/.
		onSuccess() {
			copyFileSync("src/index.cjs", join(this.outDir, "index.cjs"));
		}
	},
	{
		// CLI entry → bin/otp.mjs ("bin" in package.json points at the built file;
		// bin/ is build output, never committed).
		entry: { otp: "src/bin/otp.mjs" },
		format: ["esm"],
		outDir: "bin",
		target: "node20",
		platform: "node",
		splitting: false,
		sourcemap: true,
		dts: false,
		minify: true,
		keepNames: true,
		removeNodeProtocol: false,
		clean: true,
		outExtension() {
			return { js: ".mjs" };
		}
	}
]);
