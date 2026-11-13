#!/usr/bin/env node
/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/bin/otp.mjs
 *	@Date: 2026-11-12T18:03:25-08:00 (1794535405)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T23:19:58-08:00 (1794554398)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * The `otp` command line: `otp seed | uri | qr | code | verify` over the library's
 * exported functions. This module is the ONLY place in the package that touches
 * `process.argv`, stdin, the filesystem or the clock — the library itself stays pure.
 *
 * The seed never travels as a command-line argument (shell history and `ps` would
 * expose it): every subcommand that takes a seed reads it from `--seed-file <path>` or
 * stdin. A terminal on stdin is never read — that is a usage error, not a prompt. A
 * seed file is opened O_NOFOLLOW (a symlink is refused) and refused when readable by
 * group/other; a seed over 1 KiB is refused outright.
 *
 * Everything is built for testing: `run(argv, io)` returns the exit code and takes an
 * injectable I/O object (streams, seed-file reader, exclusive writer, the clock), and
 * the module has no side effects on import — the main guard at the bottom only fires
 * when the file is executed directly (`node bin/otp.mjs`, `node src/bin/otp.mjs` or the
 * installed `otp`).
 */

import { open as fsOpen, unlink as fsUnlink } from "node:fs/promises";
import { constants as fsConstants, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OtpError } from "../errors.mjs";
import { name, parseOtpOptions, version } from "../index.mjs";
import { currentCode, newSeed, otpauthUri, renderQr, verifyCode } from "../enrol.mjs";

/**
 * A usage error: bad subcommand, unknown option, a missing seed source. Always exit 2.
 * Carries the usage text to print after the message (the general usage when omitted),
 * and — when the parse got far enough to have options — the options parsed so far, so
 * the reporter knows which output mode the failing command line had settled on.
 */
class UsageError extends Error {
	/**
	 * @param {string} message What was wrong with the command line.
	 * @param {string} [usage] The usage text to print (per subcommand when the error
	 *   belongs to one; the general usage when omitted).
	 * @param {Record<string, string | boolean>} [opts] The options parsed before the failure.
	 */
	constructor(message, usage, opts) {
		super(message);
		this.usage = usage;
		this.opts = opts;
	}
}

/** The general usage (also the tail of every usage error without a subcommand). */
const GENERAL_USAGE = `otp — TOTP codes, otpauth URIs and QR enrolment (@cldmv/lib-otp)

Usage:
  otp <subcommand> [options]

Subcommands:
  seed     Make a new seed and print it with its otpauth URI.
  uri      Print the otpauth URI for a seed.
  qr       Show the URI's QR code in the terminal, or write it to a file.
  code     Print the current TOTP code for a seed.
  verify   Check a code against a seed (exit 0 when valid, 1 when not).

Seed source:
  Every subcommand that takes a seed reads it from --seed-file <path> or from stdin
  (piped or redirected; "--seed-file -" reads stdin too). A terminal is never read:
  with no --seed-file and a TTY on stdin, that is a usage error. A seed file may not
  be a symlink (O_NOFOLLOW), is refused when readable by group or other, and a seed
  over 1 KiB is refused.

Global options:
  --json          One JSON object on stdout (errors too, with a nonzero exit).
  --help, -h      This usage; per subcommand: otp <subcommand> --help.
  --version, -V   Print the package version.

Exit codes:
  0  success
  1  the code did not verify, or an error (bad seed, unreadable seed file, a seed over 1 KiB, bad option value, a missing --label on uri/qr, an existing --out without --force, a failed QR file write)
  2  usage error (unknown subcommand or option, wrong positional count, missing seed source, empty seed, stdin is a TTY)
`;

