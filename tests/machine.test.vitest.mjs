/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/machine.test.vitest.mjs
 *	@Date: 2026-11-12T22:03:47-08:00 (1794549827)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:44:24-08:00 (1794552264)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, it, expect } from "vitest";
import { parseOtpOptions } from "../src/options.mjs";
import { OtpError } from "../src/errors.mjs";
import { compactPerson, emptyPerson, isPersonState, lockStatus, spendThrough, stepOtp } from "../src/machine.mjs";
import { stepAt } from "../src/totp.mjs";

const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** The TOTP counter at NOW. */
const C = stepAt(NOW);
const iso = (ms) => new Date(ms).toISOString();
const cfg = (over = {}) => parseOtpOptions(over);
const config = cfg();

/** A fresh record with a code accepted at NOW (one open window, spend marker at C). */
function accepted() {
	return stepOtp(emptyPerson(), { kind: "code-ok", counter: C, windowId: "w0", now: NOW }, config).state;
}

/** Run fn expecting the OtpError with the given code. */
function otpError(fn, code) {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(OtpError);
		expect(err.code).toBe(code);
		return err;
	}
	throw new Error("expected an OtpError");
}

describe("lockStatus", () => {
	it("is clear for a fresh or spent-out record", () => {
		expect(lockStatus(emptyPerson(), NOW)).toBe("clear");
		expect(lockStatus(accepted(), NOW)).toBe("clear");
	});

	it("is locked while a short lockout stands, and clear the moment it expires", () => {
		const locked = { ...emptyPerson(), lockedUntil: iso(NOW + 5 * MIN) };
		expect(lockStatus(locked, NOW)).toBe("locked");
		expect(lockStatus(locked, NOW + 5 * MIN - 1)).toBe("locked");
		expect(lockStatus(locked, NOW + 5 * MIN)).toBe("clear"); // strict: an expired lockout is not a lock
	});

	it("is hard-locked regardless of any short lockout", () => {
		const hard = { ...emptyPerson(), hardLock: { since: iso(NOW), lockouts: 3 }, lockedUntil: iso(NOW + 5 * MIN) };
		expect(lockStatus(hard, NOW)).toBe("hard-locked");
	});

	it("never mutates anything", () => {
		const state = accepted();
		const before = JSON.parse(JSON.stringify(state));
		lockStatus(state, NOW);
		expect(JSON.parse(JSON.stringify(state))).toEqual(before);
	});
});

describe("stepOtp — accept (code-ok)", () => {
	it("opens a window, resets the guess budget and records the spend", () => {
		const before = { ...emptyPerson(), failures: 3, failureTimes: [NOW - 1000, NOW - 500, NOW - 100] };
		const { state, outcome } = stepOtp(before, { kind: "code-ok", counter: C, windowId: "w1", now: NOW }, config);
		expect(outcome).toEqual({ reason: "opened", counter: C, window: "w1", expiresAt: iso(NOW + 5 * MIN) });
		expect(state).toEqual({
			failures: 0,
			failureTimes: [],
			lockedUntil: null,
			lockouts: [],
			hardLock: null,
			lastCounter: C,
			lastAcceptedPeriod: 30,
			windows: [{ id: "w1", expiresAt: NOW + 5 * MIN }]
		});
		// The input was not mutated.
		expect(before.failures).toBe(3);
		expect(before.windows).toEqual([]);
	});

	it("returns a frozen record", () => {
		const { state } = stepOtp(emptyPerson(), { kind: "code-ok", counter: C, windowId: "w1", now: NOW }, config);
		expect(Object.isFrozen(state)).toBe(true);
		expect(Object.isFrozen(state.windows)).toBe(true);
		expect(Object.isFrozen(state.windows[0])).toBe(true);
		expect(Object.isFrozen(state.lockouts)).toBe(true);
		expect(Object.isFrozen(state.failureTimes)).toBe(true);
	});

	it("keeps several windows, one per accepted code, and prunes expired ones first", () => {
		let state = emptyPerson();
		({ state } = stepOtp(state, { kind: "code-ok", counter: C, windowId: "w1", now: NOW }, config));
		({ state } = stepOtp(state, { kind: "code-ok", counter: C + 1, windowId: "w2", now: NOW + 30_000 }, config));
		expect(state.windows).toEqual([
			{ id: "w1", expiresAt: NOW + 5 * MIN },
			{ id: "w2", expiresAt: NOW + 30_000 + 5 * MIN }
		]);
		// The first window expires; a third accept drops it.
		({ state } = stepOtp(state, { kind: "code-ok", counter: C + 2, windowId: "w3", now: NOW + 5 * MIN + 1 }, config));
		expect(state.windows).toEqual([
			{ id: "w2", expiresAt: NOW + 30_000 + 5 * MIN },
			{ id: "w3", expiresAt: NOW + 5 * MIN + 1 + 5 * MIN }
		]);
	});

	it("opens no window when windowEnabled is false, but still accepts and spends (null window fields)", () => {
		const noWindows = cfg({ windowEnabled: false });
		const { state, outcome } = stepOtp(emptyPerson(), { kind: "code-ok", counter: C, windowId: "w1", now: NOW }, noWindows);
		// The window fields are null — a host's code → window map must never pick up a
		// window that does not exist.
		expect(outcome).toEqual({ reason: "opened", counter: C, window: null, expiresAt: null });
		expect(state.windows).toEqual([]);
		expect(state.lastCounter).toBe(C);
	});

	it("refuses a fresh code for a person who never accepted one only via the spend marker, not the period", () => {
		// A fresh record (lastAcceptedPeriod 0) must not be re-based: the current code is acceptable.
		const { outcome } = stepOtp(emptyPerson(), { kind: "code-ok", counter: C, windowId: "w1", now: NOW }, config);
		expect(outcome.reason).toBe("opened");
	});
});

