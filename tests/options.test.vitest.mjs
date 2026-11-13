/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/options.test.vitest.mjs
 *	@Date: 2026-11-12T22:01:06-08:00 (1794549666)
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
import { DEFAULTS, isOtpMachineConfig, parseOtpOptions } from "../src/options.mjs";
import { OtpError } from "../src/errors.mjs";

describe("DEFAULTS", () => {
	it("carries the reviewed option table", () => {
		expect(DEFAULTS).toEqual({
			digits: 6,
			periodSeconds: 30,
			algorithm: "SHA1",
			skewSteps: 1,
			seedBytes: 20,
			uriIssuer: "gh-broker",
			refuseReused: true,
			windowEnabled: true,
			windowSeconds: 300,
			maxFailures: 5,
			failureCounting: { mode: "since-accept-or-lockout" },
			lockoutSeconds: 600,
			lockoutEscalation: { factor: 1, maxSeconds: 600 },
			spendOnUnlock: true,
			hardLockEnabled: true,
			hardLockTrigger: { lockouts: 3, windowMs: 86_400_000 }
		});
		expect(Object.isFrozen(DEFAULTS)).toBe(true);
		expect(Object.isFrozen(DEFAULTS.failureCounting)).toBe(true);
		expect(Object.isFrozen(DEFAULTS.lockoutEscalation)).toBe(true);
		expect(Object.isFrozen(DEFAULTS.hardLockTrigger)).toBe(true);
	});
});