/** Per-subcommand usage, printed by `otp <subcommand> --help` and by that subcommand's usage errors. */
const COMMAND_USAGE = {
	seed: `Usage: otp seed [options]

Make a new seed and print it with its otpauth URI. The seed is shown once — store it
in the authenticator immediately.

Options:
  --length <bytes>     Random bytes in the seed (default: 20, minimum: 16).
  --algorithm <a>      The URI's algorithm: SHA1 (default), SHA256 or SHA512.
  --label <label>      Account label in the URI.
  --issuer <issuer>    Issuer in the URI (default: the config's uriIssuer).
  --digits <6|7|8>     Digits in a code (default: 6).
  --period <seconds>   Seconds per TOTP step (default: 30).
  --json               Print {"seed": "...", "uri": "..."}.
  --help, -h           This usage.

This subcommand takes no seed.
`,
	uri: `Usage: otp uri [options]

Print the otpauth URI for a seed. Reads the seed from --seed-file <path> or stdin.

Options:
  --seed-file <path>   Read the seed from a file ("-" reads stdin; default: stdin).
  --label <label>      Account label in the URI (required — there is no default).
  --issuer <issuer>    Issuer in the URI (default: the config's uriIssuer).
  --digits <6|7|8>     Digits in a code (default: 6).
  --period <seconds>   Seconds per TOTP step (default: 30).
  --algorithm <a>      SHA1 (default), SHA256 or SHA512.
  --json               Print {"uri": "..."}.
  --help, -h           This usage.
`,
	qr: `Usage: otp qr [options]

Show the seed's otpauth URI as a QR code in the terminal, or write it to a file.
Reads the seed from --seed-file <path> or stdin.

Options:
  --seed-file <path>   Read the seed from a file ("-" reads stdin; default: stdin).
  --out <file>         Write the QR to a file instead: a .png file (real PNG bytes)
                       or an .svg file. Without --out, the QR goes to the terminal.
                       The file is created exclusively with mode 0600 — an existing
                       file, or a symlink in the path, is refused (the QR is the seed
                       in disguise).
  --force              With --out: unlink an existing target first and write a fresh
                       file. Without it, an existing target is an error.
  --label <label>      Account label in the URI (required — there is no default).
  --issuer <issuer>    Issuer in the URI (default: the config's uriIssuer).
  --digits <6|7|8>     Digits in a code (default: 6).
  --period <seconds>   Seconds per TOTP step (default: 30).
  --algorithm <a>      SHA1 (default), SHA256 or SHA512.
  --json               Print {"qr": "..."} (terminal) or {"out": "...", "format": "png"|"svg"}.
  --help, -h           This usage.
`,
	code: `Usage: otp code [options]

Print the TOTP code the seed generates right now. Reads the seed from
--seed-file <path> or stdin.

Options:
  --seed-file <path>   Read the seed from a file ("-" reads stdin; default: stdin).
  --digits <6|7|8>     Digits in a code (default: 6).
  --period <seconds>   Seconds per TOTP step (default: 30).
  --algorithm <a>      SHA1 (default), SHA256 or SHA512.
  --json               Print {"code": "..."}.
  --help, -h           This usage.
`,
	verify: `Usage: otp verify <code> [options]

Check a code against a seed and exit 0 when it matches (accepting the configured
clock skew either side of the current step), 1 when it does not. An invalid code is
a normal outcome, not an error. Reads the seed from --seed-file <path> or stdin.

Options:
  --seed-file <path>   Read the seed from a file ("-" reads stdin; default: stdin).
  --digits <6|7|8>     Digits in a code (default: 6).
  --period <seconds>   Seconds per TOTP step (default: 30).
  --algorithm <a>      SHA1 (default), SHA256 or SHA512.
  --json               Print {"valid": true|false} (an invalid code still exits 1).
  --help, -h           This usage.
`
};

/** The flags each subcommand accepts (besides the globals `--json`/`--help`/`--version`). */
const COMMAND_FLAGS = {
	seed: ["length", "algorithm", "label", "issuer", "digits", "period"],
	uri: ["label", "issuer", "digits", "period", "algorithm", "seedFile"],
	qr: ["label", "issuer", "digits", "period", "algorithm", "seedFile", "out", "force"],
	code: ["digits", "period", "algorithm", "seedFile"],
	verify: ["digits", "period", "algorithm", "seedFile"]
};

/** The positional-argument counts each subcommand accepts. */
const COMMAND_POSITIONALS = {
	seed: [0],
	uri: [0],
	qr: [0],
	code: [0],
	verify: [1]
};

/** Option spellings that map onto a camelCase flag name. */
const FLAG_ALIASES = { "seed-file": "seedFile" };

/** Flags that are switches, not values: they take no argument, in either spelling. */
const VALUELESS_FLAGS = new Set(["force"]);

/** O_NOFOLLOW where the platform defines it; win32 lacks the flag, and Number(undefined) is NaN, which bitwise-ORs as 0. */
const O_NOFOLLOW = Number(fsConstants.O_NOFOLLOW);