describe("stepOtp — spent codes", () => {
	it("refuses a code at or below the spend marker without counting it", () => {
		const state = accepted();
		const before = JSON.parse(JSON.stringify(state));
		for (const counter of [C, C - 1, 0]) {
			const r = stepOtp(state, { kind: "code-ok", counter, windowId: "w9", now: NOW + 1000 }, config);
			expect(r.outcome).toEqual({ reason: "spent-code" });
			expect(r.state).toEqual(before);
		}
	});

	it("does not reset a failure count", () => {
		const state = { ...emptyPerson(), failures: 2 };
		const r = stepOtp(state, { kind: "code-ok", counter: C, windowId: "w1", now: NOW }, config);
		expect(r.outcome.reason).toBe("opened");
		const r2 = stepOtp(r.state, { kind: "code-ok", counter: C, windowId: "w1", now: NOW + 1000 }, config);
		expect(r2.outcome).toEqual({ reason: "spent-code" });
		expect(r2.state.failures).toBe(0); // reset happened at the accept, not at the spent refusal
	});

	it("accepts a reused code when refuseReused is false, and the marker still only moves forward", () => {
		const state = accepted();
		const noRefuse = cfg({ refuseReused: false });
		const r = stepOtp(state, { kind: "code-ok", counter: C - 1, windowId: "w8", now: NOW + 1000 }, noRefuse);
		expect(r.outcome.reason).toBe("opened");
		// The spend marker never goes backward:
		expect(r.state.lastCounter).toBe(C);
		expect(r.state.windows).toHaveLength(2);
		// And under the default (refuseReused true) the same code is still spent:
		expect(stepOtp(r.state, { kind: "code-ok", counter: C - 1, windowId: "w9", now: NOW + 2000 }, config).outcome).toEqual({
			reason: "spent-code"
		});
	});

	// The old marker C (period 30) accepted everything through slot C's end; in 60 s units
	// that end falls in slot ceil((C + 1) / 2) - 1. NOW falls exactly on a 60 s boundary,
	// so the current 60 s step equals the converted marker.
	const converted60 = Math.ceil((C + 1) / 2) - 1;

	it("re-bases the spend marker to the new period's units when the period changed, independent of now", () => {
		// Accepted under period 30; the host reconfigured to period 60.
		const state = accepted();
		const p60 = cfg({ periodSeconds: 60 });
		// The current 60 s code (the first one presented after the change) is spent — its
		// slot was already accepted under the old period.
		const r = stepOtp(state, { kind: "code-ok", counter: Math.floor(NOW / 1000 / 60), windowId: "w1", now: NOW }, p60);
		expect(r.outcome).toEqual({ reason: "spent-code" });
		expect(r.state.lastCounter).toBe(converted60);
		expect(r.state.lastAcceptedPeriod).toBe(60);

		// And nothing below the re-based marker can replay afterwards.
		const r2 = stepOtp(r.state, { kind: "code-ok", counter: converted60, windowId: "w1", now: NOW + 1000 }, p60);
		expect(r2.outcome).toEqual({ reason: "spent-code" });
		// A counter above it is accepted (the machine only knows the spend marker).
		const r3 = stepOtp(r2.state, { kind: "code-ok", counter: converted60 + 1, windowId: "w1", now: NOW + 1000 }, p60);
		expect(r3.outcome.reason).toBe("opened");
	});

	it("a period change followed by a fresh code gives opened, with the whole state saved in that one step", () => {
		const state = accepted();
		const p60 = cfg({ periodSeconds: 60 });
		// One 60 s step past the converted marker: a code from the next new-period slot.
		const fresh = converted60 + 1;
		const r = stepOtp(state, { kind: "code-ok", counter: fresh, windowId: "w1", now: NOW + 61_000 }, p60);
		expect(r.outcome).toEqual({ reason: "opened", counter: fresh, window: "w1", expiresAt: iso(NOW + 61_000 + 5 * MIN) });
		// The accept state is complete in one step — the caller saves once; there is no
		// intermediate marker-only record to persist first (the old re-base locked the
		// person out for as many periods in a row as it took to save it).
		expect(r.state.lastCounter).toBe(fresh);
		expect(r.state.lastAcceptedPeriod).toBe(60);
	});

	it("a code from before the change (its old-period counter, converted) is still refused as spent", () => {
		const state = accepted();
		const p60 = cfg({ periodSeconds: 60 });
		// The accepted code itself: old counter C, which covers new slot converted60.
		const r = stepOtp(state, { kind: "code-ok", counter: converted60, windowId: "w1", now: NOW + 1000 }, p60);
		expect(r.outcome).toEqual({ reason: "spent-code" });
		expect(r.state.lastCounter).toBe(converted60);
	});

	it("the re-base is idempotent — applying it twice yields the same marker", () => {
		const state = accepted();
		const p60 = cfg({ periodSeconds: 60 });
		const spent = { kind: "code-ok", counter: converted60, windowId: "w1", now: NOW };
		const first = stepOtp(state, spent, p60);
		expect(first.outcome).toEqual({ reason: "spent-code" });
		const again = stepOtp(first.state, spent, p60);
		expect(again.outcome).toEqual({ reason: "spent-code" });
		expect(again.state).toBe(first.state); // same marker, no second conversion
	});

	it("re-bases when the period changed in the other direction (60 s → 30 s)", () => {
		const state = stepOtp(
			emptyPerson(),
			{ kind: "code-ok", counter: Math.floor(NOW / 1000 / 60), windowId: "w1", now: NOW },
			cfg({ periodSeconds: 60 })
		).state;
		const r = stepOtp(state, { kind: "code-ok", counter: C, windowId: "w1", now: NOW }, cfg({ periodSeconds: 30 }));
		// The 60 s marker's slot end falls in 30 s slot C + 1: the current 30 s code is spent.
		expect(r.state.lastCounter).toBe(C + 1);
		expect(r.state.lastAcceptedPeriod).toBe(30);
		expect(r.outcome).toEqual({ reason: "spent-code" });
		// A code from the next 30 s slot is fresh:
		const r2 = stepOtp(r.state, { kind: "code-ok", counter: C + 2, windowId: "w1", now: NOW + 61_000 }, cfg({ periodSeconds: 30 }));
		expect(r2.outcome.reason).toBe("opened");
	});
});

