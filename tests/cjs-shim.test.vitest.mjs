/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/cjs-shim.test.vitest.mjs
 *	@Date: 2026-11-12T22:04:55-08:00 (1794549895)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:04:58-08:00 (1794549898)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const shimPath = require.resolve("../src/index.cjs");

describe("src/index.cjs — the require(esm) guard", () => {
	it("refuses to load on a Node without require(esm), with a typed error and a clear message", () => {
		const descriptor = Object.getOwnPropertyDescriptor(process.features, "require_module");
		Object.defineProperty(process.features, "require_module", { value: false, configurable: true });
		try {
			delete require.cache[shimPath];
			let thrown;
			try {
				require(shimPath);
			} catch (err) {
				thrown = err;
			}
			expect(thrown).toBeInstanceOf(Error);
			expect(thrown.code).toBe("ERR_REQUIRE_ESM");
			expect(thrown.message).toMatch(/@cldmv\/lib-otp: require\(\) needs Node\.js \^20\.19\.0 or >=22\.13\.0 \(this is /);
			expect(thrown.message).toMatch(/\). On older Node\.js, load the package with import\(\) instead\./);
		} finally {
			// Restore the real accessor and the module cache, whatever happened above.
			Object.defineProperty(process.features, "require_module", descriptor);
			delete require.cache[shimPath];
		}
	});
});

describe("src/index.cjs — what require() returns", () => {
	// Vitest loads ESM through its own module graph, so compare in a plain Node process where require() and
	// import() share one module instance and identity (===) is meaningful.
	const script = `
		const cjs = require("./src/index.cjs");
		import("./src/index.mjs").then((esm) => {
			const keys = (m) => Object.keys(m).filter((k) => k !== "__esModule").sort();
			console.log(JSON.stringify({
				isObject: typeof cjs === "object" && cjs !== null,
				sameKeys: JSON.stringify(keys(cjs)) === JSON.stringify(keys(esm)),
				keyCount: keys(esm).length,
				sameValues: keys(esm).every((k) => cjs[k] === esm[k]),
				distinct: new Set(keys(esm).map((k) => esm[k])).size
			}));
		});
	`;

	it("is the module object: the exact ESM key set, each value identical to the ESM export", () => {
		const root = fileURLToPath(new URL("..", import.meta.url));
		const res = spawnSync(process.execPath, ["-e", script], { cwd: root, encoding: "utf8" });
		expect(res.status, res.stderr).toBe(0);
		const out = JSON.parse(res.stdout);
		expect(out.isObject).toBe(true);
		expect(out.sameKeys).toBe(true);
		expect(out.sameValues).toBe(true);
		// More than one distinct value, so the shim keeps returning the module object.
		expect(out.distinct).toBeGreaterThan(1);
	});
});
