/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/enrol.test.vitest.mjs
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

import { describe, it, expect } from "vitest";
import { base32Decode, base32Encode, hotp, matchStep, stepAt } from "../src/totp.mjs";
import { parseOtpOptions } from "../src/options.mjs";
import { OtpError } from "../src/errors.mjs";
import { currentCode, newSeed, otpauthUri, renderQr, verifyCode } from "../src/enrol.mjs";

// RFC 6238 appendix B seed: the ASCII string "12345678901234567890".
const KEY = Buffer.from("12345678901234567890", "ascii");
const SEED = base32Encode(KEY);
const T = 1111111111_000; // one of the RFC's vector times (code 14050471, 8 digits)

const config = parseOtpOptions();

describe("verifyCode", () => {
	it("matches the RFC 6238 vectors", () => {
		// 8-digit vectors at the RFC's times.
		const eight = parseOtpOptions({ digits: 8, skewSteps: 0 });
		expect(verifyCode(SEED, "94287082", 59_000, eight)).toBe(stepAt(59_000));
		expect(verifyCode(SEED, "14050471", T, eight)).toBe(stepAt(T));
	});

	it("accepts the current step and one either side (default skew 1)", () => {
		const step = stepAt(T);
		expect(verifyCode(SEED, hotp(KEY, step), T, config)).toBe(step);
		expect(verifyCode(SEED, hotp(KEY, step - 1), T, config)).toBe(step - 1);
		expect(verifyCode(SEED, hotp(KEY, step + 1), T, config)).toBe(step + 1);
		expect(verifyCode(SEED, hotp(KEY, step - 2), T, config)).toBeUndefined();
	});

	it("honours the config's skew, down to none", () => {
		const step = stepAt(T);
		const skew0 = parseOtpOptions({ skewSteps: 0 });
		expect(verifyCode(SEED, hotp(KEY, step), T, skew0)).toBe(step);
		expect(verifyCode(SEED, hotp(KEY, step - 1), T, skew0)).toBeUndefined();
	});

	it("never matches a malformed code", () => {
		const good = hotp(KEY, stepAt(T));
		for (const bad of ["", "12345", "abcdef", ` ${good}`, `${good}0`]) {
			expect(verifyCode(SEED, bad, T, config)).toBeUndefined();
		}
	});

	it("honours the config's digit count", () => {
		const eight = parseOtpOptions({ digits: 8 });
		expect(verifyCode(SEED, "14050471", T, eight)).toBe(stepAt(T));
		expect(verifyCode(SEED, "140504", T, eight)).toBeUndefined();
	});

	it("throws on a broken seed instead of reading it as no-match", () => {
		expect(() => verifyCode("!!not base32!!", "123456", T, config)).toThrow(OtpError);
		try {
			verifyCode("!!not base32!!", "123456", T, config);
		} catch (err) {
			expect(err.code).toBe("OTP_SEED_INVALID");
			expect(err.message).toMatch(/not valid base32/);
		}
		expect(() => verifyCode("MZ=XW", "123456", T, config)).toThrow(/not valid base32/);
	});

	it("throws on an empty or non-string seed", () => {
		for (const seed of ["", undefined, null, 5]) {
			expect(() => verifyCode(seed, "123456", T, config)).toThrow(OtpError);
			expect(() => verifyCode(seed, "123456", T, config)).toThrow(/seed must be a non-empty base32 string/);
		}
		// Padding-only seed: it decodes to zero bytes, which is just as broken.
		expect(() => verifyCode("====", "123456", T, config)).toThrow(/the seed is empty/);
	});

	it("tolerates lowercase and trailing padding in the seed", () => {
		expect(verifyCode(SEED.toLowerCase(), hotp(KEY, stepAt(T)), T, config)).toBe(stepAt(T));
		expect(verifyCode(`${SEED}======`, hotp(KEY, stepAt(T)), T, config)).toBe(stepAt(T));
	});
});

