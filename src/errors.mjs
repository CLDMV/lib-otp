/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/errors.mjs
 *	@Date: 2026-11-12T21:53:41-08:00 (1794549221)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:03:56-08:00 (1794549836)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * The library's one error type: every rejection it raises is an `OtpError` carrying a
 * stable `code`, so hosts map codes to their own prose instead of matching messages.
 */

/**
 * An error the library raises deliberately: a bad option, a malformed event, an invalid
 * seed or an unknown QR format. `code` is a stable identifier (never prose); `message`
 * is human-readable and safe to log — it never contains a code, a seed or anything
 * derived from them.
 */
export class OtpError extends Error {
	/**
	 * @param {string} code    Stable machine-readable identifier, e.g. `"OTP_OPTIONS_INVALID"`.
	 * @param {string} message Human-readable description (safe: no secret material).
	 */
	constructor(code, message) {
		super(message);
		this.name = "OtpError";
		this.code = code;
	}
}