describe("stepOtp — bad codes and lockouts", () => {
	it("counts bad codes up to the limit, then starts a short lockout", () => {
		let state = emptyPerson();
		for (let i = 1; i < 5; i++) {
			const r = stepOtp(state, { kind: "code-bad", now: NOW + i }, config);
			expect(r.outcome).toEqual({ reason: "bad-code", failures: i });
			state = r.state;
		}
		const r = stepOtp(state, { kind: "code-bad", now: NOW + 5 }, config);
		expect(r.outcome).toEqual({ reason: "locked-out", failures: 5, until: iso(NOW + 5 + 10 * MIN) });
		expect(r.state).toEqual({
			failures: 0,
			failureTimes: [],
			lockedUntil: iso(NOW + 5 + 10 * MIN),
			lockouts: [iso(NOW + 5)],
			hardLock: null,
			lastCounter: 0,
			lastAcceptedPeriod: 0,
			windows: []
		});
	});

	it("keeps counting after a short lockout expires (a new lockout pushes to the lockout list)", () => {
		let state = emptyPerson();
		for (let i = 0; i < 5; i++) state = stepOtp(state, { kind: "code-bad", now: NOW + i }, config).state;
		// After the lockout expires, five more bad codes start a second lockout.
		let last;
		for (let i = 0; i < 4; i++) {
			const r = stepOtp(state, { kind: "code-bad", now: NOW + 11 * MIN + i }, config);
			expect(r.outcome.reason).toBe("bad-code");
			state = r.state;
		}
		last = stepOtp(state, { kind: "code-bad", now: NOW + 11 * MIN + 4 }, config);
		expect(last.outcome).toEqual({ reason: "locked-out", failures: 5, until: iso(NOW + 11 * MIN + 4 + 10 * MIN) });
		expect(last.state.lockouts).toEqual([iso(NOW + 4), iso(NOW + 11 * MIN + 4)]);
	});

	it("only counts lockouts within the hard-lock window (strictly newer kept)", () => {
		const c = cfg({ maxFailures: 1, hardLockTrigger: { lockouts: 2, windowMs: DAY } });
		let state = emptyPerson();
		// A lockout exactly 24 h old drops out of the window (strict >).
		state = { ...state, lockouts: [iso(NOW - DAY)] };
		let r = stepOtp(state, { kind: "code-bad", now: NOW }, c);
		expect(r.outcome.reason).toBe("locked-out");
		expect(r.state.lockouts).toEqual([iso(NOW)]);
		expect(r.state.hardLock).toBeNull();

		// One a moment inside the window counts.
		r = stepOtp(r.state, { kind: "code-bad", now: NOW + 11 * MIN }, c);
		expect(r.outcome).toEqual({ reason: "hard-locked-now", since: iso(NOW + 11 * MIN), lockouts: 2 });
		expect(r.state.hardLock).toEqual({ since: iso(NOW + 11 * MIN), lockouts: 2 });
	});

	it("hard-locks at the trigger and never overwrites an existing hard lock", () => {
		const c = cfg({ maxFailures: 1, lockoutSeconds: 60, hardLockTrigger: { lockouts: 3, windowMs: DAY } });
		let state = emptyPerson();
		let outcomes = [];
		for (let i = 0; i < 3; i++) {
			const at = NOW + i * 2 * MIN;
			const r = stepOtp(state, { kind: "code-bad", now: at }, c);
			outcomes.push(r.outcome);
			state = r.state;
			// Skip past each 60 s lockout before the next bad code.
			if (i < 2) state = { ...state, lockedUntil: null };
		}
		expect(outcomes.map((o) => o.reason)).toEqual(["locked-out", "locked-out", "hard-locked-now"]);
		expect(state.hardLock).toEqual({ since: iso(NOW + 4 * MIN), lockouts: 3 });

		// Once hard-locked, nothing but admin-unlock clears it — and a further bad code is
		// refused without counting, so no new lockout (and no overwrite) can even start.
		const r = stepOtp(state, { kind: "code-bad", now: NOW + 60 * MIN }, c);
		expect(r.outcome).toEqual({ reason: "hard-locked", since: iso(NOW + 4 * MIN) });
		expect(r.state.hardLock).toEqual({ since: iso(NOW + 4 * MIN), lockouts: 3 });
	});

	it("creates no hard lock when hardLockEnabled is false, but still short-locks", () => {
		const c = cfg({ maxFailures: 1, lockoutSeconds: 60, hardLockEnabled: false, hardLockTrigger: { lockouts: 2, windowMs: DAY } });
		let state = emptyPerson();
		state = stepOtp(state, { kind: "code-bad", now: NOW }, c).state;
		state = { ...state, lockedUntil: null };
		const r = stepOtp(state, { kind: "code-bad", now: NOW + 2 * MIN }, c);
		expect(r.outcome).toEqual({ reason: "locked-out", failures: 1, until: iso(NOW + 2 * MIN + 60_000) });
		expect(r.state.hardLock).toBeNull();
		expect(r.state.lockouts).toEqual([iso(NOW), iso(NOW + 2 * MIN)]);

		// Toggling the option back on does not retroactively create one, and the machine
		// still enforces the short lockout.
		const on = cfg({ maxFailures: 1, lockoutSeconds: 60, hardLockTrigger: { lockouts: 2, windowMs: DAY } });
		const r2 = stepOtp(r.state, { kind: "code-bad", now: NOW + 2 * MIN }, on);
		expect(r2.outcome).toEqual({ reason: "locked", until: iso(NOW + 2 * MIN + 60_000) });
	});

	it("escalates the Nth lockout within the hard-lock window, capped at maxSeconds", () => {
		const c = cfg({
			maxFailures: 1,
			lockoutSeconds: 60,
			lockoutEscalation: { factor: 2, maxSeconds: 100 },
			hardLockTrigger: { lockouts: 99, windowMs: DAY }
		});
		let state = emptyPerson();
		let r = stepOtp(state, { kind: "code-bad", now: NOW }, c); // 1st: 60 * 2^0 = 60 s
		expect(r.outcome.until).toBe(iso(NOW + 60_000));
		state = { ...r.state, lockedUntil: null };
		r = stepOtp(state, { kind: "code-bad", now: NOW + 2 * MIN }, c); // 2nd: 60 * 2^1 = 120 s → capped at 100 s
		expect(r.outcome.until).toBe(iso(NOW + 2 * MIN + 100_000));
	});

	it("a lockoutSeconds above the old 600 default locks the full duration when maxSeconds is not given", () => {
		// maxSeconds defaults to lockoutSeconds, so a 900 s lockout is never clamped to 600.
		const c = cfg({ maxFailures: 1, lockoutSeconds: 900, hardLockTrigger: { lockouts: 99, windowMs: DAY } });
		const r = stepOtp(emptyPerson(), { kind: "code-bad", now: NOW }, c);
		expect(r.outcome.until).toBe(iso(NOW + 900_000));
	});

	it("counts within a rolling window in window-counting mode, with failureTimes maintained", () => {
		const c = cfg({ failureCounting: { mode: "window", windowMs: 60_000 }, maxFailures: 3 });
		let state = { ...emptyPerson(), failureTimes: [NOW - 120_000, NOW - 30_000] };
		// The 2-minute-old failure is outside the window; the fresh one joins the 30 s one.
		let r = stepOtp(state, { kind: "code-bad", now: NOW }, c);
		expect(r.outcome).toEqual({ reason: "bad-code", failures: 2 });
		expect(r.state.failureTimes).toEqual([NOW - 30_000, NOW]);
		state = r.state;
		r = stepOtp(state, { kind: "code-bad", now: NOW + 1000 }, c);
		expect(r.outcome).toEqual({ reason: "locked-out", failures: 3, until: iso(NOW + 1000 + 10 * MIN) });
		expect(r.state.failureTimes).toEqual([]);
	});

	it("in classic mode failureTimes is never maintained", () => {
		const r = stepOtp(emptyPerson(), { kind: "code-bad", now: NOW }, config);
		expect(r.state.failureTimes).toEqual([]);
	});
});

