/**
 *
 *	@Project: @cldmv/otp
 *	@Filename: /tests/dev-condition.test.vitest.mjs
 *	@Date: 2026-11-12T18:21:44-08:00 (1794536504)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T18:22:03-08:00 (1794536523)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { name, version } from "@cldmv/otp";

/**
 * The `otp-dev` condition (wired into vitest by .configs/vitest.config.mjs via
 * devCondition()) must make a by-name import and a require() both resolve into
 * src/ — that is the whole point of the condition: tests run against source,
 * not the last build.
 */

describe("otp-dev condition", () => {
	it("resolves a by-name import to src/index.mjs", () => {
		const resolved = import.meta.resolve("@cldmv/otp");
		expect(resolved).toMatch(/\/src\/index\.mjs$/);
		// And the import itself works (the stub's real exports):
		expect(name).toBe("@cldmv/otp");
		expect(typeof version).toBe("string");
	});

	it("resolves a require() to src/index.cjs", () => {
		const require = createRequire(import.meta.url);
		const resolved = require.resolve("@cldmv/otp");
		expect(resolved).toMatch(/\/src\/index\.cjs$/);
		// The shim require()s the ESM sibling, so the loaded module has the same shape:
		const loaded = require("@cldmv/otp");
		expect(loaded.name).toBe("@cldmv/otp");
		expect(loaded.version).toBe(version);
	});
});
