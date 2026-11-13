/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/totp.test.vitest.mjs
 *	@Date: 2026-11-12T22:00:49-08:00 (1794549649)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:42:25-08:00 (1794552145)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, it, expect } from "vitest";
import { base32Decode, base32Encode, hotp, matchStep, safeEqual, stepAt, totpAt } from "../src/totp.mjs";
import { verifyCode } from "../src/enrol.mjs";

// RFC 6238 appendix B: the SHA1 seed is the ASCII string "12345678901234567890", 8 digits.
const RFC_KEY = Buffer.from("12345678901234567890", "ascii");
const RFC_SHA1_VECTORS = [
	[59, "94287082"],
	[1111111109, "07081804"],
	[1111111111, "14050471"],
	[1234567890, "89005924"],
	[2000000000, "69279037"],
	[20000000000, "65353130"]
];

describe("totp — RFC 6238 SHA1 test vectors", () => {
	for (const [seconds, code] of RFC_SHA1_VECTORS) {
		it(`T=${seconds} → ${code}`, () => {
			expect(totpAt(RFC_KEY, seconds * 1000, 8)).toBe(code);
		});
	}

	it("6-digit codes are the last 6 digits of the same truncation", () => {
		expect(totpAt(RFC_KEY, 59_000)).toBe("287082");
		expect(totpAt(RFC_KEY, 1111111109_000)).toBe("081804");
	});

	it("hotp matches RFC 4226 appendix D for the first counters", () => {
		expect([0, 1, 2, 3, 9].map((c) => hotp(RFC_KEY, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
	});

	it("stepAt is floor(seconds / 30)", () => {
		expect(stepAt(0)).toBe(0);
		expect(stepAt(29_999)).toBe(0);
		expect(stepAt(30_000)).toBe(1);
	});
});

// RFC 6238 appendix B: 8 digits. Each algorithm's example uses its own ASCII seed —
// 20 bytes for SHA1, 32 for SHA256, 64 for SHA512 ("1234567890…" repeated).
const RFC_SHA256_KEY = Buffer.from("12345678901234567890123456789012", "ascii");
const RFC_SHA512_KEY = Buffer.from("1234567890123456789012345678901234567890123456789012345678901234", "ascii");
const RFC_SHA256_VECTORS = [
	[59, "46119246"],
	[1111111109, "68084774"],
	[1111111111, "67062674"],
	[1234567890, "91819424"],
	[2000000000, "90698825"],
	[20000000000, "77737706"]
];
const RFC_SHA512_VECTORS = [
	[59, "90693936"],
	[1111111109, "25091201"],
	[1111111111, "99943326"],
	[1234567890, "93441116"],
	[2000000000, "38618901"],
	[20000000000, "47863826"]
];

describe("totp — RFC 6238 SHA256/SHA512 test vectors", () => {
	for (const [algorithm, key, vectors] of [
		["SHA256", RFC_SHA256_KEY, RFC_SHA256_VECTORS],
		["SHA512", RFC_SHA512_KEY, RFC_SHA512_VECTORS]
	]) {
		for (const [seconds, code] of vectors) {
			it(`${algorithm} T=${seconds} → ${code}`, () => {
				expect(totpAt(key, seconds * 1000, 8, algorithm)).toBe(code);
			});
		}
		it(`${algorithm} flows through matchStep`, () => {
			const seconds = 59;
			const code = totpAt(key, seconds * 1000, 8, algorithm);
			expect(matchStep(key, code, seconds * 1000, 1, 8, algorithm)).toBe(Math.floor(seconds / 30));
			// A SHA-1 verifier must not accept a SHA-256/SHA-512 code:
			expect(matchStep(RFC_KEY, code, seconds * 1000, 1, 8, "SHA1")).toBeUndefined();
		});
	}
});

describe("totp — configurable period", () => {
	it("stepAt honours periodSeconds", () => {
		expect(stepAt(59_999, 60)).toBe(0);
		expect(stepAt(60_000, 60)).toBe(1);
	});
	it("a period-60 verifier matches a period-60 authenticator and not a period-30 one", () => {
		const code = totpAt(RFC_KEY, 90_000, 6, "SHA1", 60);
		expect(matchStep(RFC_KEY, code, 90_000, 1, 6, "SHA1", 60)).toBe(1);
		expect(matchStep(RFC_KEY, code, 90_000, 1, 6, "SHA1", 30)).toBeUndefined();
	});
});

describe("base32 (RFC 4648)", () => {
	const vectors = [
		["", ""],
		["f", "MY"],
		["fo", "MZXQ"],
		["foo", "MZXW6"],
		["foob", "MZXW6YQ"],
		["fooba", "MZXW6YTB"],
		["foobar", "MZXW6YTBOI"]
	];
	for (const [plain, encoded] of vectors) {
		it(`"${plain}" ↔ "${encoded}"`, () => {
			expect(base32Encode(Buffer.from(plain))).toBe(encoded);
			expect(base32Decode(encoded).toString()).toBe(plain);
		});
	}

	it("encodes the RFC 6238 seed", () => {
		expect(base32Encode(RFC_KEY)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
	});

	it("decodes lowercase and tolerates trailing padding", () => {
		expect(base32Decode("mzxw6ytboi======").toString()).toBe("foobar");
	});

	it("rejects characters outside the alphabet", () => {
		expect(() => base32Decode("MZXW1")).toThrow(/invalid character/);
		expect(() => base32Decode("MZ=XW")).toThrow(/invalid character/);
	});
});

describe("matchStep", () => {
	const now = 1111111111_000;
	const step = stepAt(now);

	it("accepts the current step and one either side, returning the matched step", () => {
		expect(matchStep(RFC_KEY, hotp(RFC_KEY, step), now)).toBe(step);
		expect(matchStep(RFC_KEY, hotp(RFC_KEY, step - 1), now)).toBe(step - 1);
		expect(matchStep(RFC_KEY, hotp(RFC_KEY, step + 1), now)).toBe(step + 1);
	});

	it("rejects codes two steps away", () => {
		expect(matchStep(RFC_KEY, hotp(RFC_KEY, step - 2), now)).toBeUndefined();
		expect(matchStep(RFC_KEY, hotp(RFC_KEY, step + 2), now)).toBeUndefined();
	});

	it("rejects malformed codes without comparing", () => {
		const good = hotp(RFC_KEY, step);
		expect(matchStep(RFC_KEY, ` ${good}`, now)).toBeUndefined();
		expect(matchStep(RFC_KEY, good.slice(1), now)).toBeUndefined();
		expect(matchStep(RFC_KEY, "abcdef", now)).toBeUndefined();
		expect(matchStep(RFC_KEY, `${good}0`, now)).toBeUndefined();
	});

	it("returns undefined for a non-string code (never a throw)", () => {
		const seed = base32Encode(RFC_KEY);
		for (const bad of [undefined, null, 123456, NaN, { code: 123456 }]) {
			expect(matchStep(RFC_KEY, bad, now)).toBeUndefined();
			expect(verifyCode(seed, bad, now)).toBeUndefined();
		}
	});

	it("supports other skews and digit counts", () => {
		expect(matchStep(RFC_KEY, hotp(RFC_KEY, step - 1), now, 0)).toBeUndefined();
		expect(matchStep(RFC_KEY, "14050471", now, 0, 8)).toBe(step);
	});
});

describe("safeEqual", () => {
	it("compares equal-length strings and never matches different lengths", () => {
		expect(safeEqual("123456", "123456")).toBe(true);
		expect(safeEqual("123456", "123457")).toBe(false);
		expect(safeEqual("123456", "1234567")).toBe(false);
	});
});