describe("stepOtp — the machine enforces its own lock", () => {
	const locked = () => ({
		...emptyPerson(),
		failures: 4,
		lockedUntil: iso(NOW + 5 * MIN),
		windows: [{ id: "w1", expiresAt: NOW + 3 * MIN }]
	});

	it("refuses code-ok while short-locked, without counting, consuming or resetting", () => {
		const state = locked();
		const r = stepOtp(state, { kind: "code-ok", counter: C + 10, windowId: "w2", now: NOW }, config);
		expect(r.outcome).toEqual({ reason: "locked", until: iso(NOW + 5 * MIN) });
		expect(r.state).toBe(state); // untouched — the very same record
	});

	it("refuses code-bad while short-locked, without counting", () => {
		const state = locked();
		const r = stepOtp(state, { kind: "code-bad", now: NOW }, config);
		expect(r.outcome).toEqual({ reason: "locked", until: iso(NOW + 5 * MIN) });
		expect(r.state.failures).toBe(4);
		expect(r.state).toBe(state);
	});

	it("refuses window-use while short-locked, without consuming the window", () => {
		const state = locked();
		const r = stepOtp(state, { kind: "window-use", id: "w1", now: NOW }, config);
		expect(r.outcome).toEqual({ reason: "locked", until: iso(NOW + 5 * MIN) });
		expect(r.state).toBe(state);
		expect(r.state.windows).toEqual([{ id: "w1", expiresAt: NOW + 3 * MIN }]);
	});

	it("refuses everything while hard-locked, naming the lock's start", () => {
		const state = { ...locked(), lockedUntil: null, hardLock: { since: iso(NOW - DAY), lockouts: 3 } };
		for (const event of [
			{ kind: "code-ok", counter: C + 10, windowId: "w2", now: NOW },
			{ kind: "code-bad", now: NOW },
			{ kind: "window-use", id: "w1", now: NOW }
		]) {
			const r = stepOtp(state, event, config);
			expect(r.outcome).toEqual({ reason: "hard-locked", since: iso(NOW - DAY) });
			expect(r.state).toBe(state);
		}
	});

	it("enforces the lock before validating the rest of the event (a locked host gets the lock outcome, not a throw)", () => {
		const state = locked();
		expect(stepOtp(state, { kind: "code-ok", counter: -1, windowId: "", now: NOW }, config).outcome.reason).toBe("locked");
		expect(stepOtp(state, { kind: "window-use", id: "", now: NOW }, config).outcome.reason).toBe("locked");
	});
});

