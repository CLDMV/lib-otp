/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /.configs/vitest.config.mjs
 *	@Date: 2026-11-12T18:01:46-08:00 (1794535306)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T21:36:50-08:00 (1794548210)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { defineConfig, mergeConfig } from "vitest/config";
import { devCondition } from "@cldmv/configs/vitest.config.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Anchor the project root to the package directory so include/exclude work no
// matter what cwd vitest is invoked from.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wire the `lib-otp-dev` condition (exports["."].lib-otp-dev → src/) into resolution and
// the test process, so tests importing the package by name hit src/ and the CJS
// shim can require() the ESM sibling. devCondition() reads the condition name
// from package.json and sets resolve.conditions, ssr.resolve.conditions and
// test.execArgv (--conditions=lib-otp-dev).
const dev = devCondition({ root });

export default mergeConfig(
	dev,
	defineConfig({
		root,
		test: {
			include: ["tests/**/*.test.vitest.mjs"],
			exclude: ["node_modules"],
			environment: "node",
			testTimeout: 30000,
			// "dot" keeps CI logs to one character per test file instead of a full
			// "RUN vX.Y.Z" + per-file pass/fail block for every file — vitest's
			// non-interactive fallback (no TTY to redraw) otherwise reprints that
			// whole block per file on top of the final aggregate summary, which
			// dominates the log on a suite this size. The final "Test Files X
			// passed" / "Tests Y passed" summary is unaffected — every built-in
			// reporter prints it regardless of per-test verbosity.
			reporters: ["dot"],
			coverage: {
				provider: "v8",
				include: ["src/**"],
				exclude: ["**/*.json", "tests/**"],
				reporter: ["text", "html", "json-summary", "json"]
			}
		}
	})
);