/**
 * The real seed-file reader: opens with O_NOFOLLOW (a symlinked seed file is refused —
 * ELOOP surfaces as OTP_SEED_FILE_UNREADABLE, never as some other file's contents),
 * stats the open handle (the mode drives the readable-by-others warning) and reads the
 * whole file as text.
 * @param {string} path
 * @returns {Promise<{ text: string, mode: number }>}
 */
async function readSeedFileDefault(path) {
	const handle = await fsOpen(path, fsConstants.O_RDONLY | O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		const text = await handle.readFile("utf8");
		return { text, mode: stat.mode };
	} finally {
		await handle.close();
	}
}

/** The default I/O: the real streams, the real filesystem, the real clock. */
export function defaultIo() {
	return { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, readSeedFile: readSeedFileDefault, writeExclusive: writeExclusiveDefault, now: Date.now };
}

/**
 * The real exclusive writer, over `fs.open(path, "wx", 0o600)` — O_CREAT|O_EXCL with
 * mode 0600. An existing file is refused with EEXIST instead of being truncated, and so
 * is a symlink in the final path component (O_EXCL never follows one): the QR is the
 * seed in disguise, so it must never land world-readable and never clobber whatever the
 * path pointed at. With `force` an existing target is unlinked first and the exclusive
 * create runs again — the replacement is a fresh 0600 file, not an in-place overwrite.
 * @param {string} path
 * @param {string | Uint8Array} data
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<void>}
 */
async function writeExclusiveDefault(path, data, { force = false } = {}) {
	if (force) {
		try {
			await fsUnlink(path);
		} catch (err) {
			// The target being force-replaced may already be gone; anything else is real.
			if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") throw err;
		}
	}
	const handle = await fsOpen(path, "wx", 0o600);
	try {
		await handle.writeFile(data);
	} finally {
		await handle.close();
	}
}

/**
 * Whether this module was executed directly (as `node src/bin/otp.mjs`, the built
 * `bin/otp.mjs`, or an `npm` bin link), rather than imported. Both sides resolve
 * through realpath, so a symlinked bin entry still matches.
 * @returns {boolean}
 */
export function isMainScript() {
	const entry = process.argv[1];
	if (!entry) return false;
	const self = import.meta.url.replace(/[?#].*$/, "");
	if (entry === self) return true;
	try {
		return realpathSync(entry) === fileURLToPath(self);
	} catch {
		// An entry path that does not exist (or is unreadable) is not this module.
		return false;
	}
}

/**
 * Parse one subcommand's arguments. The global flags are recognized anywhere;
 * everything else must be a listed option or a positional. Option values may be
 * attached (`--digits=8`) or separate (`--digits 8`) — but a separate value may not
 * itself look like a flag (`--seed-file --json` would otherwise open a file named
 * "--json", and `--label --json` would leave the output mode and the error mode
 * disagreeing). `--` ends the options: everything after it is positional. Every usage
 * failure carries the options parsed so far, so the reporter keeps the output mode the
 * parse had actually settled on.
 * @param {string[]} argv The subcommand's arguments (without the subcommand itself).
 * @param {string[]} allowedFlags The subcommand's option names (camelCase).
 * @param {string} [usage] The usage text its errors carry (the general one when omitted).
 * @returns {{ opts: Record<string, string | boolean>, positional: string[] }}
 */
function parseArgs(argv, allowedFlags, usage) {
	/** @type {Record<string, string | boolean>} */
	const opts = {};
	const positional = [];
	/** Fail with the options parsed so far — the reporter needs them for the output mode. */
	const fail = (message) => {
		throw new UsageError(message, usage, opts);
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--json") {
			if (opts.json !== undefined) fail(`option "${arg}" given more than once`);
			opts.json = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			if (opts.help !== undefined) fail(`option "${arg}" given more than once`);
			opts.help = true;
			continue;
		}
		if (arg === "--version" || arg === "-V") {
			if (opts.version !== undefined) fail(`option "${arg}" given more than once`);
			opts.version = true;
			continue;
		}
		if (arg === "--") {
			positional.push(...argv.slice(i + 1));
			break;
		}
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			const raw = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
			const flag = FLAG_ALIASES[raw] ?? raw;
			if (!allowedFlags.includes(flag)) fail(`unknown option "--${raw}"`);
			if (opts[flag] !== undefined) fail(`option "--${raw}" given more than once`);
			if (VALUELESS_FLAGS.has(flag)) {
				if (eq !== -1) fail(`option "--${raw}" takes no value`);
				opts[flag] = true;
				continue;
			}
			if (eq !== -1) {
				opts[flag] = arg.slice(eq + 1);
				continue;
			}
			i++;
			if (i >= argv.length) fail(`option "--${raw}" needs a value`);
			if (argv[i].startsWith("--")) fail(`option "--${raw}" needs a value (a value may not start with "--")`);
			opts[flag] = argv[i];
			continue;
		}
		if (arg.startsWith("-")) fail(`unknown option "${arg}"`);
		positional.push(arg);
	}
	return { opts, positional };
}

