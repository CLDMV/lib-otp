/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/status.test.vitest.mjs
 *	@Date: 2026-11-12T22:03:49-08:00 (1794549829)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:03:57-08:00 (1794549837)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, it, expect } from "vitest";
import { OtpError } from "../src/errors.mjs";
import { emptyPerson } from "../src/machine.mjs";
import { describeUser, describeUsers, formatStatus } from "../src/status.mjs";

const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();

describe("describeUser", () => {
	it("reports the defaults for a fresh record", () => {
		expect(describeUser(emptyPerson(), {}, NOW)).toEqual({
			locked: false,
			failures: 0,
			maxFailures: 5,
			lockedUntil: null,
			lockoutsInWindow: 0,
			maxLockouts: 3,
			hardLock: null
		});
	});

	it("reports a live short lockout, and drops it the moment it expires", () => {
		const person = { ...emptyPerson(), failures: 2, lockedUntil: iso(NOW + 5 * MIN) };
		expect(describeUser(person, {}, NOW)).toMatchObject({ locked: true, lockedUntil: iso(NOW + 5 * MIN), failures: 2 });
		expect(describeUser(person, {}, NOW + 5 * MIN).lockedUntil).toBeNull();
		expect(describeUser(person, {}, NOW + 5 * MIN).locked).toBe(false);
	});

	it("reports a hard lock and counts lockouts within the window only", () => {
		const person = { ...emptyPerson(), lockouts: [iso(NOW - DAY), iso(NOW - MIN)], hardLock: { since: iso(NOW - MIN), lockouts: 3 } };
		const facts = describeUser(person, {}, NOW);
		expect(facts.locked).toBe(true);
		expect(facts.hardLock).toEqual(person.hardLock);
		// A lockout exactly 24 h old is outside the window (strict >).
		expect(facts.lockoutsInWindow).toBe(1);
	});

	it("takes its limits from the caller", () => {
		const person = { ...emptyPerson(), failures: 2, lockouts: [iso(NOW - 30_000), iso(NOW - 59_000)] };
		const limits = { maxFailures: 4, maxLockouts: 9, windowMs: 60_000 };
		expect(describeUser(person, limits, NOW)).toEqual({
			locked: false,
			failures: 2,
			maxFailures: 4,
			lockedUntil: null,
			lockoutsInWindow: 2,
			maxLockouts: 9,
			hardLock: null
		});
	});

	it("defaults now to the current time", () => {
		const person = { ...emptyPerson(), lockedUntil: iso(Date.now() + MIN) };
		expect(describeUser(person).locked).toBe(true);
	});
});

describe("describeUsers", () => {
	it("sorts by name and describes every person", () => {
		const states = {
			zed: { ...emptyPerson(), failures: 1 },
			ada: { ...emptyPerson(), hardLock: { since: iso(NOW), lockouts: 3 } }
		};
		expect(describeUsers(states, {}, NOW).map((u) => u.person)).toEqual(["ada", "zed"]);
		const [ada] = describeUsers(states, {}, NOW);
		expect(ada).toMatchObject({ person: "ada", locked: true, hardLock: { since: iso(NOW), lockouts: 3 } });
	});

	it("is empty for no persons", () => {
		expect(describeUsers({}, {}, NOW)).toEqual([]);
	});
});

describe("formatStatus", () => {
	it("prints the documented lines, with the unlock command the caller supplies", () => {
		const users = describeUsers(
			{
				zed: { ...emptyPerson(), failures: 2 },
				ada: {
					...emptyPerson(),
					lockouts: [iso(NOW - MIN), iso(NOW - 2 * MIN), iso(NOW - 3 * MIN)],
					hardLock: { since: iso(NOW - MIN), lockouts: 3 }
				},
				sam: { ...emptyPerson(), failures: 5, lockedUntil: iso(NOW + 5 * MIN) }
			},
			{},
			NOW
		);
		expect(formatStatus(users, { configured: true, unlockCommand: "sudo gh-broker otp unlock" })).toEqual([
			"OTP configured: yes",
			"ada:",
			"  bad codes so far: 0 of 5",
			"  short lockouts in the last 24 h: 3 of 3",
			"  HARD LOCK since 2026-11-01T11:59:00.000Z after 3 lockouts. Clear it with: sudo gh-broker otp unlock ada",
			"sam:",
			"  bad codes so far: 5 of 5",
			"  short lockouts in the last 24 h: 0 of 3",
			"  short lockout until 2026-11-01T12:05:00.000Z",
			"zed:",
			"  bad codes so far: 2 of 5",
			"  short lockouts in the last 24 h: 0 of 3",
			"  not locked"
		]);
	});

	it("says when OTP is not configured and when nobody has lock state", () => {
		expect(formatStatus([], { configured: false, unlockCommand: "unlock" })).toEqual(["OTP configured: no", "no persons with lock state"]);
	});

	it("names the caller's window in the lockout line", () => {
		const users = describeUsers({ ada: emptyPerson() }, {}, NOW);
		expect(formatStatus(users, { configured: true, unlockCommand: "unlock", windowMs: 3_600_000 })).toEqual([
			"OTP configured: yes",
			"ada:",
			"  bad codes so far: 0 of 5",
			"  short lockouts in the last 60 min: 0 of 3",
			"  not locked"
		]);
		expect(formatStatus(users, { configured: true, unlockCommand: "unlock", windowMs: 30_000 })[3]).toBe(
			"  short lockouts in the last 30 s: 0 of 3"
		);
	});

	it("requires the unlock command (the library never invents command text)", () => {
		const users = describeUsers({ ada: emptyPerson() }, {}, NOW);
		for (const bad of [undefined, "", 5]) {
			expect(() => formatStatus(users, { configured: true, unlockCommand: bad })).toThrow(OtpError);
			expect(() => formatStatus(users, { configured: true, unlockCommand: bad })).toThrow(/unlockCommand must be a non-empty string/);
		}
	});
});