describe("parseOtpOptions", () => {
	it("fills every default when given nothing", () => {
		for (const nothing of [undefined, null]) {
			expect(parseOtpOptions(nothing)).toEqual(DEFAULTS);
		}
	});

	it("returns a deeply frozen config", () => {
		const config = parseOtpOptions({ maxFailures: 7 });
		expect(Object.isFrozen(config)).toBe(true);
		expect(Object.isFrozen(config.failureCounting)).toBe(true);
		expect(Object.isFrozen(config.hardLockTrigger)).toBe(true);
		// Mutating attempts don't stick.
		expect(() => {
			"use strict";
			config.maxFailures = 1;
		}).toThrow(TypeError);
	});

	it("does not freeze (or share) objects the caller passed in", () => {
		const failureCounting = { mode: "window", windowMs: 60_000 };
		const config = parseOtpOptions({ failureCounting });
		expect(Object.isFrozen(config.failureCounting)).toBe(true);
		expect(Object.isFrozen(failureCounting)).toBe(false);
	});

	it("accepts every option with a non-default value", () => {
		const config = parseOtpOptions({
			digits: 8,
			periodSeconds: 60,
			algorithm: "SHA1",
			skewSteps: 2,
			seedBytes: 32,
			uriIssuer: "quack",
			uriLabel: "ada@example.com",
			refuseReused: false,
			windowEnabled: false,
			windowSeconds: 60,
			maxFailures: 2,
			failureCounting: { mode: "window", windowMs: 60_000 },
			lockoutSeconds: 30,
			lockoutEscalation: { factor: 2, maxSeconds: 3600 },
			spendOnUnlock: false,
			hardLockEnabled: false,
			hardLockTrigger: { lockouts: 5, windowMs: 3_600_000 }
		});
		expect(config).toEqual({
			digits: 8,
			periodSeconds: 60,
			algorithm: "SHA1",
			skewSteps: 2,
			seedBytes: 32,
			uriIssuer: "quack",
			uriLabel: "ada@example.com",
			refuseReused: false,
			windowEnabled: false,
			windowSeconds: 60,
			maxFailures: 2,
			failureCounting: { mode: "window", windowMs: 60_000 },
			lockoutSeconds: 30,
			lockoutEscalation: { factor: 2, maxSeconds: 3600 },
			spendOnUnlock: false,
			hardLockEnabled: false,
			hardLockTrigger: { lockouts: 5, windowMs: 3_600_000 }
		});
	});

	it("merges a partial input over the defaults", () => {
		const config = parseOtpOptions({ windowSeconds: 120, skewSteps: 0 });
		expect(config.windowSeconds).toBe(120);
		expect(config.skewSteps).toBe(0);
		expect(config.maxFailures).toBe(DEFAULTS.maxFailures);
		expect(config.digits).toBe(DEFAULTS.digits);
	});

	it("rejects input that isn't an object", () => {
		for (const bad of ["x", 5, true, [], Symbol("x")]) {
			expect(() => parseOtpOptions(bad)).toThrow(OtpError);
			expect(() => parseOtpOptions(bad)).toThrow(/must be an object/);
		}
	});

	it("rejects unknown keys (a typo must not fall back to a default)", () => {
		expect(() => parseOtpOptions({ maxFailures: 3, maxFaiulres: 4 })).toThrow(/unknown option "maxFaiulres"/);
	});

	it("rejects unknown keys inside the nested option objects too", () => {
		expect(() => parseOtpOptions({ failureCounting: { mode: "window", windowMs: 60_000, windoMs: 1 } })).toThrow(
			/unknown option "failureCounting\.windoMs"/
		);
		expect(() => parseOtpOptions({ lockoutEscalation: { factor: 2, maxSeconds: 600, maxSeconsd: 1 } })).toThrow(
			/unknown option "lockoutEscalation\.maxSeconsd"/
		);
		expect(() => parseOtpOptions({ hardLockTrigger: { lockouts: 3, windowMs: 86_400_000, windoMs: 1 } })).toThrow(
			/unknown option "hardLockTrigger\.windoMs"/
		);
		try {
			parseOtpOptions({ failureCounting: { mode: "window", windowMs: 60_000, extra: 1 } });
		} catch (err) {
			expect(err).toBeInstanceOf(OtpError);
			expect(err.code).toBe("OTP_OPTIONS_INVALID");
		}
	});

	it.each([
		["digits below the bound", { digits: 5 }, /digits must be an integer between 6 and 8/],
		["digits above the bound", { digits: 9 }, /digits must be an integer between 6 and 8/],
		["fractional digits", { digits: 6.5 }, /digits must be an integer between 6 and 8/],
		["digits as a string", { digits: "6" }, /digits must be an integer between 6 and 8/],
		["periodSeconds zero", { periodSeconds: 0 }, /periodSeconds must be a positive integer/],
		["periodSeconds negative", { periodSeconds: -30 }, /periodSeconds must be a positive integer/],
		["periodSeconds fractional", { periodSeconds: 29.5 }, /periodSeconds must be a positive integer/],
		["unsupported algorithm", { algorithm: "MD5" }, /algorithm must be "SHA1", "SHA256" or "SHA512"/],
		["unsupported algorithm case", { algorithm: "sha256" }, /algorithm must be "SHA1", "SHA256" or "SHA512"/],
		["skewSteps above the bound", { skewSteps: 3 }, /skewSteps must be an integer between 0 and 2/],
		["skewSteps negative", { skewSteps: -1 }, /skewSteps must be an integer between 0 and 2/],
		["skewSteps fractional", { skewSteps: 1.5 }, /skewSteps must be an integer between 0 and 2/],
		["seedBytes zero", { seedBytes: 0 }, /seedBytes must be an integer of at least 16/],
		["seedBytes negative", { seedBytes: -20 }, /seedBytes must be an integer of at least 16/],
		["seedBytes just below the bound", { seedBytes: 15 }, /seedBytes must be an integer of at least 16/],
		["seedBytes fractional", { seedBytes: 20.5 }, /seedBytes must be an integer of at least 16/],
		["empty uriIssuer", { uriIssuer: "" }, /uriIssuer must be a non-empty string/],
		["uriIssuer as a number", { uriIssuer: 5 }, /uriIssuer must be a non-empty string/],
		["empty uriLabel", { uriLabel: "" }, /uriLabel must be a non-empty string when given/],
		["refuseReused as a number", { refuseReused: 1 }, /refuseReused must be a boolean/],
		["windowEnabled as a string", { windowEnabled: "yes" }, /windowEnabled must be a boolean/],
		["windowSeconds zero", { windowSeconds: 0 }, /windowSeconds must be a positive integer/],
		["windowSeconds negative", { windowSeconds: -300 }, /windowSeconds must be a positive integer/],
		["maxFailures zero", { maxFailures: 0 }, /maxFailures must be a positive integer/],
		["maxFailures fractional", { maxFailures: 4.5 }, /maxFailures must be a positive integer/],
		["lockoutSeconds zero", { lockoutSeconds: 0 }, /lockoutSeconds must be a positive integer/],
		["lockoutSeconds negative", { lockoutSeconds: -600 }, /lockoutSeconds must be a positive integer/],
		["spendOnUnlock as a number", { spendOnUnlock: 0 }, /spendOnUnlock must be a boolean/],
		["hardLockEnabled as a string", { hardLockEnabled: "no" }, /hardLockEnabled must be a boolean/],
		["failureCounting as a string", { failureCounting: "window" }, /failureCounting must be an object whose mode/],
		["failureCounting without a mode", { failureCounting: {} }, /failureCounting must be an object whose mode/],
		["failureCounting with an unknown mode", { failureCounting: { mode: "sliding" } }, /failureCounting must be an object whose mode/],
		["window mode without windowMs", { failureCounting: { mode: "window" } }, /failureCounting.windowMs must be a positive integer/],
		[
			"window mode with a zero windowMs",
			{ failureCounting: { mode: "window", windowMs: 0 } },
			/failureCounting.windowMs must be a positive integer/
		],
		[
			"window mode with a negative windowMs",
			{ failureCounting: { mode: "window", windowMs: -1 } },
			/failureCounting.windowMs must be a positive integer/
		],
		[
			"lockoutEscalation as a string",
			{ lockoutEscalation: "x" },
			/lockoutEscalation must be an object with a positive-integer factor and maxSeconds/
		],
		[
			"lockoutEscalation with a zero factor",
			{ lockoutEscalation: { factor: 0, maxSeconds: 600 } },
			/lockoutEscalation must be an object with a positive-integer factor and maxSeconds/
		],
		[
			"lockoutEscalation with a zero maxSeconds",
			{ lockoutEscalation: { factor: 1, maxSeconds: 0 } },
			/lockoutEscalation must be an object with a positive-integer factor and maxSeconds/
		],
		[
			"hardLockTrigger as a number",
			{ hardLockTrigger: 3 },
			/hardLockTrigger must be an object with a positive-integer lockouts and windowMs/
		],
		[
			"hardLockTrigger with zero lockouts",
			{ hardLockTrigger: { lockouts: 0, windowMs: 1000 } },
			/hardLockTrigger must be an object with a positive-integer lockouts and windowMs/
		],
		[
			"hardLockTrigger with a zero windowMs",
			{ hardLockTrigger: { lockouts: 3, windowMs: 0 } },
			/hardLockTrigger must be an object with a positive-integer lockouts and windowMs/
		],
		[
			"hardLockTrigger with a negative windowMs",
			{ hardLockTrigger: { lockouts: 3, windowMs: -1 } },
			/hardLockTrigger must be an object with a positive-integer lockouts and windowMs/
		]
	])("rejects %s", (_label, input, message) => {
		expect(() => parseOtpOptions(input)).toThrow(OtpError);
		try {
			parseOtpOptions(input);
		} catch (err) {
			expect(err.code).toBe("OTP_OPTIONS_INVALID");
			expect(err.message).toMatch(message);
		}
	});

	it("reports the first problem when several options are bad", () => {
		expect(() => parseOtpOptions({ digits: 9, maxFailures: 0 })).toThrow(/digits must be an integer between 6 and 8/);
	});
});

