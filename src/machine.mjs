/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/machine.mjs
 *	@Date: 2026-11-12T22:01:22-08:00 (1794549682)
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
 * The per-person lockout machine: a pure reducer over one person's record. It owns
 * nothing but the state it is handed — no storage, no clock (every event carries `now`),
 * no code matching (the host matches codes and tells the machine what happened), no
 * window ids (the caller computes and passes them), no prose (outcomes are reason codes;
 * hosts map them to messages).
 *
 * The machine enforces its own lock: `code-ok`, `code-bad` and `window-use` while locked
 * or hard-locked return the lock outcome without counting, consuming or resetting
 * anything — a host that forgets to call `lockStatus` first can neither accept a code nor
 * reuse an open window mid-lockout.
 */

import { OtpError } from "./errors.mjs";
import { isOtpMachineConfig } from "./options.mjs";

/**
 * One person's record. Persisted fields (`failures` through `hardLock`) survive a
 * restart; `windows` is memory-tier (ids and expiry only — no code, no digest, nothing
 * code-derived ever ships in machine state).
 *
 * @typedef {Object} PersonState
 * @property {number} failures Bad codes since the last accepted code or short lockout (or, in
 *   window-counting mode, the failures within the rolling window).
 * @property {number[]} failureTimes Ms timestamps of those failures — maintained only in
 *   window-counting mode, so `failures` stays authoritative when a host re-reads state
 *   that has no `failureTimes` field.
 * @property {string | null} lockedUntil ISO end of the current short lockout.
 * @property {string[]} lockouts ISO start times of short lockouts, pruned to the
 *   hard-lock window on every lockout.
 * @property {{ since: string, lockouts: number } | null} hardLock Frozen snapshot of the hard lock.
 * @property {number} lastCounter Highest accepted TOTP counter (spend marker).
 * @property {number} lastAcceptedPeriod The period `lastCounter` was computed under, or 0 when
 *   nothing was ever accepted.
 * @property {{ id: string, expiresAt: number }[]} windows Open reuse windows (memory-tier).
 */

/** All-zero state for a person with no entry. */
export function emptyPerson() {
	return freezePerson({
		failures: 0,
		failureTimes: [],
		lockedUntil: null,
		lockouts: [],
		hardLock: null,
		lastCounter: 0,
		lastAcceptedPeriod: 0,
		windows: []
	});
}

/**
 * Freeze a state so a returned record can't be mutated in place. Every call site passes
 * a fresh object literal; the arrays and window entries are copied too, so freezing
 * never touches a record the caller still owns.
 */
function freezePerson(state) {
	return Object.freeze({
		...state,
		failureTimes: Object.freeze([...state.failureTimes]),
		lockouts: Object.freeze([...state.lockouts]),
		windows: Object.freeze(state.windows.map((w) => Object.freeze({ ...w })))
	});
}

/** Whether `state` is shaped like a PersonState (the machine's own runtime check). */
export function isPersonState(state) {
	if (typeof state !== "object" || state === null) return false;
	return (
		typeof state.failures === "number" &&
		Array.isArray(state.failureTimes) &&
		(state.lockedUntil === null || typeof state.lockedUntil === "string") &&
		Array.isArray(state.lockouts) &&
		(state.hardLock === null || typeof state.hardLock === "object") &&
		typeof state.lastCounter === "number" &&
		typeof state.lastAcceptedPeriod === "number" &&
		Array.isArray(state.windows)
	);
}

/**
 * The lock state of `state` at `now` — read-only, never mutates and never clears.
 * @returns {"hard-locked" | "locked" | "clear"}
 */
export function lockStatus(state, now) {
	if (state.hardLock !== null) return "hard-locked";
	if (state.lockedUntil !== null && Date.parse(state.lockedUntil) > now) return "locked";
	return "clear";
}

/**
 * The counter nothing issued at or before `now` can beat: the current step plus the
 * skew. This is the spend an admin-unlock applies (and the re-base a period change
 * applies): the current code and the next stop working briefly, nothing can replay.
 * @param {number} now Ms.
 * @param {import("./options.mjs").OtpMachineConfig} config
 * @returns {number}
 */
export function spendThrough(now, config) {
	return Math.floor(now / 1000 / config.periodSeconds) + config.skewSteps;
}

/**
 * `state` tidied for persistence: lockouts pruned to the hard-lock window (strictly
 * newer kept), an expired short lockout cleared, expired windows dropped. Never touches
 * `hardLock`, `failures` or `lastCounter`. Returns the input unchanged when there is
 * nothing to prune. (Dropping a person's entry altogether — today's compact — is the
 * host's call: it needs the identity, the machine is identity-free.)
 * @param {PersonState} state
 * @param {number} now Ms.
 * @param {import("./options.mjs").OtpMachineConfig} config
 * @returns {PersonState}
 */
