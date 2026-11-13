/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/enrol.mjs
 *	@Date: 2026-11-12T22:03:42-08:00 (1794549822)
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
 * Enrolment: a new seed, the otpauth URI an authenticator app imports, the QR code for
 * it, and the code verifier the host runs before telling the machine what happened. A
 * broken seed THROWS — a config error must never read as "no match" and lock everyone
 * out.
 */

import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { OtpError } from "./errors.mjs";
import { DEFAULTS } from "./options.mjs";
import { base32Decode, base32Encode, matchStep } from "./totp.mjs";

/**
 * A new TOTP seed: `seedBytes` random bytes as unpadded base32 (20 bytes → 32
 * characters). `random` is injectable for tests.
 * @param {{ seedBytes?: number, random?: (size: number) => Uint8Array }} [opts]
 * @returns {string}
 */
export function newSeed({ seedBytes = DEFAULTS.seedBytes, random = randomBytes } = {}) {
	return base32Encode(random(seedBytes));
}

/**
 * The otpauth URI an authenticator app imports, with the config's algorithm, digit
 * count and period (so a host running 8 digits gets an 8-digit enrolment). Issuer and
 * label are percent-encoded; the label names the account (caller-supplied — there is no
 * default).
 * @param {string} seed The base32 seed.
 * @param {string} label The account the URI is for.
 * @param {string} issuer The issuer (app name) the authenticator shows.
 * @param {import("./options.mjs").OtpMachineConfig} [config] Machine config; only `digits`, `periodSeconds` and `algorithm` are read.
 * @returns {string}
 */
export function otpauthUri(seed, label, issuer, config = DEFAULTS) {
	if (typeof seed !== "string" || seed.length === 0)
		throw new OtpError("OTP_SEED_INVALID", "otpauthUri: seed must be a non-empty base32 string");
	if (typeof label !== "string" || label.length === 0)
		throw new OtpError("OTP_URI_LABEL_REQUIRED", "otpauthUri: label must be a non-empty string");
	if (typeof issuer !== "string" || issuer.length === 0)
		throw new OtpError("OTP_URI_ISSUER_REQUIRED", "otpauthUri: issuer must be a non-empty string");
	return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${seed}&issuer=${encodeURIComponent(issuer)}&algorithm=${config.algorithm}&digits=${config.digits}&period=${config.periodSeconds}`;
}

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

/**
 * Verify a code against a seed: the TOTP step it matches at `now` (accepting
 * `skewSteps` either side), or undefined when it matches none. Takes the machine config
 * — not loose options — so it can't disagree with the machine. A malformed code never
 * matches; a broken seed throws (a config error must never read as "no match").
 * @param {string} seed The base32 seed (hosts pass the trimmed stored seed).
 * @param {string} code The candidate code.
 * @param {number} now Ms.
 * @param {import("./options.mjs").OtpMachineConfig} [config] Machine config; `digits`, `periodSeconds`, `algorithm` and `skewSteps` are read.
 * @returns {number | undefined} The matched counter, or undefined.
 */
export function verifyCode(seed, code, now, config = DEFAULTS) {
	if (typeof seed !== "string" || seed.length === 0)
		throw new OtpError("OTP_SEED_INVALID", "verifyCode: seed must be a non-empty base32 string");
	let key;
	try {
		key = base32Decode(seed);
	} catch (err) {
		// The only thrower is our own base32Decode, whose message says exactly what is wrong.
		throw new OtpError("OTP_SEED_INVALID", `verifyCode: the seed is not valid base32: ${err.message}`);
	}
	if (key.length === 0) throw new OtpError("OTP_SEED_INVALID", "verifyCode: the seed is empty");
	return matchStep(key, code, now, config.skewSteps, config.digits);
}