/**
 * Validate a subcommand's positional arguments against its arity.
 * @param {string} command The subcommand name.
 * @param {string[]} positional The positional arguments.
 * @param {number[]} allowed The acceptable positional counts.
 */
function checkPositionals(command, positional, allowed) {
	if (allowed.includes(positional.length)) return;
	// The table only ever holds [0] (no positionals) or [1] (verify's single code).
	const expected = allowed.includes(0) ? "no arguments" : "exactly 1 argument";
	const got = positional.length === 0 ? "none" : `"${positional.join(" ")}"`;
	throw new UsageError(`${command} takes ${expected} (got ${got})`, COMMAND_USAGE[command]);
}

/**
 * A numeric option value, strictly: plain decimal digits only. `Number()` alone would
 * accept `"0x1e"` (30), `"6.0"` (6) and `"1e2"` (100) — spellings a config must refuse,
 * not reinterpret. Anything else becomes NaN, which the library rejects with its typed
 * `OTP_OPTIONS_INVALID` like any other bad value.
 * @param {string} value
 * @returns {number}
 */
function toNumber(value) {
	return /^\d+$/.test(value) ? Number(value) : NaN;
}

/**
 * The machine config for a subcommand, through the library's own `parseOtpOptions` —
 * the CLI can never disagree with the machine, because it never builds a config by
 * hand. Option values arrive as strings; the numeric ones are converted here and every
 * value is validated by the library (a bad value is an `OtpError`, never a clamp).
 * @param {Record<string, string | boolean>} opts The parsed options.
 * @param {{ seedBytes?: boolean }} [map] Which option names map onto which config keys.
 * @returns {import("../options.mjs").OtpMachineConfig}
 */
function configFrom(opts, map = {}) {
	/** @type {Record<string, unknown>} */
	const input = {};
	if (opts.digits !== undefined) input.digits = toNumber(opts.digits);
	if (opts.period !== undefined) input.periodSeconds = toNumber(opts.period);
	if (opts.algorithm !== undefined) input.algorithm = String(opts.algorithm).toUpperCase();
	if (opts.issuer !== undefined) input.uriIssuer = opts.issuer;
	if (opts.label !== undefined) input.uriLabel = opts.label;
	if (map.seedBytes && opts.length !== undefined) input.seedBytes = toNumber(opts.length);
	return parseOtpOptions(input);
}

/** The most bytes a seed may occupy — a seed is ~32 characters, never a megabyte. */
const SEED_MAX_BYTES = 1024;

/**
 * Collect a stream (stdin) to EOF as text, capped: more than {@link SEED_MAX_BYTES}
 * bytes is a typed error and the stream is destroyed — a seed is never a megabyte, and
 * an unbounded read would let whatever feeds stdin dictate the CLI's memory.
 * @param {import("node:stream").Readable} stream
 * @returns {Promise<string>}
 */
function readStream(stream) {
	return new Promise((resolve, reject) => {
		let text = "";
		let bytes = 0;
		stream.setEncoding("utf8");
		stream.on("data", (chunk) => {
			bytes += Buffer.byteLength(chunk);
			text += chunk;
			if (bytes > SEED_MAX_BYTES) {
				stream.destroy();
				reject(new OtpError("OTP_SEED_TOO_LARGE", `the seed is larger than ${SEED_MAX_BYTES} bytes (the 1 KiB cap)`));
			}
		});
		stream.on("end", () => resolve(text));
		stream.on("error", (err) => reject(new OtpError("OTP_STDIN_UNREADABLE", `cannot read the seed from stdin: ${err.message}`)));
	});
}

/**
 * Strip surrounding whitespace; refuse a seed over the 1 KiB cap or an empty one (a
 * usage error for the empty case — the user simply sent nothing — and a typed library
 * error for the oversized one).
 * @param {string} text
 * @param {string} usage
 * @returns {string}
 */