describe("stepOtp — window-use", () => {
	it("accepts a live window id without consuming it", () => {
		const state = accepted();
		const r = stepOtp(state, { kind: "window-use", id: "w0", now: NOW + MIN }, config);
		expect(r.outcome).toEqual({ reason: "window", window: "w0" });
		expect(r.state.windows).toEqual(state.windows); // the window stays open for the whole window
	});

	it("returns no outcome for an unknown id, without changing anything", () => {
		const state = accepted();
		const r = stepOtp(state, { kind: "window-use", id: "nope", now: NOW }, config);
		expect(r.outcome).toBeUndefined();
		expect(r.state).toBe(state);
	});

	it("returns no outcome for an expired id and prunes it", () => {
		const state = {
			...emptyPerson(),
			windows: [
				{ id: "old", expiresAt: NOW },
				{ id: "live", expiresAt: NOW + MIN }
			]
		};
		const r = stepOtp(state, { kind: "window-use", id: "old", now: NOW }, config);
		expect(r.outcome).toBeUndefined();
		expect(r.state.windows).toEqual([{ id: "live", expiresAt: NOW + MIN }]);
	});

	it("honours a non-default windowSeconds (the outcome's expiry and the window-use expiry follow it)", () => {
		const c = cfg({ windowSeconds: 120 });
		const { state, outcome } = stepOtp(emptyPerson(), { kind: "code-ok", counter: C, windowId: "w1", now: NOW }, c);
		expect(outcome).toEqual({ reason: "opened", counter: C, window: "w1", expiresAt: iso(NOW + 120_000) });
		// Usable up to the last ms inside the window, gone the moment it expires:
		expect(stepOtp(state, { kind: "window-use", id: "w1", now: NOW + 120_000 - 1 }, c).outcome).toEqual({ reason: "window", window: "w1" });
		const r = stepOtp(state, { kind: "window-use", id: "w1", now: NOW + 120_000 }, c);
		expect(r.outcome).toBeUndefined();
		expect(r.state.windows).toEqual([]);
	});
});

