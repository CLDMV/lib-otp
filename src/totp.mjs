/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/totp.mjs
 *	@Date: 2026-11-12T21:53:38-08:00 (1794549218)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:23:46-08:00 (1794551026)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * RFC 6238 TOTP (HMAC-SHA1/SHA256/SHA512, configurable step) and RFC 4648 base32, on
 * node:crypto only. The default codes are 6 digits at a 30 s SHA-1 step — today's
 * gh-broker values; digits, algorithm and period are parameters so the RFC's own test
 * vectors and the configurable option set can drive the implementation.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** TOTP time step, in seconds. */
export const STEP_SECONDS = 30;

/** RFC 6238's three HMAC algorithms, as node:crypto names. */
const ALGORITHMS = { SHA1: "sha1", SHA256: "sha256", SHA512: "sha512" };

/** Encode bytes as unpadded RFC 4648 base32. */
export function base32Encode(bytes) {
	let out = "";
	let bits = 0;
	let value = 0;
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return out;
}

/**
 * Decode RFC 4648 base32. Case-insensitive; trailing "=" padding is tolerated. Throws on
 * any other character, so a damaged seed is reported instead of silently producing
 * codes nobody's authenticator can match.
 */
export function base32Decode(text) {
	const clean = text.toUpperCase().replace(/=+$/, "");
	const out = [];
	let bits = 0;
	let value = 0;
	for (const ch of clean) {
		const idx = BASE32_ALPHABET.indexOf(ch);
		if (idx < 0) throw new Error("base32: invalid character");
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(out);
}

/** RFC 4226 HOTP for one counter value, zero-padded to `digits`. */
export function hotp(key, counter, digits = 6, algorithm = "SHA1") {
	const msg = Buffer.alloc(8);
	msg.writeBigUInt64BE(BigInt(counter));
	const mac = createHmac(ALGORITHMS[algorithm], key).update(msg).digest();
	const offset = mac[mac.length - 1] & 0x0f;
	const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
	return String(bin % 10 ** digits).padStart(digits, "0");
}

/** The TOTP time step that contains `nowMs`. */
export function stepAt(nowMs, periodSeconds = STEP_SECONDS) {
	return Math.floor(nowMs / 1000 / periodSeconds);
}

/** The TOTP code for the step containing `nowMs`. */
export function totpAt(key, nowMs, digits = 6, algorithm = "SHA1", periodSeconds = STEP_SECONDS) {
	return hotp(key, stepAt(nowMs, periodSeconds), digits, algorithm);
}

/** Constant-time string comparison; strings of different lengths never match. */
export function safeEqual(a, b) {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The step a code is valid for at `nowMs`, accepting `skew` steps either side, or
 * undefined when it matches none. Every candidate step is compared (no early exit), and
 * each comparison is constant-time. A malformed code (not exactly `digits` digits) never
 * matches. `algorithm` and `periodSeconds` must be the machine config's values — a
 * verifier that disagrees with the authenticator's parameters matches nothing.
 */
export function matchStep(key, code, nowMs, skew = 1, digits = 6, algorithm = "SHA1", periodSeconds = STEP_SECONDS) {
	if (!new RegExp(`^\\d{${digits}}$`).test(code)) return undefined;
	const now = stepAt(nowMs, periodSeconds);
	let matched;
	for (let step = now - skew; step <= now + skew; step++) {
		if (safeEqual(hotp(key, step, digits, algorithm), code)) matched = step;
	}
	return matched;
}