function cleanSeed(text, usage) {
	if (Buffer.byteLength(text, "utf8") > SEED_MAX_BYTES)
		throw new OtpError("OTP_SEED_TOO_LARGE", `the seed is larger than ${SEED_MAX_BYTES} bytes (the 1 KiB cap)`);
	const seed = text.trim();
	if (seed.length === 0) throw new UsageError("the seed is empty", usage);
	return seed;
}

/**
 * The warning for a seed file whose permission bits let group or other read it — the
 * path only, never the content. win32 permission bits carry no group/other semantics,
 * so the check is skipped there. Undefined when there is nothing to warn about.
 * @param {string} path
 * @param {number | undefined} mode The file mode from the open handle's fstat.
 * @returns {string | undefined}
 */
function seedFileWarning(path, mode) {
	if (process.platform === "win32") return undefined;
	if (typeof mode !== "number" || (mode & 0o077) === 0) return undefined;
	return `warning: the seed file is readable by group/other: ${path}`;
}

/**
 * The seed for a subcommand: from `--seed-file <path>` ("-" means stdin), else from
 * stdin — but never from a terminal, and never from the command line. Surrounding
 * whitespace is stripped; an empty result is a usage error and an oversized one a typed
 * error. A seed file readable by group/other warns (to stderr, or folded into the JSON
 * object's `warnings` array under `--json`). The seed value never appears in any error
 * message or warning.
 * @param {Record<string, string | boolean>} opts
 * @param {Partial<ReturnType<typeof defaultIo>>} io
 * @param {string} usage The subcommand's usage text (for its usage errors).
 * @returns {Promise<{ seed: string, warnings: string[] }>}
 */
async function readSeed(opts, io, usage) {
	if (opts.seedFile !== undefined && opts.seedFile !== "-") {
		const path = /** @type {string} */ (opts.seedFile);
		let text;
		let mode;
		try {
			({ text, mode } = await io.readSeedFile(path));
		} catch (err) {
			throw new OtpError("OTP_SEED_FILE_UNREADABLE", `cannot read the seed file ${path}: ${err.message}`);
		}
		/** @type {string[]} */
		const warnings = [];
		const warning = seedFileWarning(path, mode);
		if (warning !== undefined) {
			if (opts.json) warnings.push(warning);
			else io.stderr.write(`${warning}\n`);
		}
		return { seed: cleanSeed(text, usage), warnings };
	}
	if (io.stdin.isTTY) {
		throw new UsageError("no seed given: pass --seed-file <path> or pipe the seed on stdin (a terminal is never read)", usage);
	}
	return { seed: cleanSeed(await readStream(io.stdin), usage), warnings: [] };
}

/** The clock: the injectable one when the io carries it, the real one otherwise. */
function nowOf(io) {
	return io.now ? io.now() : Date.now();
}

/**
 * `otp seed` — a new seed, printed once, with its otpauth URI. The URI accompanies the
 * seed when the config carries a label (`--label`); without one there is no URI to
 * print, and the seed alone is the output (the label can be supplied later via
 * `otp uri`).
 * @returns {Promise<number>} The exit code.
 */
async function runSeed(opts, io, config) {
	const seed = newSeed({ seedBytes: config.seedBytes });
	const uri = config.uriLabel === undefined ? undefined : otpauthUri(seed, undefined, undefined, config);
	if (opts.json) {
		io.stdout.write(`${JSON.stringify(uri === undefined ? { seed } : { seed, uri })}\n`);
		return 0;
	}
	io.stdout.write(
		`OTP seed (shown once). Store it in the authenticator now; it is not shown again.\n\n  key: ${seed}\n${
			uri === undefined ? "\nRun `otp uri --label <account>` (piping this seed in) for the enrolment URI.\n" : `\n  uri: ${uri}\n`
		}`
	);
	return 0;
}

/**
 * Fold the seed-read warnings into a subcommand's JSON object — only when there are
 * any, so the documented output shapes stay exact otherwise.
 * @template T
 * @param {T} payload
 * @param {string[]} warnings
 * @returns {T | (T & { warnings: string[] })}
 */
function withWarnings(payload, warnings) {
	return warnings.length === 0 ? payload : { ...payload, warnings };
}

/**
 * `otp uri` — the otpauth URI for a seed.
 * @returns {Promise<number>} The exit code.
 */
