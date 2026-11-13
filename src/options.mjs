/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/options.mjs
 *	@Date: 2026-11-12T22:00:40-08:00 (1794549640)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:23:45-08:00 (1794551025)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * The machine's option set. `parseOtpOptions` is the only way to build the config the
 * machine accepts: it merges the caller's input over `DEFAULTS`, validates everything
 * once up front (typed errors, never a clamp — a bad value refuses instead of being
 * quietly adjusted) and returns a frozen object.
 */

import { OtpError } from "./errors.mjs";

/**
 * The defaults (the reviewed option table): today's gh-broker numbers, plus the knobs
 * the extraction adds. `uriLabel` has no default — it is caller-supplied (it names the
 * account the URI is for).
 */
export const DEFAULTS = Object.freeze({
	/** Digits in a code. */
	digits: 6,
	/** Seconds one TOTP step lasts. */
	periodSeconds: 30,
	/** HMAC algorithm: RFC 6238's SHA-1 baseline, or SHA-256/SHA-512. */
	algorithm: "SHA1",
	/** Steps of clock skew accepted either side of the current one. */
	skewSteps: 1,
	/** Random bytes in a new seed. */
	seedBytes: 20,
	/** Issuer in the otpauth URI. */
	uriIssuer: "gh-broker",
	/** Whether a reused (spent) code is refused without counting as a guess. */
	refuseReused: true,
	/** Whether accepting a code opens a reuse window. */
	windowEnabled: true,
	/** Seconds an open window stays usable. */
	windowSeconds: 300,
	/** Bad codes that start a short lockout. */
	maxFailures: 5,
	/**
	 * How bad codes are counted: `"since-accept-or-lockout"` counts failures since the
	 * last accepted code or lockout (the classic counter); `"window"` counts failures
	 * within a rolling `windowMs` (backed by `failureTimes`).
	 */
	failureCounting: Object.freeze({ mode: "since-accept-or-lockout" }),
	/** Seconds one short lockout lasts (before escalation). */
	lockoutSeconds: 600,
	/**
	 * Lockout escalation: the Nth lockout within the rolling `hardLockTrigger.windowMs`
	 * lasts `lockoutSeconds * factor^(N-1)`, capped at `maxSeconds`.
	 */
	lockoutEscalation: Object.freeze({ factor: 1, maxSeconds: 600 }),
	/** Whether an admin-unlock also spends the codes through now (the lost-update guard). */
	spendOnUnlock: true,
	/** Whether new hard locks can be created. `false` never clears an existing one. */
	hardLockEnabled: true,
	/** Hard lock trigger: this many short lockouts within a rolling window. */
	hardLockTrigger: Object.freeze({ lockouts: 3, windowMs: 86_400_000 })
});

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);
const inRange = (v, min, max) => isInt(v) && v >= min && v <= max;
const posInt = (v) => isInt(v) && v > 0;
const nonEmptyString = (v) => typeof v === "string" && v.length > 0;

const FAILURE_COUNTING_MODES = ["since-accept-or-lockout", "window"];

/**
 * Everything wrong with `config` as a list of requirement strings (empty = valid). The
 * single source of truth for both `parseOtpOptions` (throws) and `isOtpMachineConfig`
 * (boolean), so the two can never disagree.
 * @param {Record<string, unknown>} config
 * @returns {string[]}
 */
function configProblems(config) {
	const problems = [];
	const need = (key, ok, requirement) => {
		if (!ok(config[key])) problems.push(`otp options: ${key} ${requirement}`);
	};
	need("digits", (v) => inRange(v, 6, 8), "must be an integer between 6 and 8");
	need("periodSeconds", posInt, "must be a positive integer");
	need("algorithm", (v) => v === "SHA1" || v === "SHA256" || v === "SHA512", 'must be "SHA1", "SHA256" or "SHA512"');
	need("skewSteps", (v) => inRange(v, 0, 2), "must be an integer between 0 and 2");
	need("seedBytes", posInt, "must be a positive integer");
	need("uriIssuer", nonEmptyString, "must be a non-empty string");
	need("uriLabel", (v) => v === undefined || nonEmptyString(v), "must be a non-empty string when given");
	need("refuseReused", (v) => typeof v === "boolean", "must be a boolean");
	need("windowEnabled", (v) => typeof v === "boolean", "must be a boolean");
	need("windowSeconds", posInt, "must be a positive integer");
	need("maxFailures", posInt, "must be a positive integer");
	need("lockoutSeconds", posInt, "must be a positive integer");
	need("spendOnUnlock", (v) => typeof v === "boolean", "must be a boolean");
	need("hardLockEnabled", (v) => typeof v === "boolean", "must be a boolean");

	const fc = /** @type {{ mode?: unknown, windowMs?: unknown }} */ (config.failureCounting);
	if (!isObject(fc) || !FAILURE_COUNTING_MODES.includes(/** @type {string} */ (fc.mode))) {
		problems.push(
			`otp options: failureCounting must be an object whose mode is one of ${FAILURE_COUNTING_MODES.map((m) => `"${m}"`).join(" or ")}`
		);
	} else if (fc.mode === "window" && !posInt(fc.windowMs)) {
		problems.push("otp options: failureCounting.windowMs must be a positive integer");
	}

	const esc = /** @type {{ factor?: unknown, maxSeconds?: unknown }} */ (config.lockoutEscalation);
	if (!isObject(esc) || !posInt(esc.factor) || !posInt(esc.maxSeconds)) {
		problems.push("otp options: lockoutEscalation must be an object with a positive-integer factor and maxSeconds");
	}

	const trigger = /** @type {{ lockouts?: unknown, windowMs?: unknown }} */ (config.hardLockTrigger);
	if (!isObject(trigger) || !posInt(trigger.lockouts) || !posInt(trigger.windowMs)) {
		problems.push("otp options: hardLockTrigger must be an object with a positive-integer lockouts and windowMs");
	}
	return problems;
}