describe("currentCode", () => {
	it("matches the RFC 6238 vectors (the code the authenticator shows, no skew)", () => {
		const eight = parseOtpOptions({ digits: 8 });
		expect(currentCode(SEED, 59_000, eight)).toBe("94287082");
		expect(currentCode(SEED, T, eight)).toBe("14050471");
	});

	it("is config-driven: digits, period and algorithm come from the config", () => {
		const c = parseOtpOptions({ digits: 8, periodSeconds: 60, algorithm: "SHA256" });
		expect(currentCode(SEED, T, c)).toBe(hotp(KEY, stepAt(T, c.periodSeconds), c.digits, c.algorithm));
		expect(currentCode(SEED, T)).toBe(hotp(KEY, stepAt(T), 6, "SHA1"));
	});

	it("agrees with verifyCode on the code it matches at the current step", () => {
		// The code currentCode shows at T verifies at T with zero skew — and matches at
		// the default skew of one step either side.
		const code = currentCode(SEED, T, parseOtpOptions({ skewSteps: 0 }));
		expect(verifyCode(SEED, code, T, parseOtpOptions({ skewSteps: 0 }))).toBe(stepAt(T));
		expect(verifyCode(SEED, code, T, config)).toBe(stepAt(T));
	});

	it("refuses exactly what verifyCode refuses — a display path can never accept a seed the verifier rejects", () => {
		// Padding-only seed: it decodes to zero bytes, which is just as broken.
		expect(() => currentCode("====", T, config)).toThrow(OtpError);
		try {
			currentCode("====", T, config);
		} catch (err) {
			expect(err.code).toBe("OTP_SEED_INVALID");
			expect(err.message).toMatch(/the seed is empty/);
		}
		// A valid alphabet but a zero-byte key ("AA" decodes to 1 byte, which verifyCode
		// accepts as a merely never-matching seed — so currentCode shows a code for it too).
		expect(() => currentCode("A", T, config)).toThrow(/the seed is empty/);
		expect(() => currentCode("A=", T, config)).toThrow(/the seed is empty/);
		// Not base32 at all.
		expect(() => currentCode("!!not base32!!", T, config)).toThrow(/not valid base32/);
		expect(() => currentCode("MZ=XW", T, config)).toThrow(/not valid base32/);
		// Empty or non-string.
		for (const seed of ["", undefined, null, 5]) {
			expect(() => currentCode(seed, T, config)).toThrow(OtpError);
			expect(() => currentCode(seed, T, config)).toThrow(/seed must be a non-empty base32 string/);
		}
	});
});

describe("newSeed", () => {
	it("makes 20 random bytes as base32 (32 characters) by default", () => {
		const seed = newSeed();
		expect(seed).toMatch(/^[A-Z2-7]{32}$/);
		// It decodes back to 20 bytes.
		expect(base32Decode(seed).length).toBe(20);
	});

	it("honours seedBytes (bounded at 16 minimum) and an injectable random source", () => {
		expect(newSeed({ seedBytes: 16 })).toMatch(/^[A-Z2-7]{26}$/);
		expect(newSeed({ random: (n) => Buffer.alloc(n, 0xff) })).toBe(base32Encode(Buffer.alloc(20, 0xff)));
		expect(newSeed({ seedBytes: 16, random: (n) => Buffer.alloc(n, 1) })).toBe(base32Encode(Buffer.alloc(16, 1)));
	});

	it.each([0, 1, 15, -20, 2.5])("rejects a seedBytes below 16 (got %s) — RFC 4226 §4 requires 128 bits", (seedBytes) => {
		expect(() => newSeed({ seedBytes })).toThrow(OtpError);
		try {
			newSeed({ seedBytes });
		} catch (err) {
			expect(err.code).toBe("OTP_SEED_BYTES_INVALID");
			expect(err.message).toMatch(/at least 16/);
		}
	});

	it("makes different seeds on repeated calls", () => {
		expect(newSeed()).not.toBe(newSeed());
	});
});

describe("otpauthUri", () => {
	it("builds the documented URI with the config's parameters", () => {
		expect(otpauthUri(SEED, "repo@box", "gh-broker", config)).toBe(
			`otpauth://totp/gh-broker:repo%40box?secret=${SEED}&issuer=gh-broker&algorithm=SHA1&digits=6&period=30`
		);
	});

	it("defaults to the packaged defaults", () => {
		expect(otpauthUri(SEED, "repo@box", "gh-broker")).toBe(otpauthUri(SEED, "repo@box", "gh-broker", config));
	});

	it("is config-driven: a host running 8 digits and 60 s periods gets that enrolment", () => {
		const c = parseOtpOptions({ digits: 8, periodSeconds: 60, uriIssuer: "quack" });
		expect(otpauthUri(SEED, "ada", "quack", c)).toBe(
			`otpauth://totp/quack:ada?secret=${SEED}&issuer=quack&algorithm=SHA1&digits=8&period=60`
		);
	});

	it("percent-encodes the issuer and the label", () => {
		expect(otpauthUri(SEED, "a:b/c d", "My App", config)).toBe(
			`otpauth://totp/My%20App:a%3Ab%2Fc%20d?secret=${SEED}&issuer=My%20App&algorithm=SHA1&digits=6&period=30`
		);
	});

	it("requires a seed, a label and an issuer", () => {
		for (const args of [
			["", "label", "issuer"],
			[SEED, "", "issuer"],
			[SEED, "label", ""],
			[undefined, "label", "issuer"],
			[SEED, 5, "issuer"],
			[SEED, "label", 5]
		]) {
			expect(() => otpauthUri(...args)).toThrow(OtpError);
		}
		expect(() => otpauthUri("", "label", "issuer")).toThrow(/seed must be a non-empty base32 string/);
		expect(() => otpauthUri(SEED, "", "issuer")).toThrow(/label must be a non-empty string/);
		expect(() => otpauthUri(SEED, "label", "")).toThrow(/issuer must be a non-empty string/);
	});

	it("validates the seed as base32 before anything is interpolated (a raw seed must not inject a URI parameter)", () => {
		for (const bad of ["not&valid", "abc def", "GEZDGNBV&secret=x"]) {
			expect(() => otpauthUri(bad, "label", "issuer")).toThrow(OtpError);
			try {
				otpauthUri(bad, "label", "issuer");
			} catch (err) {
				expect(err.code).toBe("OTP_SEED_INVALID");
				expect(err.message).toMatch(/not valid base32/);
			}
		}
		// The validation runs before the label/issuer checks:
		expect(() => otpauthUri("not&valid", "", "")).toThrow(/not valid base32/);
	});

	it("defaults label and issuer to the config's uriLabel/uriIssuer when omitted", () => {
		const c = parseOtpOptions({ uriIssuer: "quack", uriLabel: "ada@example.com" });
		expect(otpauthUri(SEED, undefined, undefined, c)).toBe(otpauthUri(SEED, "ada@example.com", "quack", c));
		expect(otpauthUri(SEED, undefined, "explicit-issuer", c)).toBe(otpauthUri(SEED, "ada@example.com", "explicit-issuer", c));
		expect(otpauthUri(SEED, "explicit-label", undefined, c)).toBe(otpauthUri(SEED, "explicit-label", "quack", c));
		// A config without a uriLabel leaves the label required:
		expect(() => otpauthUri(SEED, undefined, undefined, config)).toThrow(OtpError);
		expect(() => otpauthUri(SEED, undefined, undefined, config)).toThrow(/label must be a non-empty string/);
	});
});