export function compactPerson(state, now, config) {
	const windowMs = config.hardLockTrigger.windowMs;
	const lockouts = state.lockouts.filter((t) => Date.parse(t) > now - windowMs);
	const lockedUntil = state.lockedUntil !== null && Date.parse(state.lockedUntil) > now ? state.lockedUntil : null;
	const windows = state.windows.filter((w) => w.expiresAt > now);
	if (lockouts.length === state.lockouts.length && lockedUntil === state.lockedUntil && windows.length === state.windows.length)
		return state;
	return freezePerson({ ...state, lockouts, lockedUntil, windows });
}

/**
 * The events the machine accepts. Missing and malformed codes are host input validation
 * and never reach the machine; the host computes `windowId` (keyed with a secret that is
 * never persisted) and matches codes itself.
 *
 * @typedef {Object} OtpEventCodeOk
 * @property {"code-ok"} kind A code matched a TOTP step.
 * @property {number} counter The matched step.
 * @property {string} windowId The id the host computed for the window this code opens.
 * @property {number} now Ms.
 */

/**
 * @typedef {Object} OtpEventCodeBad
 * @property {"code-bad"} kind A code matched nothing.
 * @property {number} now Ms.
 */

/**
 * @typedef {Object} OtpEventWindowUse
 * @property {"window-use"} kind A call re-used an open window's code.
 * @property {string} id The window id (the host mapped the code to it).
 * @property {number} now Ms.
 */

/**
 * @typedef {Object} OtpEventAdminUnlock
 * @property {"admin-unlock"} kind An administrator cleared this person's record.
 * @property {string} by Who unlocked (used only for the outcome and security events — never stored).
 * @property {number} now Ms.
 */

/**
 * @typedef {Object} OtpEventTick
 * @property {"tick"} kind A housekeeping beat.
 * @property {number} now Ms.
 */

/** @typedef {OtpEventCodeOk | OtpEventCodeBad | OtpEventWindowUse | OtpEventAdminUnlock | OtpEventTick} OtpEvent */

/**
 * @typedef {Object} OutcomeOpened
 * @property {"opened"} reason A code was accepted; `{ id, expiresAt }` was appended to the windows.
 * @property {number} counter The accepted step.
 * @property {string} window The window id (the caller's `windowId`, echoed).
 * @property {string} expiresAt ISO time the window closes.
 */
/** @typedef {{ reason: "window", window: string }} OutcomeWindow A window-use was accepted. */
/** @typedef {{ reason: "bad-code", failures: number }} OutcomeBadCode Counted; no lockout started. */
/** @typedef {{ reason: "locked-out", failures: number, until: string }} OutcomeLockedOut Counted AND this code started a short lockout. */
/** @typedef {{ reason: "hard-locked-now", since: string, lockouts: number }} OutcomeHardLockedNow Counted AND this code triggered the hard lock. */
/** @typedef {{ reason: "locked", until: string }} OutcomeLocked Refused while short-locked — nothing was counted. */
/** @typedef {{ reason: "hard-locked", since: string }} OutcomeHardLocked Refused while hard-locked. */
/** @typedef {{ reason: "spent-code" }} OutcomeSpentCode The counter is at or below the spend marker — not counted. */
/** @typedef {{ reason: "unlocked" } | { reason: "cleared" } | { reason: "no-entry" }} OutcomeUnlock Admin-unlock's three outcomes. */

/** @typedef {OutcomeOpened | OutcomeWindow | OutcomeBadCode | OutcomeLockedOut | OutcomeHardLockedNow | OutcomeLocked | OutcomeHardLocked | OutcomeSpentCode | OutcomeUnlock} OtpOutcome */

/** A missing, empty or non-numeric event field. */
function badEvent(what) {
	return new OtpError("OTP_EVENT_INVALID", `otp machine: ${what}`);
}

/** Validate the fields every event must carry. */
function requireNow(event) {
	if (typeof event.now !== "number" || !Number.isFinite(event.now)) throw badEvent("event.now must be a finite number of milliseconds");
}

/**
 * Apply one event to one person's record.
 *
 * @param {PersonState} state The person's current record (never mutated).
 * @param {OtpEvent} event What happened.
 * @param {import("./options.mjs").OtpMachineConfig} config A config from `parseOtpOptions`.
 * @returns {{ state: PersonState, outcome?: OtpOutcome }} The new record and, when the event
 *   produces one, its reason code. `tick` and a `window-use` for an unknown or expired
 *   id are pure state diffs with no outcome.
 */