describe("stepOtp — admin-unlock", () => {
	const hardLocked = () => ({
		...emptyPerson(),
		failures: 0,
		lockedUntil: null,
		lockouts: [iso(NOW - DAY), iso(NOW - 2 * MIN)],
		hardLock: { since: iso(NOW - 2 * MIN), lockouts: 3 },
		lastCounter: C,
		lastAcceptedPeriod: 30,
		windows: [{ id: "w1", expiresAt: NOW + MIN }]
	});

	it("clears a hard-locked person (unlocked), spending through now, keeping windows", () => {
		const r = stepOtp(hardLocked(), { kind: "admin-unlock", by: "root", now: NOW }, config);
		expect(r.outcome).toEqual({ reason: "unlocked" });
		expect(r.state).toEqual({
			failures: 0,
			failureTimes: [],
			lockedUntil: null,
			lockouts: [],
			hardLock: null,
			lastCounter: spendThrough(NOW, config),
			lastAcceptedPeriod: 30,
			windows: [{ id: "w1", expiresAt: NOW + MIN }]
		});
	});

	it("clears a not-hard-locked person (cleared)", () => {
		const state = { ...emptyPerson(), failures: 2, lockedUntil: iso(NOW + MIN), lockouts: [iso(NOW)] };
		const r = stepOtp(state, { kind: "admin-unlock", by: "root", now: NOW }, config);
		expect(r.outcome).toEqual({ reason: "cleared" });
		expect(r.state.hardLock).toBeNull();
		expect(r.state.failures).toBe(0);
		expect(r.state.lockouts).toEqual([]);
	});

	it("reports no-entry for a person with nothing to clear, with NO state change (the spend is skipped)", () => {
		const state = emptyPerson();
		const r = stepOtp(state, { kind: "admin-unlock", by: "root", now: NOW }, config);
		expect(r.outcome).toEqual({ reason: "no-entry" });
		expect(r.state).toBe(state); // the very same record — not even the spend marker moved
	});

	it("spends skew 0, 1 and 2 through admin-unlock", () => {
		for (const skewSteps of [0, 1, 2]) {
			const c = cfg({ skewSteps });
			const r = stepOtp({ ...emptyPerson(), failures: 1 }, { kind: "admin-unlock", by: "root", now: NOW }, c);
			expect(r.outcome.reason).toBe("cleared");
			expect(r.state.lastCounter).toBe(Math.floor(NOW / 1000 / 30) + skewSteps);
		}
	});

	it("clears a person whose only mark is an expired short lockout", () => {
		const state = { ...emptyPerson(), lockedUntil: iso(NOW - MIN) };
		const r = stepOtp(state, { kind: "admin-unlock", by: "root", now: NOW }, config);
		expect(r.outcome).toEqual({ reason: "cleared" });
		expect(r.state.lockedUntil).toBeNull();
	});

	it("requires a non-empty by (typed error)", () => {
		for (const by of [undefined, "", 5, null]) {
			otpError(() => stepOtp(emptyPerson(), { kind: "admin-unlock", by, now: NOW }, config), "OTP_UNLOCK_BY_REQUIRED");
		}
	});

	it("never stores by, and the cleared record carries only the documented fields", () => {
		const r = stepOtp(hardLocked(), { kind: "admin-unlock", by: "ada", now: NOW }, config);
		expect(Object.keys(r.state).sort()).toEqual([
			"failureTimes",
			"failures",
			"hardLock",
			"lastAcceptedPeriod",
			"lastCounter",
			"lockedUntil",
			"lockouts",
			"windows"
		]);
		expect(JSON.stringify(r.state)).not.toContain("ada");
	});

	it("keeps lastCounter and the period when spendOnUnlock is false", () => {
		const c = cfg({ spendOnUnlock: false });
		const r = stepOtp(hardLocked(), { kind: "admin-unlock", by: "root", now: NOW }, c);
		expect(r.outcome.reason).toBe("unlocked");
		expect(r.state.lastCounter).toBe(C);
		expect(r.state.lastAcceptedPeriod).toBe(30);
	});

	it("the spend stops the codes through now from reopening a window", () => {
		const r = stepOtp(hardLocked(), { kind: "admin-unlock", by: "root", now: NOW }, config);
		const spent = stepOtp(r.state, { kind: "code-ok", counter: C, windowId: "w2", now: NOW + 1000 }, config);
		expect(spent.outcome).toEqual({ reason: "spent-code" });
	});

	it("never moves lastCounter backward when the marker is already ahead of the spend", () => {
		// The old spendThrough re-base dropped a marker of C + 5 back down to C + 1.
		const state = { ...emptyPerson(), failures: 1, lastCounter: C + 5, lastAcceptedPeriod: 30 };
		const r = stepOtp(state, { kind: "admin-unlock", by: "root", now: NOW }, config);
		expect(r.outcome.reason).toBe("cleared");
		expect(r.state.lastCounter).toBe(C + 5);
		expect(r.state.lastAcceptedPeriod).toBe(30);
	});

	it("on a period mismatch the old marker is converted first, then maxed with the spend", () => {
		// A marker of 100 under period 60 converts to 201 under period 30 — far ahead of
		// the spend at 500 s (floor(500/30) + 1 = 17). The max keeps the conversion; the
		// old spendThrough re-base would have dropped the marker from 100 to 17.
		const state = { ...emptyPerson(), failures: 1, lastCounter: 100, lastAcceptedPeriod: 60 };
		const r = stepOtp(state, { kind: "admin-unlock", by: "root", now: 500_000 }, cfg({ periodSeconds: 30 }));
		expect(r.outcome.reason).toBe("cleared");
		expect(r.state.lastCounter).toBe(201);
		expect(r.state.lastAcceptedPeriod).toBe(30);
	});

	it("on a period mismatch a spend ahead of the converted marker wins", () => {
		// Accepted under period 60 with marker 1 long ago; unlock at 1000 s under period
		// 30: the spend (floor(1000/30) + 1 = 34) is ahead of the converted marker (3).
		const state = { ...emptyPerson(), failures: 1, lastCounter: 1, lastAcceptedPeriod: 60 };
		const r = stepOtp(state, { kind: "admin-unlock", by: "root", now: 1000_000 }, cfg({ periodSeconds: 30 }));
		expect(r.outcome.reason).toBe("cleared");
		expect(r.state.lastCounter).toBe(Math.floor(1000_000 / 1000 / 30) + 1);
		expect(r.state.lastAcceptedPeriod).toBe(30);
	});
});

describe("stepOtp — tick", () => {
	it("prunes expired windows only", () => {
		const state = {
			...emptyPerson(),
			failures: 3,
			hardLock: { since: iso(NOW), lockouts: 1 },
			lastCounter: C,
			windows: [
				{ id: "old", expiresAt: NOW },
				{ id: "live", expiresAt: NOW + MIN }
			]
		};
		const r = stepOtp(state, { kind: "tick", now: NOW }, config);
		expect(r.outcome).toBeUndefined();
		expect(r.state.windows).toEqual([{ id: "live", expiresAt: NOW + MIN }]);
		// Nothing else moved.
		expect(r.state.failures).toBe(3);
		expect(r.state.hardLock).toEqual(state.hardLock);
		expect(r.state.lastCounter).toBe(C);
	});

	it("returns the same record when nothing expired", () => {
		const state = accepted();
		const r = stepOtp(state, { kind: "tick", now: NOW }, config);
		expect(r.outcome).toBeUndefined();
		expect(r.state).toBe(state);
	});
});

