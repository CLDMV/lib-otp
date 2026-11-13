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
