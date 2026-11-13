/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/smoke.test.vitest.mjs
 *	@Date: 2026-11-12T18:01:51-08:00 (1794535311)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:23:46-08:00 (1794551026)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, it } from "vitest";
import { name, version } from "../src/index.mjs";

// Package-surface smoke test — the full suite lives in the sibling test files
// (totp, options, machine, enrol, status, dev-condition, cjs-shim, bin).
describe("package surface", () => {
	it("exposes the package identity", () => {
		expect(name).toBe("@cldmv/lib-otp");
		expect(version).toMatch(/^\d+\.\d+\.\d+/);
	});
});
