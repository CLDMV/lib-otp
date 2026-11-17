/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/qr.mjs
 *	@Date: 2026-11-12T22:03:42-08:00 (1794549822)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T23:15:06-08:00 (1794554106)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview QR rendering for enrolment, kept off the main entry: it needs the
 * CommonJS `qrcode` package, which a host that bundles the library into one ES module
 * (gh-broker's daemon) would otherwise inline and crash on at load. Hosts that show a QR
 * code import it from `@cldmv/lib-otp/qr`.
 * @module @cldmv/lib-otp/qr
 */

import QRCode from "qrcode";
// The main entry, not ./errors.mjs: the built dist/qr.mjs keeps this import external, so
// renderQr throws the same OtpError class the main entry exports.
import { OtpError } from "./index.mjs";

/** Options for {@link renderQr}.
 * @typedef {Object} RenderQrOpts
 * @property {"terminal" | "svg" | "png-data-url" | "png-buffer"} [format] The output format.
 * @property {(text: string, options: Record<string, unknown>) => Promise<string>} [toString] The qrcode `toString` (terminal and svg).
 * @property {(text: string) => Promise<string>} [toDataURL] The qrcode `toDataURL` (png-data-url).
 * @property {(text: string) => Promise<Uint8Array>} [toBuffer] The qrcode `toBuffer` (png-buffer).
 */

/**
 * Render a URI as a QR code. The qrcode functions are injectable so tests stay
 * hermetic; the defaults are the `qrcode` package's. (The injectables are read as own
 * properties on purpose: a plain options object inherits `Object.prototype.toString`,
 * so a destructuring default for `toString` would never apply.)
 * @param {string} uri The otpauth URI.
 * @param {RenderQrOpts} [opts]
 * @returns {Promise<string | Uint8Array>} Terminal and SVG output as text, the PNG as a
 *   data URL or raw bytes.
 */
export async function renderQr(uri, opts = /** @type {RenderQrOpts} */ ({})) {
	const { format = "terminal" } = opts;
	const toString = Object.hasOwn(opts, "toString") ? opts.toString : QRCode.toString;
	const toDataURL = Object.hasOwn(opts, "toDataURL") ? opts.toDataURL : QRCode.toDataURL;
	const toBuffer = Object.hasOwn(opts, "toBuffer") ? opts.toBuffer : QRCode.toBuffer;
	switch (format) {
		case "terminal":
			return toString(uri, { type: "terminal", small: true });
		case "svg":
			return toString(uri, { type: "svg" });
		case "png-data-url":
			return toDataURL(uri);
		case "png-buffer":
			return toBuffer(uri);
		default:
			throw new OtpError(
				"OTP_QR_FORMAT",
				`renderQr: unknown format ${JSON.stringify(format)} (expected "terminal", "svg", "png-data-url" or "png-buffer")`
			);
	}
}