const KNOWN_KEYS = new Set(Object.keys(DEFAULTS).concat("uriLabel"));

/**
 * Parse the machine's options: merge `input` over `DEFAULTS`, validate once, freeze.
 * `undefined`/`null` means "all defaults". Unknown keys are rejected (a typo must not
 * silently fall back to a default), and out-of-range values are refused, never clamped.
 * @param {unknown} [input] Partial options, or nothing for the defaults.
 * @returns {OtpMachineConfig} A frozen config with every option filled in.
 */
export function parseOtpOptions(input) {
	if (input === undefined || input === null) input = {};
	if (!isObject(input)) throw new OtpError("OTP_OPTIONS_INVALID", "otp options: must be an object");
	const raw = /** @type {Record<string, unknown>} */ (input);
	for (const key of Object.keys(raw)) {
		if (!KNOWN_KEYS.has(key)) throw new OtpError("OTP_OPTIONS_INVALID", `otp options: unknown option "${key}"`);
	}
	const merged = /** @type {Record<string, unknown>} */ ({ ...DEFAULTS, ...raw });
	// Fresh copies of the nested objects, so freezing the result never freezes an object
	// the caller still owns.
	for (const key of ["failureCounting", "lockoutEscalation", "hardLockTrigger"]) {
		if (isObject(merged[key])) merged[key] = { .../** @type {Record<string, unknown>} */ (merged[key]) };
	}
	const problems = configProblems(merged);
	if (problems.length > 0) throw new OtpError("OTP_OPTIONS_INVALID", problems[0]);
	return deepFreeze(merged);
}

/**
 * Whether `config` is a valid machine config (what `stepOtp` accepts: the frozen product
 * of `parseOtpOptions`, or any object that passes the same checks).
 * @param {unknown} config
 * @returns {boolean}
 */
export function isOtpMachineConfig(config) {
	return isObject(config) && configProblems(/** @type {Record<string, unknown>} */ (config)).length === 0;
}

/** Freeze `value` and its plain-object children (one level of nesting, which is all the config has). */
function deepFreeze(value) {
	if (isObject(value)) {
		for (const item of Object.values(value)) deepFreeze(item);
		return Object.freeze(value);
	}
	return value;
}

/**
 * @typedef {Object} OtpMachineConfig
 * @property {6|7|8} digits Digits in a code.
 * @property {number} periodSeconds Seconds one TOTP step lasts.
 * @property {"SHA1" | "SHA256" | "SHA512"} algorithm HMAC algorithm.
 * @property {0|1|2} skewSteps Steps of clock skew accepted either side.
 * @property {number} seedBytes Random bytes in a new seed.
 * @property {string} uriIssuer Issuer in the otpauth URI.
 * @property {string|undefined} [uriLabel] Caller-supplied account label for the URI.
 * @property {boolean} refuseReused Whether a spent code is refused without counting.
 * @property {boolean} windowEnabled Whether accepting a code opens a reuse window.
 * @property {number} windowSeconds Seconds an open window stays usable.
 * @property {number} maxFailures Bad codes that start a short lockout.
 * @property {{ mode: "since-accept-or-lockout" } | { mode: "window", windowMs: number }} failureCounting How bad codes are counted.
 * @property {number} lockoutSeconds Seconds one short lockout lasts (before escalation).
 * @property {{ factor: number, maxSeconds: number }} lockoutEscalation Lockout escalation within the hard-lock window.
 * @property {boolean} spendOnUnlock Whether an admin-unlock spends the codes through now.
 * @property {boolean} hardLockEnabled Whether new hard locks can be created.
 * @property {{ lockouts: number, windowMs: number }} hardLockTrigger Hard lock trigger.
 */