describe("stepOtp — validation", () => {
	it("requires a config from parseOtpOptions", () => {
		otpError(() => stepOtp(emptyPerson(), { kind: "tick", now: NOW }, {}), "OTP_CONFIG_INVALID");
		otpError(() => stepOtp(emptyPerson(), { kind: "tick", now: NOW }, undefined), "OTP_CONFIG_INVALID");
	});

	it("requires a PersonState", () => {
		for (const bad of [undefined, null, "state", 5, {}, { failures: 0 }]) {
			otpError(() => stepOtp(bad, { kind: "tick", now: NOW }, config), "OTP_STATE_INVALID");
		}
	});

	it("rejects an unknown event kind", () => {
		otpError(() => stepOtp(emptyPerson(), { kind: "reset", now: NOW }, config), "OTP_EVENT_INVALID");
		otpError(() => stepOtp(emptyPerson(), {}, config), "OTP_EVENT_INVALID");
	});

	it("rejects a non-object event (null included) with a typed error", () => {
		for (const event of [null, undefined, 5, "code-ok", true]) {
			const err = otpError(() => stepOtp(emptyPerson(), event, config), "OTP_EVENT_INVALID");
			expect(err.message).toMatch(/event must be an object/);
		}
	});

	it("rejects a non-finite or non-number now", () => {
		for (const now of [undefined, NaN, Infinity, "now"]) {
			otpError(() => stepOtp(emptyPerson(), { kind: "code-bad", now }, config), "OTP_EVENT_INVALID");
		}
	});

	it("rejects a bad code-ok counter or windowId (on a clear lock)", () => {
		for (const counter of [-1, 1.5, "5", NaN]) {
			otpError(() => stepOtp(emptyPerson(), { kind: "code-ok", counter, windowId: "w1", now: NOW }, config), "OTP_EVENT_INVALID");
		}
		for (const windowId of [undefined, "", 5]) {
			otpError(() => stepOtp(emptyPerson(), { kind: "code-ok", counter: C, windowId, now: NOW }, config), "OTP_EVENT_INVALID");
		}
	});

	it("rejects a bad window-use id (on a clear lock)", () => {
		for (const id of [undefined, "", 5]) {
			otpError(() => stepOtp(emptyPerson(), { kind: "window-use", id, now: NOW }, config), "OTP_EVENT_INVALID");
		}
	});
});

describe("spendThrough", () => {
	it("is floor(now / period) + skew", () => {
		expect(spendThrough(NOW, cfg())).toBe(Math.floor(NOW / 1000 / 30) + 1);
		expect(spendThrough(NOW, cfg({ skewSteps: 0 }))).toBe(Math.floor(NOW / 1000 / 30));
		expect(spendThrough(NOW, cfg({ skewSteps: 2 }))).toBe(Math.floor(NOW / 1000 / 30) + 2);
		expect(spendThrough(NOW, cfg({ periodSeconds: 60, skewSteps: 0 }))).toBe(Math.floor(NOW / 1000 / 60));
	});
});

describe("compactPerson", () => {
	it("prunes lockouts outside the hard-lock window, clears an expired short lockout and drops expired windows", () => {
		const state = {
			...emptyPerson(),
			failures: 2,
			lockedUntil: iso(NOW - MIN),
			lockouts: [iso(NOW - DAY), iso(NOW - 30_000)],
			hardLock: { since: iso(NOW - DAY), lockouts: 1 },
			windows: [
				{ id: "old", expiresAt: NOW - 1 },
				{ id: "live", expiresAt: NOW + MIN }
			]
		};
		const compacted = compactPerson(state, NOW, config);
		expect(compacted).toEqual({
			...state,
			lockedUntil: null,
			lockouts: [iso(NOW - 30_000)],
			windows: [{ id: "live", expiresAt: NOW + MIN }]
		});
		expect(compacted.hardLock).toEqual(state.hardLock); // a hard lock stands until admin-unlock
	});

	it("keeps a live short lockout and lockouts exactly on the boundary are dropped (strict >)", () => {
		const state = { ...emptyPerson(), lockedUntil: iso(NOW + MIN), lockouts: [iso(NOW - DAY)] };
		const compacted = compactPerson(state, NOW, config);
		expect(compacted.lockedUntil).toBe(iso(NOW + MIN));
		expect(compacted.lockouts).toEqual([]);
	});

	it("returns the same record when there is nothing to prune", () => {
		const state = accepted();
		expect(compactPerson(state, NOW, config)).toBe(state);
	});
});