describe("renderQr", () => {
	const toString = async (text, options) => `tostring(${text},${JSON.stringify(options)})`;
	const toDataURL = async (text) => `dataurl(${text})`;
	const toBuffer = async (text) => Buffer.from(`buffer(${text})`);
	const opts = { toString, toDataURL, toBuffer };

	it("renders a terminal QR by default (small, like the original)", async () => {
		expect(await renderQr("otpauth://x", opts)).toBe(`tostring(otpauth://x,{"type":"terminal","small":true})`);
		expect(await renderQr("otpauth://x", { ...opts, format: "terminal" })).toBe(`tostring(otpauth://x,{"type":"terminal","small":true})`);
	});

	it("renders svg, png data URLs and png buffers", async () => {
		expect(await renderQr("otpauth://x", { ...opts, format: "svg" })).toBe(`tostring(otpauth://x,{"type":"svg"})`);
		expect(await renderQr("otpauth://x", { ...opts, format: "png-data-url" })).toBe("dataurl(otpauth://x)");
		expect(await renderQr("otpauth://x", { ...opts, format: "png-buffer" })).toEqual(Buffer.from("buffer(otpauth://x)"));
	});

	it("falls back to the qrcode package's own functions", async () => {
		const qr = await renderQr("otpauth://totp/t?secret=GEZDGNBVGY3TQOJQ");
		expect(typeof qr).toBe("string");
		expect(qr.length).toBeGreaterThan(0);
		const svg = await renderQr("otpauth://totp/t?secret=GEZDGNBVGY3TQOJQ", { format: "svg" });
		expect(svg).toMatch(/^<svg/);
		const png = await renderQr("otpauth://totp/t?secret=GEZDGNBVGY3TQOJQ", { format: "png-buffer" });
		expect(png).toBeInstanceOf(Uint8Array);
		expect(png.length).toBeGreaterThan(0);
		const dataUrl = await renderQr("otpauth://totp/t?secret=GEZDGNBVGY3TQOJQ", { format: "png-data-url" });
		expect(dataUrl).toMatch(/^data:image\/png;base64,/);
	});

	it("rejects an unknown format", async () => {
		await expect(renderQr("otpauth://x", { ...opts, format: "gif" })).rejects.toThrow(OtpError);
		await expect(renderQr("otpauth://x", { ...opts, format: "gif" })).rejects.toThrow(/unknown format "gif"/);
	});
});

describe("matchStep parity with the machine config", () => {
	it("verifyCode and the machine agree on digits and skew through the same config object", () => {
		const c = parseOtpOptions({ digits: 8, skewSteps: 2 });
		const step = stepAt(T);
		expect(verifyCode(SEED, hotp(KEY, step - 2, 8), T, c)).toBe(step - 2);
		expect(verifyCode(SEED, hotp(KEY, step - 3, 8), T, c)).toBeUndefined();
		expect(matchStep(KEY, hotp(KEY, step, 8), T, c.skewSteps, c.digits)).toBe(step);
	});

	it("verifyCode and the machine agree on period and algorithm through the same config object", () => {
		const c = parseOtpOptions({ periodSeconds: 60, algorithm: "SHA256" });
		const step = stepAt(T, c.periodSeconds);
		const code = hotp(KEY, step, c.digits, c.algorithm);
		expect(verifyCode(SEED, code, T, c)).toBe(step);
		// A default-config verifier (30 s, SHA1) must not accept it:
		expect(verifyCode(SEED, code, T)).toBeUndefined();
	});
});
