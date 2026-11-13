/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/bin.test.vitest.mjs
 *	@Date: 2026-11-12T22:04:53-08:00 (1794549893)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:04:58-08:00 (1794549898)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, it, expect, vi } from "vitest";
import { name, version } from "../src/index.mjs";

describe("src/bin/otp.mjs — the CLI entry stub", () => {
	it("prints the package name and version", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await import("../src/bin/otp.mjs");
		} finally {
			vi.restoreAllMocks();
		}
		expect(log).toHaveBeenCalledWith(`${name} v${version}`);
	});
});