async function runUri(opts, io, config, seed, warnings) {
	const uri = otpauthUri(seed, undefined, undefined, config);
	io.stdout.write(opts.json ? `${JSON.stringify(withWarnings({ uri }, warnings))}\n` : `${uri}\n`);
	return 0;
}

/**
 * The QR file format a `--out` path selects — a usage error for anything else. Checked
 * before the seed is read, so a bad extension fails without touching the seed at all.
 * @param {string} out
 * @returns {"png" | "svg"}
 */
function qrFormat(out) {
	const format = /\.png$/i.test(out) ? "png" : /\.svg$/i.test(out) ? "svg" : undefined;
	if (!format) throw new UsageError(`--out must be a .png or .svg file (got "${out}")`, COMMAND_USAGE.qr);
	return format;
}

/**
 * `otp qr` — the URI as a terminal QR, or a real .png / .svg file (the CLI is the only
 * place in the package allowed to touch the filesystem).
 * @returns {Promise<number>} The exit code.
 */
async function runQr(opts, io, config, seed, warnings) {
	const uri = otpauthUri(seed, undefined, undefined, config);
	if (opts.out !== undefined) {
		const out = /** @type {string} */ (opts.out);
		const format = qrFormat(out);
		const data = format === "png" ? await renderQr(uri, { format: "png-buffer" }) : await renderQr(uri, { format: "svg" });
		try {
			await io.writeExclusive(out, data, { force: opts.force === true });
		} catch (err) {
			// The exclusive create refused an existing target (EEXIST also covers a symlink
			// in the final path component — O_EXCL never follows one). Anything else is a
			// plain write failure and keeps its own error.
			if (typeof err === "object" && err !== null && err.code === "EEXIST")
				throw new OtpError("OTP_OUT_EXISTS", `--out ${out} already exists (pass --force to replace it)`);
			throw err;
		}
		io.stdout.write(opts.json ? `${JSON.stringify(withWarnings({ out, format }, warnings))}\n` : `wrote ${out}\n`);
		return 0;
	}
	// The terminal renderer may or may not end in a newline; end with exactly one.
	const qr = await renderQr(uri, { format: "terminal" });
	io.stdout.write(opts.json ? `${JSON.stringify(withWarnings({ qr }, warnings))}\n` : qr.replace(/\n?$/, "\n"));
	return 0;
}

/**
 * `otp code` — the code the seed generates right now, through the library's
 * `currentCode`: the same decode and refusals as `verifyCode`, so the CLI can never
 * display a code for a seed the verifier would refuse.
 * @returns {Promise<number>} The exit code.
 */
async function runCode(opts, io, config, seed, warnings) {
	const code = currentCode(seed, nowOf(io), config);
	io.stdout.write(opts.json ? `${JSON.stringify(withWarnings({ code }, warnings))}\n` : `${code}\n`);
	return 0;
}

/**
 * `otp verify <code>` — exit 0 when the code matches (a normal outcome), 1 when it does
 * not. A bad seed or bad options are errors instead: a broken config must never read
 * as "no match".
 * @returns {Promise<number>} The exit code.
 */
async function runVerify(opts, io, config, seed, warnings, code) {
	const valid = verifyCode(seed, code, nowOf(io), config) !== undefined;
	io.stdout.write(opts.json ? `${JSON.stringify(withWarnings({ valid }, warnings))}\n` : valid ? "valid\n" : "invalid\n");
	return valid ? 0 : 1;
}

/**
 * Dispatch one parsed command line. Returns the exit code; throws `UsageError` (exit 2)
 * or propagates library/IO errors (exit 1). Every error escaping this function carries
 * the options its command line parsed — the reporter needs them for the output mode,
 * and a `--json` swallowed as another option's value is not a mode.
 * @param {string[]} argv
 * @param {ReturnType<typeof defaultIo>} io
 * @returns {Promise<number>}
 */
