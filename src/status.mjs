/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/status.mjs
 *	@Date: 2026-11-12T21:58:19-08:00 (1794549499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:44:24-08:00 (1794552264)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * Human-facing status over person records: the facts about one person's lock state and
 * the text lines a `status` command prints. The library never invents command text —
 * the unlock command (and every other host-specific prose) is a required
 * caller-supplied parameter.
 */

import { OtpError } from "./errors.mjs";
import { DEFAULTS } from "./options.mjs";

/**
 * One person's lock facts.
 *
 * @typedef {Object} PersonFacts
 * @property {boolean} locked Hard-locked, or inside a current short lockout.
 * @property {number} failures Bad codes so far.
 * @property {number} maxFailures The limit `failures` is counted against.
 * @property {string | null} lockedUntil ISO end of the current short lockout (null when expired or none).
 * @property {number} lockoutsInWindow Short lockouts within the hard-lock window.
 * @property {number} maxLockouts The limit `lockoutsInWindow` is counted against.
 * @property {{ since: string, lockouts: number } | null} hardLock The hard lock snapshot, if any.
 */

/**
 * One person's facts with the person they are about.
 *
 * @typedef {PersonFacts & { person: string }} PersonStatus
 */

/** `now` is required everywhere — the library never reads a clock. */
function requireNow(fn, now) {
	if (typeof now !== "number" || !Number.isFinite(now))
		throw new OtpError("OTP_NOW_INVALID", `${fn}: now is required (the library never reads a clock)`);
}

/**
 * One person's facts, from their record and the limits. Read-only: never mutates and
 * never prunes (pruning is the machine's).
 * @param {import("./machine.mjs").PersonState} person
 * @param {{ maxFailures?: number, maxLockouts?: number, windowMs?: number }} [limits]
 * @param {number} [now] Ms — required (the library never reads a clock); a missing or non-finite now throws OTP_NOW_INVALID.
 * @returns {PersonFacts}
 */
export function describeUser(
	person,
	{
		maxFailures = DEFAULTS.maxFailures,
		maxLockouts = DEFAULTS.hardLockTrigger.lockouts,
		windowMs = DEFAULTS.hardLockTrigger.windowMs
	} = {},
	now
) {
	requireNow("describeUser", now);
	const lockedUntil = person.lockedUntil !== null && Date.parse(person.lockedUntil) > now ? person.lockedUntil : null;
	return {
		locked: person.hardLock !== null || lockedUntil !== null,
		failures: person.failures,
		maxFailures,
		lockedUntil,
		lockoutsInWindow: person.lockouts.filter((t) => Date.parse(t) > now - windowMs).length,
		maxLockouts,
		hardLock: person.hardLock
	};
}

/**
 * The facts for every person in `states`, sorted by name.
 * @param {Record<string, import("./machine.mjs").PersonState>} states Person name → record.
 * @param {{ maxFailures?: number, maxLockouts?: number, windowMs?: number }} [limits]
 * @param {number} [now] Ms — required (the library never reads a clock); a missing or non-finite now throws OTP_NOW_INVALID.
 * @returns {PersonStatus[]}
 */
export function describeUsers(states, limits = {}, now) {
	requireNow("describeUsers", now);
	// Object keys are unique, so the names are never equal — a two-way compare is total here.
	return Object.entries(states)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([person, state]) => ({ person, ...describeUser(state, limits, now) }));
}

/** "24 h" for the default window, else the window in minutes or seconds. */
function windowLabel(windowMs) {
	if (windowMs === DEFAULTS.hardLockTrigger.windowMs) return "24 h";
	const minutes = windowMs / 60_000;
	if (Number.isInteger(minutes)) return `${minutes} min`;
	return `${Math.round(windowMs / 1000)} s`;
}

/**
 * Human-readable lines for a set of `PersonStatus` (as `describeUsers` returns). The
 * unlock command is required — a host names its own unlock command; the library never
 * assumes one.
 * @param {PersonStatus[]} users
 * @param {{ configured: boolean, unlockCommand: string, windowMs?: number }} o
 * @returns {string[]}
 */
export function formatStatus(users, { configured, unlockCommand, windowMs = DEFAULTS.hardLockTrigger.windowMs }) {
	if (typeof unlockCommand !== "string" || unlockCommand.length === 0) {
		throw new OtpError(
			"OTP_UNLOCK_COMMAND_REQUIRED",
			"formatStatus: unlockCommand must be a non-empty string (the command that clears a person's lock state)"
		);
	}
	const lines = [`OTP configured: ${configured ? "yes" : "no"}`];
	if (users.length === 0) lines.push("no persons with lock state");
	for (const d of users) {
		lines.push(`${d.person}:`);
		lines.push(`  bad codes so far: ${d.failures} of ${d.maxFailures}`);
		lines.push(`  short lockouts in the last ${windowLabel(windowMs)}: ${d.lockoutsInWindow} of ${d.maxLockouts}`);
		if (d.hardLock)
			lines.push(
				`  HARD LOCK since ${d.hardLock.since} after ${d.hardLock.lockouts} lockouts. Clear it with: ${unlockCommand} ${d.person}`
			);
		else if (d.lockedUntil) lines.push(`  short lockout until ${d.lockedUntil}`);
		else lines.push("  not locked");
	}
	return lines;
}