export function stepOtp(state, event, config) {
	if (!isOtpMachineConfig(config))
		throw new OtpError("OTP_CONFIG_INVALID", "otp machine: config must be a valid machine config (build it with parseOtpOptions)");
	if (!isPersonState(state)) throw new OtpError("OTP_STATE_INVALID", "otp machine: state must be a PersonState record");
	switch (event.kind) {
		case "code-ok":
			return codeOk(state, event, config);
		case "code-bad":
			return codeBad(state, event, config);
		case "window-use":
			return windowUse(state, event);
		case "admin-unlock":
			return adminUnlock(state, event, config);
		case "tick":
			return tick(state, event);
		default: {
			const unknown = /** @type {{ kind?: unknown }} */ (event);
			throw badEvent(`unknown event kind ${JSON.stringify(unknown.kind)}`);
		}
	}
}

/**
 * The lock refusal for the events the machine enforces its lock on: no count, no consume,
 * no reset.
 * @param {PersonState} state
 * @param {"hard-locked" | "locked"} status
 * @returns {{ state: PersonState, outcome: OutcomeLocked | OutcomeHardLocked }}
 */
function lockRefusal(state, status) {
	const outcome =
		status === "hard-locked"
			? /** @type {OutcomeHardLocked} */ ({ reason: "hard-locked", since: state.hardLock.since })
			: /** @type {OutcomeLocked} */ ({ reason: "locked", until: state.lockedUntil });
	return { state, outcome };
}

/** Prune expired windows; return the input unchanged when nothing expired. */
function prunedWindows(state, now) {
	const windows = state.windows.filter((w) => w.expiresAt > now);
	return windows.length === state.windows.length ? state : freezePerson({ ...state, windows });
}

/**
 * @param {PersonState} state
 * @param {OtpEventCodeOk} event
 * @param {import("./options.mjs").OtpMachineConfig} config
 * @returns {{ state: PersonState, outcome: OutcomeOpened | OutcomeSpentCode | OutcomeLocked | OutcomeHardLocked }}
 */
function codeOk(state, event, config) {
	requireNow(event);
	const status = lockStatus(state, event.now);
	if (status !== "clear") return lockRefusal(state, status);
	if (!Number.isSafeInteger(event.counter) || event.counter < 0) throw badEvent("code-ok.counter must be a non-negative integer");
	if (typeof event.windowId !== "string" || event.windowId.length === 0) throw badEvent("code-ok.windowId must be a non-empty string");

	let working = prunedWindows(state, event.now);

	// Spent semantics: the machine decides "spent" when the counter is at or below the
	// spend marker under the stored period. If the period changed since the last accept,
	// re-base the marker to the new period first — the same spend an unlock applies:
	// nothing can replay, and the only cost is that the current codes stop working briefly.
	let lastCounter = working.lastCounter;
	let lastAcceptedPeriod = working.lastAcceptedPeriod;
	if (lastAcceptedPeriod !== 0 && lastAcceptedPeriod !== config.periodSeconds) {
		lastCounter = spendThrough(event.now, config);
		lastAcceptedPeriod = config.periodSeconds;
	}
	if (event.counter <= lastCounter) {
		const next =
			lastAcceptedPeriod !== working.lastAcceptedPeriod ? freezePerson({ ...working, lastCounter, lastAcceptedPeriod }) : working;
		return { state: next, outcome: { reason: "spent-code" } };
	}

	// Accept: the counter is fresh. Reset the guess budget, record the spend, open the
	// window (when windows are enabled — with windowEnabled false no window is appended
	// and the host must not map the code for reuse; the outcome's window fields are
	// informational only).
	const expiresAtMs = event.now + config.windowSeconds * 1000;
	const windows = config.windowEnabled ? [...working.windows, { id: event.windowId, expiresAt: expiresAtMs }] : working.windows;
	const next = freezePerson({
		...working,
		failures: 0,
		failureTimes: [],
		lastCounter: event.counter,
		lastAcceptedPeriod: config.periodSeconds,
		windows
	});
	return {
		state: next,
		outcome: { reason: "opened", counter: event.counter, window: event.windowId, expiresAt: new Date(expiresAtMs).toISOString() }
	};
}

/**
 * @param {PersonState} state
 * @param {OtpEventCodeBad} event
 * @param {import("./options.mjs").OtpMachineConfig} config
 * @returns {{ state: PersonState, outcome: OutcomeBadCode | OutcomeLockedOut | OutcomeHardLockedNow | OutcomeLocked | OutcomeHardLocked }}
 */
