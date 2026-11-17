/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/qr-subpath.test.vitest.mjs
 *	@Date: 2026-11-12T22:03:50-08:00 (1794549830)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T23:15:06-08:00 (1794554106)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, it } from "vitest";
import * as main from "@cldmv/lib-otp";
import { renderQr } from "@cldmv/lib-otp/qr";

describe("the @cldmv/lib-otp/qr subpath", () => {
	it("resolves by name (to src/qr.mjs under the dev condition)", () => {
		expect(import.meta.resolve("@cldmv/lib-otp/qr")).toMatch(/\/src\/qr\.mjs$/);
		expect(typeof renderQr).toBe("function");
	});

	it("is the only place renderQr lives: the main entry doesn't export it", () => {
		expect("renderQr" in main).toBe(false);
	});

	it("throws the main entry's OtpError class, not a copy", async () => {
		await expect(renderQr("x", { format: /** @type {any} */ ("nope") })).rejects.toBeInstanceOf(main.OtpError);
	});
});