async function dispatch(argv, io) {
	const first = argv[0];
	// Top level without a subcommand: only the global flags mean anything here.
	if (first === undefined || first.startsWith("-")) {
		const { opts, positional } = parseArgs(argv, []);
		if (opts.help) {
			io.stdout.write(opts.json ? `${JSON.stringify({ usage: GENERAL_USAGE })}\n` : GENERAL_USAGE);
			return 0;
		}
		if (opts.version) {
			io.stdout.write(opts.json ? `${JSON.stringify({ name, version })}\n` : `${name} v${version}\n`);
			return 0;
		}
		if (positional.length > 0)
			throw new UsageError(`flags go after the subcommand — try "otp ${positional.join(" ")} ${first}"`, undefined, opts);
		throw new UsageError("a subcommand is required: seed, uri, qr, code or verify", undefined, opts);
	}
	const flags = COMMAND_FLAGS[first];
	// No flags are known for an unknown subcommand, so a literal --json token can only
	// mean the global flag — there is nothing here it could be a value of.
	if (!flags)
		throw new UsageError(`unknown subcommand "${first}" (expected seed, uri, qr, code or verify)`, undefined, {
			json: argv.includes("--json")
		});
	const { opts, positional } = parseArgs(argv.slice(1), flags, COMMAND_USAGE[first]);
	if (opts.help) {
		io.stdout.write(opts.json ? `${JSON.stringify({ usage: COMMAND_USAGE[first] })}\n` : COMMAND_USAGE[first]);
		return 0;
	}
	if (opts.version) {
		io.stdout.write(opts.json ? `${JSON.stringify({ name, version })}\n` : `${name} v${version}\n`);
		return 0;
	}
	try {
		checkPositionals(first, positional, COMMAND_POSITIONALS[first]);
		const config = configFrom(opts, { seedBytes: first === "seed" });
		// `return await` on purpose: a bare `return promise` inside try escapes the catch
		// below (the async function awaits it after the try has already completed).
		if (first === "seed") return await runSeed(opts, io, config);
		// A bad --out extension is a usage error before the seed is read at all.
		if (first === "qr" && opts.out !== undefined) qrFormat(/** @type {string} */ (opts.out));
		// Every other subcommand needs a seed, which never comes from the command line.
		const { seed, warnings } = await readSeed(opts, io, COMMAND_USAGE[first]);
		if (first === "uri") return await runUri(opts, io, config, seed, warnings);
		if (first === "qr") return await runQr(opts, io, config, seed, warnings);
		if (first === "code") return await runCode(opts, io, config, seed, warnings);
		return await runVerify(opts, io, config, seed, warnings, /** @type {string} */ (positional[0]));
	} catch (err) {
		if (err instanceof UsageError) {
			err.opts = opts;
			throw err;
		}
		if (err instanceof OtpError) {
			err.opts = opts;
			throw err;
		}
		// An error the io threw (or a bug): normalize it so the reporter keeps the parse's
		// output mode instead of guessing from raw argv.
		const wrapped = new OtpError("OTP_CLI_ERROR", err instanceof Error ? err.message : String(err));
		wrapped.opts = opts;
		throw wrapped;
	}
}

/**
 * Run one command line to completion. Returns the exit code: 0 success, 1 a failed
 * verification or an error, 2 a usage error. Errors surface as plain text on stderr in
 * human mode and as one `{"error": {"code", "message"}}` object on stdout under
 * `--json` — the seed value never appears in either. The output mode is whatever the
 * subcommand's own parse produced: a `--json` consumed as another option's value is
 * not a mode.
 * @param {string[]} argv The command line (without the executable and script path).
 * @param {ReturnType<typeof defaultIo>} [io] Injectable I/O; the real streams, filesystem and clock when omitted.
 * @returns {Promise<number>}
 */
export async function run(argv, io = defaultIo()) {
	try {
		return await dispatch(argv, io);
	} catch (err) {
		// Every error escaping dispatch carries the options its command line parsed, and
		// dispatch normalizes anything that is not a UsageError/OtpError into an
		// OtpError("OTP_CLI_ERROR") — so the mode and the message are settled here.
		const json = err.opts?.json === true;
		if (err instanceof UsageError) {
			if (json) io.stdout.write(`${JSON.stringify({ error: { code: "OTP_USAGE", message: err.message } })}\n`);
			else io.stderr.write(`otp: ${err.message}\n\n${err.usage ?? GENERAL_USAGE}`);
			return 2;
		}
		if (json) io.stdout.write(`${JSON.stringify({ error: { code: err.code, message: err.message } })}\n`);
		else io.stderr.write(`otp: ${err.message}\n`);
		return 1;
	}
}

// The main guard: only when executed directly (never on import — importing this
// module must have no side effects).
if (isMainScript()) {
	process.exitCode = await run(process.argv.slice(2), defaultIo());
}