function codeBad(state, event, config) {
	requireNow(event);
	const status = lockStatus(state, event.now);
	if (status !== "clear") return lockRefusal(state, status);

	// Window-counting mode keeps the timestamps and counts within the rolling window;
	// the classic mode keeps a plain counter that resets on accept or lockout.
	let failures;
	let failureTimes = state.failureTimes;
	if (config.failureCounting.mode === "window") {
		const windowMs = config.failureCounting.windowMs;
		failureTimes = [...state.failureTimes, event.now].filter((t) => t > event.now - windowMs);
		failures = failureTimes.length;
	} else {
		failures = state.failures + 1;
	}
	if (failures < config.maxFailures) {
		return { state: freezePerson({ ...state, failures, failureTimes }), outcome: { reason: "bad-code", failures } };
	}
	return startLockout(state, event.now, config);
}

/**
 * The Nth bad code: reset the count, start a short lockout (escalated within the
 * hard-lock window), maybe the hard lock. Only reached on a clear lock, so
 * `state.hardLock` is null here — a hard lock is set once and never cleared or refreshed
 * by anything but admin-unlock.
 */
/**
 * @param {PersonState} state
 * @param {number} now Ms.
 * @param {import("./options.mjs").OtpMachineConfig} config
 * @returns {{ state: PersonState, outcome: OutcomeLockedOut | OutcomeHardLockedNow }}
 */
function startLockout(state, now, config) {
	const at = new Date(now).toISOString();
	const windowMs = config.hardLockTrigger.windowMs;
	const lockouts = [...state.lockouts.filter((t) => Date.parse(t) > now - windowMs), at];
	const n = lockouts.length;
	const escalated = config.lockoutSeconds * Math.pow(config.lockoutEscalation.factor, n - 1);
	const seconds = Math.min(escalated, config.lockoutEscalation.maxSeconds);
	const until = new Date(now + seconds * 1000).toISOString();
	const hardLock = config.hardLockEnabled && n >= config.hardLockTrigger.lockouts ? { since: at, lockouts: n } : null;
	const next = freezePerson({ ...state, failures: 0, failureTimes: [], lockedUntil: until, lockouts, hardLock });
	if (hardLock !== null) return { state: next, outcome: { reason: "hard-locked-now", since: hardLock.since, lockouts: n } };
	return { state: next, outcome: { reason: "locked-out", failures: 0, until } };
}

/**
 * @param {PersonState} state
 * @param {OtpEventWindowUse} event
 * @returns {{ state: PersonState, outcome?: OutcomeWindow | OutcomeLocked | OutcomeHardLocked }}
 */
function windowUse(state, event) {
	requireNow(event);
	const status = lockStatus(state, event.now);
	if (status !== "clear") return lockRefusal(state, status);
	if (typeof event.id !== "string" || event.id.length === 0) throw badEvent("window-use.id must be a non-empty string");

	// The machine re-checks the id's existence and expiry (the host matched the code).
	const working = prunedWindows(state, event.now);
	if (!working.windows.some((w) => w.id === event.id)) return { state: working };
	return { state: working, outcome: { reason: "window", window: event.id } };
}

/**
 * @param {PersonState} state
 * @param {OtpEventAdminUnlock} event
 * @param {import("./options.mjs").OtpMachineConfig} config
 * @returns {{ state: PersonState, outcome: OutcomeUnlock }}
 */
function adminUnlock(state, event, config) {
	requireNow(event);
	// The unlocker is required and recorded only in the outcome (hosts attach it to their
	// security events); the machine never stores it.
	if (typeof event.by !== "string" || event.by.length === 0)
		throw new OtpError("OTP_UNLOCK_BY_REQUIRED", 'otp machine: admin-unlock requires a non-empty "by"');

	// Everything resets except the windows (an open window survives an unlock) and the
	// spend marker: with spendOnUnlock the codes through now are spent (the lost-update
	// guard — an unlock must not hand back a code the host just used).
	const had = state.hardLock !== null || state.failures > 0 || state.lockedUntil !== null || state.lockouts.length > 0;
	const next = freezePerson({
		failures: 0,
		failureTimes: [],
		lockedUntil: null,
		lockouts: [],
		hardLock: null,
		lastCounter: config.spendOnUnlock ? spendThrough(event.now, config) : state.lastCounter,
		lastAcceptedPeriod: config.spendOnUnlock ? config.periodSeconds : state.lastAcceptedPeriod,
		windows: state.windows
	});
	const reason = /** @type {"unlocked" | "cleared" | "no-entry"} */ (state.hardLock !== null ? "unlocked" : had ? "cleared" : "no-entry");
	return { state: next, outcome: { reason } };
}

/**
 * @param {PersonState} state
 * @param {OtpEventTick} event
 * @returns {{ state: PersonState, outcome?: undefined }}
 */
function tick(state, event) {
	requireNow(event);
	// Housekeeping only: prune expired windows. Never touches hardLock, failures or the
	// spend marker — only admin-unlock clears a hard lock.
	return { state: prunedWindows(state, event.now) };
}
