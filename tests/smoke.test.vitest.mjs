/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/smoke.test.vitest.mjs
 *	@Date: 2026-11-12T18:01:51-08:00 (1794535311)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T21:36:51-08:00 (1794548211)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, it } from "vitest";
import { name, version } from "../src/index.mjs";

// Placeholder smoke test — the real suite (TOTP generation, otpauth/QR enrolment,
// the lockout state machine) lands with the implementation milestone.
describe("package surface", () => {
	it("exposes the package identity", () => {
		expect(name).toBe("@cldmv/lib-otp");
		expect(version).toMatch(/^\d+\.\d+\.\d+/);
	});
});
