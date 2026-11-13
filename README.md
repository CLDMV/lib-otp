# @cldmv/lib-otp

Configurable TOTP codes, otpauth/QR enrolment and a pure per-person lockout state machine. Used by `@cldmv/gh-broker` and Quack.

Everything is plain functions over injected inputs: no environment, no filesystem, no clock reads (every call takes `now`), no module state, no top-level side effects. ESM at source with a thin CJS shim; the only runtime dependency is `qrcode` (pure JS). Results are JSON-safe; every deliberate rejection is an [`OtpError`](#errors) with a stable `code`. Nothing — no code, no seed, nothing derived from them except caller-supplied window ids — ever appears in a result, an error or machine state.

## ✨ What's New

### Latest: v0.1.0 (November 2026)

- **First release** — configurable TOTP verification, otpauth/QR enrolment and a pure per-person lockout state machine with escalation and an optional hard lock, all driven by one validated option set. It also ships an `otp` command line (`seed`, `uri`, `qr`, `code`, `verify`) that reads seeds only from a file or stdin.
- [View full v0.1.0 Changelog](https://github.com/CLDMV/lib-otp/blob/master/docs/changelog/v0/v0.1.0.md)

## Install

```sh
npm install @cldmv/lib-otp
```

- **ESM**: `import { stepOtp } from "@cldmv/lib-otp"`
- **CJS**: `const { stepOtp } = require("@cldmv/lib-otp")` — the CJS entry is a thin shim that `require()`s the ESM bundle, so both surfaces are the same module. It needs Node.js `^20.19.0 || >=22.13.0` (`require(esm)`); older Node loads the package with `import()`.

`engines.node` is `>=20.19.0`. Development (`devEngines.runtime`) requires Node `>=22.22.0`.

### The `lib-otp-dev` condition

The package's export map carries a `lib-otp-dev` condition pointing at `src/`. Tests and dev tooling run with `--conditions=lib-otp-dev` (see `.configs/vitest.config.mjs`) so a by-name import resolves to source instead of the last build:

```sh
node --conditions=lib-otp-dev -e 'import("@cldmv/lib-otp").then(m => console.log(m.name))'
```

## The option set

`parseOtpOptions` is the only way in: it merges the input over `DEFAULTS`, validates once up front (typed errors — a bad value refuses, it is never clamped) and returns a frozen config. The machine and `verifyCode` accept only that type.

| Option              | Default                                 | Meaning                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `digits`            | `6`                                     | Digits in a code (bounded 6–8).                                                                                                                                                                                                                                                                                                               |
| `periodSeconds`     | `30`                                    | Seconds one TOTP step lasts.                                                                                                                                                                                                                                                                                                                  |
| `algorithm`         | `"SHA1"`                                | HMAC algorithm (SHA1 is the only implemented one).                                                                                                                                                                                                                                                                                            |
| `skewSteps`         | `1`                                     | Steps of clock skew accepted either side (bounded 0–2).                                                                                                                                                                                                                                                                                       |
| `seedBytes`         | `20`                                    | Random bytes in a new seed (at least 16 — RFC 4226 §4 requires a seed of at least 128 bits).                                                                                                                                                                                                                                                  |
| `uriIssuer`         | `"gh-broker"`                           | Issuer in the otpauth URI.                                                                                                                                                                                                                                                                                                                    |
| `uriLabel`          | _(caller-supplied)_                     | Account label for the URI — no default.                                                                                                                                                                                                                                                                                                       |
| `refuseReused`      | `true`                                  | Whether a spent code is refused without counting as a guess. **Unsafe to turn off**: a sniffed code can then be replayed within the skew window, and every replay opens a fresh reuse window. Kept only for hosts that explicitly want that behavior.                                                                                         |
| `windowEnabled`     | `true`                                  | Whether accepting a code opens a reuse window. `false` opens no new windows (the `opened` outcome's `window`/`expiresAt` are then null); open ones serve until expiry.                                                                                                                                                                        |
| `windowSeconds`     | `300`                                   | Seconds an open window stays usable (fixed, no renewal).                                                                                                                                                                                                                                                                                      |
| `maxFailures`       | `5`                                     | Bad codes that start a short lockout.                                                                                                                                                                                                                                                                                                         |
| `failureCounting`   | `{ mode: "since-accept-or-lockout" }`   | How bad codes count: a plain counter reset on accept or lockout, or `{ mode: "window", windowMs }` — failures within a rolling `windowMs` (backed by `failureTimes`, maintained only in window mode).                                                                                                                                         |
| `lockoutSeconds`    | `600`                                   | Seconds one short lockout lasts (before escalation).                                                                                                                                                                                                                                                                                          |
| `lockoutEscalation` | `{ factor: 1, maxSeconds: 600 }`        | The Nth lockout within the rolling `hardLockTrigger.windowMs` lasts `lockoutSeconds * factor^(N-1)`, capped at `maxSeconds`. `maxSeconds` defaults to `lockoutSeconds` when not given (factor 1 is then no cap at all), must not be below it, and is bounded at 8_640_000_000_000 s (a larger cap overflows the ms range Date can represent). |
| `spendOnUnlock`     | `true`                                  | Whether an admin-unlock also spends the codes through now (the lost-update guard).                                                                                                                                                                                                                                                            |
| `hardLockEnabled`   | `true`                                  | Whether new hard locks can be created. `false` never clears an existing one.                                                                                                                                                                                                                                                                  |
| `hardLockTrigger`   | `{ lockouts: 3, windowMs: 86_400_000 }` | Hard lock trigger: this many short lockouts within a rolling window (strictly newer entries kept).                                                                                                                                                                                                                                            |

Unknown keys are rejected, so a typo can't silently fall back to a default. Persisted timestamps are absolute and honored as-is: a changed `lockoutSeconds`/`lockoutEscalation` applies to the next lockout, `hardLock.since` stands until admin-unlock, and a `periodSeconds` change re-bases the spend marker (see below).

## The machine

One person's record; the host owns storage, code matching and prose.

```js
import { emptyPerson, stepOtp, lockStatus, parseOtpOptions } from "@cldmv/lib-otp";

const config = parseOtpOptions(); // frozen defaults
let state = emptyPerson();

// The host matched a code and tells the machine what happened:
const { state: next, outcome } = stepOtp(state, { kind: "code-ok", counter: 59_786_401, windowId: "a1b2c3d4e5f60718", now: Date.now() });
// outcome: { reason: "opened", counter, window, expiresAt }
```

### `PersonState`

| Field                | Meaning                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `failures`           | Bad codes since the last accepted code or short lockout (or, in window-counting mode, within the rolling window). |
| `failureTimes`       | Ms timestamps of those failures — maintained only in window-counting mode.                                        |
| `lockedUntil`        | ISO end of the current short lockout, or `null`.                                                                  |
| `lockouts`           | ISO start times of short lockouts, pruned to the hard-lock window.                                                |
| `hardLock`           | `{ since, lockouts }` snapshot, or `null`. Never expires; cleared only by admin-unlock.                           |
| `lastCounter`        | Highest accepted TOTP counter — the spend marker.                                                                 |
| `lastAcceptedPeriod` | The period `lastCounter` was computed under (0 when nothing was accepted).                                        |
| `windows`            | `{ id, expiresAt }` only — memory-tier; no code, no digest, nothing code-derived.                                 |

`emptyPerson()` is the all-zero record; `compactPerson(state, now, config)` tidies for persistence (prunes lockouts to the hard-lock window, clears an expired short lockout, drops expired windows; dropping the entry itself is the host's call); `isPersonState(state)` is the machine's own runtime check — strict, because hosts persist the record: every field is shape-checked (counts are safe integers ≥ 0, timestamps must parse, `hardLock` must be the full snapshot or null) and a malformed record is refused with a typed error naming the field, never guessed at. `stepOtp` never mutates its input — changed records come back frozen.

### Events

```js
{
	kind: ("code-ok", counter, windowId, now);
} // the host verified a code; windowId is the caller's (keyed with a secret that is never persisted)
{
	kind: ("code-bad", now);
} // the code matched nothing
{
	kind: ("window-use", id, now);
} // a call re-used an open window's code (the host mapped code → id)
{
	kind: ("admin-unlock", by, now);
} // an administrator cleared this person (non-empty `by` required)
{
	kind: ("tick", now);
} // housekeeping: prunes expired windows only
```

Missing and malformed codes are host input validation and never reach the machine. `now` is ms everywhere.

### Outcomes (reason codes, not prose)

| `outcome.reason`                          | Fields                           | Meaning                                                                                                                                                                                                   |
| ----------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"opened"`                                | `counter`, `window`, `expiresAt` | A code was accepted; `{ id, expiresAt }` was appended to `windows`. With `windowEnabled: false` no window exists — `window` and `expiresAt` are null, so a code → window map can never pick up a phantom. |
| `"window"`                                | `window`                         | A window-use was accepted (the window is not consumed).                                                                                                                                                   |
| `"bad-code"`                              | `failures`                       | Counted; no lockout started.                                                                                                                                                                              |
| `"locked-out"`                            | `failures`, `until`              | Counted AND this code started a short lockout (`failures` is the count that triggered it — `maxFailures`; the stored count resets to 0).                                                                  |
| `"hard-locked-now"`                       | `since`, `lockouts`              | Counted AND this code triggered the hard lock.                                                                                                                                                            |
| `"locked"`                                | `until`                          | Refused while short-locked — not counted, nothing consumed or reset.                                                                                                                                      |
| `"hard-locked"`                           | `since`                          | Refused while hard-locked.                                                                                                                                                                                |
| `"spent-code"`                            | —                                | The counter is at or below the spend marker — not counted.                                                                                                                                                |
| `"unlocked"` / `"cleared"` / `"no-entry"` | —                                | admin-unlock's three outcomes: a hard-locked entry existed / an entry existed but wasn't hard-locked / nothing to clear.                                                                                  |

The machine enforces its own lock: `code-ok`, `code-bad` and `window-use` while `lockStatus(state, now) !== "clear"` return the `locked`/`hard-locked` outcome without counting, consuming or resetting anything. `lockStatus` itself is a read-only helper. `tick` prunes expired windows and never touches `hardLock` or `failures`; only admin-unlock clears a hard lock.

**Spent semantics:** the machine decides "spent" when `counter <= lastCounter` under the stored period. If `lastAcceptedPeriod` differs from the configured `periodSeconds`, the machine re-bases `lastCounter` into the new period's units — `ceil((lastCounter + 1) * lastAcceptedPeriod / periodSeconds) - 1`, which spends exactly the time already accepted (the old marker's slot end). The conversion is independent of `now` (the first code after a reconfiguration is judged on its own merit instead of always reading as spent) and idempotent (applying it twice yields the same marker, so a host that fails to persist the conversion loses nothing).

**admin-unlock:** resets everything except the windows (an open window survives an unlock) and the spend marker; `spendOnUnlock` applies `spendThrough`. The marker only ever moves forward: on a period mismatch the old marker is converted to the new period's units first (the same re-base a code-ok applies), then the spend is a max with it — an unlock never lowers a marker a prior accept already raised. `by` is used only for the outcome and the host's security events — never stored. Hosts are expected to refuse `by === person`; the machine doesn't enforce it.

### `spendThrough`

`spendThrough(now, config)` = `floor(now / 1000 / periodSeconds) + skewSteps` — the counter nothing issued at or before `now` can beat. This is the spend an admin-unlock (and a period re-base) applies; hosts that rewrite state wholesale (an unlock-all, a corrupt-file repair) call it directly.

## Enrolment

```js
import { newSeed, otpauthUri, renderQr, verifyCode } from "@cldmv/lib-otp";

const seed = newSeed(); // 20 random bytes as base32 (32 chars); { seedBytes, random } injectable
const uri = otpauthUri(seed, "ada@example.com", "gh-broker", config); // label/issuer optional — they default to the config's uriLabel/uriIssuer
console.log(await renderQr(uri)); // terminal QR
```

- `verifyCode(seed, code, now, config)` returns the TOTP step the code matches (skew-aware, digit-count from the config), or `undefined` when it matches none. A malformed code — including a non-string one — never matches; **a broken seed throws** — a config error must never read as "no match" and lock everyone out. Take the config — not loose options — so the verifier can't disagree with the machine.
- `currentCode(seed, now, config)` returns the code an authenticator app would display at `now` — no skew window. It shares `verifyCode`'s decode and refusals (a broken seed throws, never a code for garbage), so a display path can never accept a seed the verifier would refuse.
- `otpauthUri(seed, label?, issuer?, config)` validates the seed as base32 before anything is interpolated (a raw seed like `"not&valid"` would otherwise inject a URI parameter) and defaults `label`/`issuer` to the config's `uriLabel`/`uriIssuer` when omitted (explicit arguments win).
- `renderQr(uri, { format })` renders `"terminal"` (default, small), `"svg"`, `"png-data-url"` or `"png-buffer"`; the qrcode functions are injectable (`toString`, `toDataURL`, `toBuffer`) so tests stay hermetic.

## The `otp` command-line

The package ships an `otp` CLI (the `bin` entry, built to `bin/otp.mjs`): `otp seed | uri | qr | code | verify`. It is a thin wrapper over the exported functions — every option is mapped onto `parseOtpOptions`, so the CLI can never disagree with the machine (a bad value is the library's `OtpError`, never a silent clamp). The CLI is the only part of the package that touches `process.argv`, stdin, the filesystem or the clock; the library stays pure.

```sh
otp seed --length 32 --label ada@example.com   # a new seed + its otpauth URI (shown once)
otp uri --seed-file seed.txt --label ada@example.com   # the otpauth URI for a stored seed
otp qr --seed-file seed.txt --label ada@example.com    # QR in the terminal
otp qr --seed-file seed.txt --label ada@example.com --out enrol.png   # a real .png (or .svg) file, mode 0600
otp code --seed-file seed.txt                  # the current code
otp verify 123456 --seed-file seed.txt         # exit 0 valid, exit 1 invalid
```

### The seed source — never a command-line argument

Every subcommand that takes a seed reads it from `--seed-file <path>` or from stdin (`--seed-file -` reads stdin too). Surrounding whitespace is stripped. A terminal on stdin is never read — with no `--seed-file` and a TTY on stdin, that is a usage error (exit 2), not a prompt. The seed never travels as an argument (shell history and `ps` would expose it) and never appears in an error message.

Seed files are opened `O_NOFOLLOW`: a symlinked seed file is refused (exit 1, `OTP_SEED_FILE_UNREADABLE`) rather than followed — the CLI reads the file you named, not whatever it points at. (win32 has no `O_NOFOLLOW`; there the file is simply opened.) A seed file readable by group or other produces a warning — `warning: the seed file is readable by group/other: <path>` on stderr (the path, never the content); the check is skipped on win32, where permission bits carry no group/other semantics, and under `--json` the warning appears as a `warnings` array inside the single stdout object instead of on stderr. A seed over 1 KiB is refused on both stdin and files (`OTP_SEED_TOO_LARGE`, exit 1) — a seed is ~32 characters, never a megabyte.

### Writing the QR to a file

`otp qr --out enrol.png` (or `.svg`; the extension decides the format and is checked before the seed is read) writes a real PNG (raw bytes) or SVG. The file is created exclusively — `open(path, "wx", 0o600)`, i.e. O_CREAT|O_EXCL with mode 0600, because the QR encodes the seed and must not land world-readable. An existing file is refused (`OTP_OUT_EXISTS`, exit 1), and so is a symlink in the path — O_EXCL never follows one, so `--out link.png` where `link.png → victim.txt` refuses instead of overwriting `victim.txt`. Pass `--force` to unlink an existing target first and write a fresh 0600 file (the replacement is a new file, not an in-place overwrite).

### Subcommands and flags

| Subcommand      | Flags (default)                                                                                                                                 | Output                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `seed`          | `--length <bytes>` (20, minimum 16 — RFC 4226 §4), `--algorithm <a>` (SHA1; the URI's algorithm), `--label`, `--issuer`, `--digits`, `--period` | The seed labeled `key:`, plus the `uri:` when the config carries a label (without `--label` a hint to run `otp uri` instead). |
| `uri`           | `--seed-file <path>`, `--label` (required), `--issuer` (the config's `uriIssuer`), `--digits` (6), `--period` (30), `--algorithm` (SHA1)        | The otpauth URI.                                                                                                              |
| `qr`            | the `uri` flags plus `--out <file>` and `--force`                                                                                               | The QR in the terminal, or — `--out` — a real `.png` (raw PNG bytes) or `.svg` file, created exclusively at mode 0600.        |
| `code`          | `--seed-file <path>`, `--digits`, `--period`, `--algorithm`                                                                                     | The current code.                                                                                                             |
| `verify <code>` | `--seed-file <path>`, `--digits`, `--period`, `--algorithm`                                                                                     | `valid` / `invalid`.                                                                                                          |

Every subcommand also takes `--json` (one JSON object on stdout: `{"seed", "uri"?}` / `{"uri"}` / `{"qr"}` or `{"out", "format"}` / `{"code"}` / `{"valid"}`, plus a `warnings` array when the seed read produced one; errors as `{"error": {"code", "message"}}` on stdout with a nonzero exit), `--help` / `-h` (usage per subcommand, exit 0 — under `--json` as `{"usage": "..."}`) and `--version` / `-V` (the package version — under `--json` as `{"name", "version"}`). Flags go after the subcommand (`otp uri --json`, not `otp --json uri`); a separate option value may not itself start with `--` (`--seed-file --json` is a usage error, not a file named `--json`); a flag may not be repeated (`--digits 6 --digits 8` is a usage error); numeric values must be plain decimal digits (`0x1e`, `6.0` and `1e2` are refused, not reinterpreted); and `--` ends the options — everything after it is positional.

### Exit codes

| Code | Meaning                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | success — for `verify`, the code matched.                                                                                                                                                        |
| `1`  | `verify`'s non-match (a normal outcome, `invalid`), or an error: bad seed, seed over 1 KiB, bad option value, unreadable seed file, an existing `--out` without `--force`, failed QR file write. |
| `2`  | usage error: unknown subcommand or option, repeated flag, an option value that looks like a flag, wrong positional count, missing seed source, TTY on stdin, empty seed.                         |

Under `--json`, errors carry a stable `code`: the library's own (`OTP_SEED_INVALID`, `OTP_OPTIONS_INVALID`, `OTP_URI_LABEL_REQUIRED`, …) pass through unchanged; the CLI adds `OTP_USAGE` (exit 2), `OTP_SEED_FILE_UNREADABLE`, `OTP_SEED_TOO_LARGE`, `OTP_OUT_EXISTS`, `OTP_STDIN_UNREADABLE` and `OTP_CLI_ERROR` (exit 1).

## Status reporting

```js
import { describeUser, describeUsers, formatStatus } from "@cldmv/lib-otp";

describeUser(state, { maxFailures, maxLockouts, windowMs }, now); // one person's lock facts
describeUsers(states, limits, now); // sorted facts for a map of persons
formatStatus(describeUsers(states), { configured: true, unlockCommand: "sudo my-tool otp unlock" });
```

`formatStatus`'s `unlockCommand` is required — the library never invents command text.

## TOTP and base32 primitives

`STEP_SECONDS`, `base32Encode`, `base32Decode`, `hotp`, `stepAt`, `totpAt`, `safeEqual`, `matchStep` — the pure RFC 6238 / RFC 4226 / RFC 4648 layer on `node:crypto` only. `base32Decode` throws on any character outside the alphabet, so a damaged seed is reported instead of silently producing codes nobody's authenticator can match; `matchStep` compares every candidate step (no early exit) with constant-time comparisons.

## Errors

Every deliberate rejection is an `OtpError` (an `Error` subclass) with a stable `code`:

| `code`                                               | Raised by                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `OTP_OPTIONS_INVALID`                                | `parseOtpOptions` — bad input shape, unknown key or out-of-range value.                                                  |
| `OTP_CONFIG_INVALID`                                 | `stepOtp` — the config isn't a valid machine config.                                                                     |
| `OTP_STATE_INVALID`                                  | `stepOtp` — the state isn't a `PersonState` record.                                                                      |
| `OTP_EVENT_INVALID`                                  | `stepOtp` — an unknown event kind or a missing/malformed event field.                                                    |
| `OTP_UNLOCK_BY_REQUIRED`                             | `stepOtp` — an admin-unlock without a non-empty `by`.                                                                    |
| `OTP_SEED_INVALID`                                   | `verifyCode` / `currentCode` / `otpauthUri` — an empty, non-string or non-base32 seed (a zero-byte key counts as empty). |
| `OTP_SEED_BYTES_INVALID`                             | `newSeed` — a `seedBytes` below 16 (RFC 4226 §4 requires at least 128 bits).                                             |
| `OTP_URI_LABEL_REQUIRED` / `OTP_URI_ISSUER_REQUIRED` | `otpauthUri` — a missing label or issuer.                                                                                |
| `OTP_QR_FORMAT`                                      | `renderQr` — an unknown format.                                                                                          |
| `OTP_NOW_INVALID`                                    | `describeUser` / `describeUsers` — a missing or non-finite `now` (the library never reads a clock).                      |

Messages are human-readable and safe to log: they never contain a code, a seed or anything derived from them.

## Development

```sh
npm test            # vitest (via @cldmv/vitest-runner), tests run against src/
npm run coverage    # v8 coverage — 100% across the board
npm run build:ci    # lint + format:check + types + tsup build
npm run fix:headers # file headers (via @cldmv/fix-headers)
```

## License

Apache-2.0 — Copyright (c) 2013-2026 Catalyzed Motivation Inc.