describe("lockoutEscalation.maxSeconds", () => {
	it("defaults to lockoutSeconds when not given, so factor 1 is no cap at all", () => {
		expect(parseOtpOptions({ lockoutSeconds: 900 }).lockoutEscalation).toEqual({ factor: 1, maxSeconds: 900 });
		// Also when the escalation object is given without a maxSeconds:
		expect(parseOtpOptions({ lockoutSeconds: 900, lockoutEscalation: { factor: 2 } }).lockoutEscalation).toEqual({
			factor: 2,
			maxSeconds: 900
		});
		// And the defaults keep their explicit cap:
		expect(parseOtpOptions().lockoutEscalation).toEqual({ factor: 1, maxSeconds: 600 });
	});

	it("accepts maxSeconds equal to lockoutSeconds and at the upper bound", () => {
		expect(parseOtpOptions({ lockoutEscalation: { factor: 3, maxSeconds: 600 } }).lockoutEscalation).toEqual({
			factor: 3,
			maxSeconds: 600
		});
		expect(parseOtpOptions({ lockoutEscalation: { factor: 1, maxSeconds: 8_640_000_000_000 } }).lockoutEscalation.maxSeconds).toBe(
			8_640_000_000_000
		);
	});

	it.each([
		[
			"maxSeconds below lockoutSeconds",
			{ lockoutSeconds: 900, lockoutEscalation: { factor: 1, maxSeconds: 600 } },
			/lockoutEscalation\.maxSeconds must not be below lockoutSeconds/
		],
		[
			"maxSeconds above the bound",
			{ lockoutSeconds: 600, lockoutEscalation: { factor: 1, maxSeconds: 8_640_000_000_001 } },
			/lockoutEscalation\.maxSeconds must be at most 8640000000000/
		]
	])("rejects %s", (_label, input, message) => {
		expect(() => parseOtpOptions(input)).toThrow(OtpError);
		try {
			parseOtpOptions(input);
		} catch (err) {
			expect(err.code).toBe("OTP_OPTIONS_INVALID");
			expect(err.message).toMatch(message);
		}
	});
});

describe("isOtpMachineConfig", () => {
	it("accepts the product of parseOtpOptions", () => {
		expect(isOtpMachineConfig(parseOtpOptions())).toBe(true);
		expect(isOtpMachineConfig(parseOtpOptions({ digits: 8, skewSteps: 0 }))).toBe(true);
	});

	it("rejects anything else", () => {
		expect(isOtpMachineConfig(undefined)).toBe(false);
		expect(isOtpMachineConfig(null)).toBe(false);
		expect(isOtpMachineConfig("SHA1")).toBe(false);
		expect(isOtpMachineConfig({})).toBe(false);
		expect(isOtpMachineConfig(DEFAULTS)).toBe(true);
	});
});