describe("isPersonState", () => {
	it("accepts the machine's records", () => {
		expect(isPersonState(emptyPerson())).toBe(true);
		expect(isPersonState(accepted())).toBe(true);
		expect(isPersonState({ ...emptyPerson(), hardLock: { since: iso(NOW), lockouts: 1 } })).toBe(true);
		expect(isPersonState({ ...emptyPerson(), failureTimes: [NOW - 1000], windows: [{ id: "w", expiresAt: NOW + 1 }] })).toBe(true);
	});

	it.each([
		["a non-object", 5],
		["null", null],
		["an array", []],
		["a record without failures", { ...emptyPerson(), failures: undefined }],
		["a record with a non-number failures", { ...emptyPerson(), failures: "3" }],
		["a record with a fractional failures", { ...emptyPerson(), failures: 1.5 }],
		["a record with a negative failures", { ...emptyPerson(), failures: -1 }],
		["a record with a NaN failures", { ...emptyPerson(), failures: NaN }],
		["a record without failureTimes", { ...emptyPerson(), failureTimes: undefined }],
		["a record with a non-array failureTimes", { ...emptyPerson(), failureTimes: "x" }],
		["a record with a non-finite failureTimes entry", { ...emptyPerson(), failureTimes: [NOW, NaN] }],
		["a record with a non-number failureTimes entry", { ...emptyPerson(), failureTimes: [NOW, "x"] }],
		["a record with an unparseable lockedUntil", { ...emptyPerson(), lockedUntil: "garbage" }],
		["a record with a non-string, non-null lockedUntil", { ...emptyPerson(), lockedUntil: 5 }],
		["a record without lockouts", { ...emptyPerson(), lockouts: undefined }],
		["a record with a non-array lockouts", { ...emptyPerson(), lockouts: 5 }],
		["a record with an unparseable lockouts entry", { ...emptyPerson(), lockouts: [iso(NOW), "garbage"] }],
		["a record with a non-string lockouts entry", { ...emptyPerson(), lockouts: [5] }],
		["a record with a non-object, non-null hardLock", { ...emptyPerson(), hardLock: 5 }],
		["a record with an array hardLock", { ...emptyPerson(), hardLock: [] }],
		["a record with an empty hardLock", { ...emptyPerson(), hardLock: {} }],
		["a record with an unparseable hardLock.since", { ...emptyPerson(), hardLock: { since: "garbage", lockouts: 1 } }],
		["a record with a non-string hardLock.since", { ...emptyPerson(), hardLock: { since: 5, lockouts: 1 } }],
		["a record with a negative hardLock.lockouts", { ...emptyPerson(), hardLock: { since: iso(NOW), lockouts: -1 } }],
		["a record with a fractional hardLock.lockouts", { ...emptyPerson(), hardLock: { since: iso(NOW), lockouts: 1.5 } }],
		["a record without lastCounter", { ...emptyPerson(), lastCounter: undefined }],
		["a record with a non-number lastCounter", { ...emptyPerson(), lastCounter: "5" }],
		["a record with a NaN lastCounter", { ...emptyPerson(), lastCounter: NaN }],
		["a record with a negative lastCounter", { ...emptyPerson(), lastCounter: -1 }],
		["a record without lastAcceptedPeriod", { ...emptyPerson(), lastAcceptedPeriod: undefined }],
		["a record with a non-number lastAcceptedPeriod", { ...emptyPerson(), lastAcceptedPeriod: "30" }],
		["a record with a negative lastAcceptedPeriod", { ...emptyPerson(), lastAcceptedPeriod: -1 }],
		["a record with an infinite lastAcceptedPeriod", { ...emptyPerson(), lastAcceptedPeriod: Infinity }],
		["a record without windows", { ...emptyPerson(), windows: undefined }],
		["a record with a non-array windows", { ...emptyPerson(), windows: {} }],
		["a record with a non-object windows entry", { ...emptyPerson(), windows: ["w"] }],
		["a record with an array windows entry", { ...emptyPerson(), windows: [[]] }],
		["a record with a null windows entry", { ...emptyPerson(), windows: [null] }],
		["a record with a windows entry without an id", { ...emptyPerson(), windows: [{ expiresAt: NOW + 1 }] }],
		["a record with a windows entry with an empty id", { ...emptyPerson(), windows: [{ id: "", expiresAt: NOW + 1 }] }],
		["a record with a windows entry with a non-finite expiresAt", { ...emptyPerson(), windows: [{ id: "w", expiresAt: Infinity }] }],
		["a record with a windows entry with a non-number expiresAt", { ...emptyPerson(), windows: [{ id: "w", expiresAt: "soon" }] }]
	])("rejects %s", (_label, state) => {
		expect(isPersonState(state)).toBe(false);
	});

	it("stepOtp rejects a malformed record with a typed error naming the field", () => {
		const err = otpError(
			() => stepOtp({ ...emptyPerson(), lockedUntil: "garbage" }, { kind: "tick", now: NOW }, config),
			"OTP_STATE_INVALID"
		);
		expect(err.message).toMatch(/lockedUntil/);
		otpError(() => stepOtp({ ...emptyPerson(), lastCounter: NaN }, { kind: "tick", now: NOW }, config), "OTP_STATE_INVALID");
		otpError(() => stepOtp({ ...emptyPerson(), hardLock: {} }, { kind: "tick", now: NOW }, config), "OTP_STATE_INVALID");
		otpError(
			() => stepOtp({ ...emptyPerson(), windows: [{ id: "w", expiresAt: Infinity }] }, { kind: "tick", now: NOW }, config),
			"OTP_STATE_INVALID"
		);
	});
});

describe("invariants", () => {
	it("only admin-unlock clears a hard lock — code-ok, code-bad and tick never do", () => {
		const hardLocked = { ...emptyPerson(), hardLock: { since: iso(NOW), lockouts: 3 } };
		// Refusals keep it:
		expect(stepOtp(hardLocked, { kind: "code-ok", counter: C + 5, windowId: "w1", now: NOW }, config).state.hardLock).toEqual(
			hardLocked.hardLock
		);
		expect(stepOtp(hardLocked, { kind: "code-bad", now: NOW }, config).state.hardLock).toEqual(hardLocked.hardLock);
		expect(stepOtp(hardLocked, { kind: "tick", now: NOW + DAY }, config).state.hardLock).toEqual(hardLocked.hardLock);
		// Even with hard locks disabled now, the existing one stands:
		const off = cfg({ hardLockEnabled: false });
		expect(stepOtp(hardLocked, { kind: "code-ok", counter: C + 5, windowId: "w1", now: NOW }, off).outcome.reason).toBe("hard-locked");
		// Only the unlock clears it:
		expect(stepOtp(hardLocked, { kind: "admin-unlock", by: "root", now: NOW }, config).state.hardLock).toBeNull();
	});
});
