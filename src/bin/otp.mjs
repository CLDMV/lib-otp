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
 *	@Last modified time: 2026-11-12T22:55:57-08:00 (1794552957)
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
 * stdin. A terminal on stdin is never read — that is a usage error, not a prompt.
 *
 * Everything is built for testing: `run(argv, io)` returns the exit code and takes an
 * injectable I/O object (streams, file readers/writers, the clock), and the module has
 * no side effects on import — the main guard at the bottom only fires when the file is
 * executed directly (`node bin/otp.mjs`, `node src/bin/otp.mjs` or the installed `otp`).
 */

import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OtpError } from "../errors.mjs";
import { name, parseOtpOptions, version } from "../index.mjs";
import { base32Decode, totpAt } from "../totp.mjs";
import { newSeed, otpauthUri, renderQr, verifyCode } from "../enrol.mjs";

/**
 * A usage error: bad subcommand, unknown option, a missing seed source. Always exit 2.
 * Carries the usage text to print after the message (the general usage when omitted).
 */
class UsageError extends Error {
	/**
	 * @param {string} message What was wrong with the command line.
	 * @param {string} [usage] The usage text to print (per subcommand when the error
	 *   belongs to one; the general usage when omitted).
	 */
	constructor(message, usage) {
		super(message);
		this.usage = usage;
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
  with no --seed-file and a TTY on stdin, that is a usage error.

Global options:
  --json          One JSON object on stdout (errors too, with a nonzero exit).
  --help, -h      This usage; per subcommand: otp <subcommand> --help.
  --version, -V   Print the package version.

Exit codes:
  0  success
  1  the code did not verify, or an error (bad seed, unreadable file, bad option value)
  2  usage error (unknown subcommand or option, missing seed source, empty seed)
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
	qr: ["label", "issuer", "digits", "period", "algorithm", "seedFile", "out"],
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

/** The default I/O: the real streams, the real filesystem, the real clock. */
export function defaultIo() {
	return { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, readFile: fsReadFile, writeFile: fsWriteFile, now: Date.now };
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
 * attached (`--digits=8`) or separate (`--digits 8`).
 * @param {string[]} argv The subcommand's arguments (without the subcommand itself).
 * @param {string[]} allowedFlags The subcommand's option names (camelCase).
 * @param {string} [usage] The usage text its errors carry (the general one when omitted).
 * @returns {{ opts: Record<string, string | boolean>, positional: string[] }}
 */
function parseArgs(argv, allowedFlags, usage) {
	/** @type {Record<string, string | boolean>} */
	const opts = {};
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--json") {
			opts.json = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			opts.help = true;
			continue;
		}
		if (arg === "--version" || arg === "-V") {
			opts.version = true;
			continue;
		}
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			const raw = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
			const flag = FLAG_ALIASES[raw] ?? raw;
			if (!allowedFlags.includes(flag)) throw new UsageError(`unknown option "--${raw}"`, usage);
			if (eq !== -1) {
				opts[flag] = arg.slice(eq + 1);
				continue;
			}
			i++;
			if (i >= argv.length) throw new UsageError(`option "--${raw}" needs a value`, usage);
			opts[flag] = argv[i];
			continue;
		}
		if (arg.startsWith("-")) throw new UsageError(`unknown option "${arg}"`, usage);
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
	if (opts.digits !== undefined) input.digits = Number(opts.digits);
	if (opts.period !== undefined) input.periodSeconds = Number(opts.period);
	if (opts.algorithm !== undefined) input.algorithm = String(opts.algorithm).toUpperCase();
	if (opts.issuer !== undefined) input.uriIssuer = opts.issuer;
	if (opts.label !== undefined) input.uriLabel = opts.label;
	if (map.seedBytes && opts.length !== undefined) input.seedBytes = Number(opts.length);
	return parseOtpOptions(input);
}

/**
 * Collect a stream (stdin) to EOF as text.
 * @param {import("node:stream").Readable} stream
 * @returns {Promise<string>}
 */
function readStream(stream) {
	return new Promise((resolve, reject) => {
		let text = "";
		stream.setEncoding("utf8");
		stream.on("data", (chunk) => {
			text += chunk;
		});
		stream.on("end", () => resolve(text));
		stream.on("error", (err) => reject(new OtpError("OTP_STDIN_UNREADABLE", `cannot read the seed from stdin: ${err.message}`)));
	});
}

/** Strip surrounding whitespace; refuse an empty seed (a usage error, not a library one). */
function cleanSeed(text, usage) {
	const seed = text.trim();
	if (seed.length === 0) throw new UsageError("the seed is empty", usage);
	return seed;
}

/**
 * The seed for a subcommand: from `--seed-file <path>` ("-" means stdin), else from
 * stdin — but never from a terminal, and never from the command line. Surrounding
 * whitespace is stripped; an empty result is a usage error. The seed value never
 * appears in any error message.
 * @param {Record<string, string | boolean>} opts
 * @param {Partial<ReturnType<typeof defaultIo>>} io
 * @param {string} usage The subcommand's usage text (for its usage errors).
 * @returns {Promise<string>}
 */
async function readSeed(opts, io, usage) {
	if (opts.seedFile !== undefined && opts.seedFile !== "-") {
		const path = /** @type {string} */ (opts.seedFile);
		let text;
		try {
			text = await io.readFile(path, "utf8");
		} catch (err) {
			throw new OtpError("OTP_SEED_FILE_UNREADABLE", `cannot read the seed file ${path}: ${err.message}`);
		}
		return cleanSeed(text, usage);
	}
	if (io.stdin.isTTY) {
		throw new UsageError("no seed given: pass --seed-file <path> or pipe the seed on stdin (a terminal is never read)", usage);
	}
	return cleanSeed(await readStream(io.stdin), usage);
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
 * `otp uri` — the otpauth URI for a seed.
 * @returns {Promise<number>} The exit code.
 */
async function runUri(opts, io, config, seed) {
	const uri = otpauthUri(seed, undefined, undefined, config);
	io.stdout.write(opts.json ? `${JSON.stringify({ uri })}\n` : `${uri}\n`);
	return 0;
}

/**
 * `otp qr` — the URI as a terminal QR, or a real .png / .svg file (the CLI is the only
 * place in the package allowed to touch the filesystem).
 * @returns {Promise<number>} The exit code.
 */
async function runQr(opts, io, config, seed) {
	const uri = otpauthUri(seed, undefined, undefined, config);
	if (opts.out !== undefined) {
		const out = /** @type {string} */ (opts.out);
		const format = /\.png$/i.test(out) ? "png" : /\.svg$/i.test(out) ? "svg" : undefined;
		if (!format) throw new UsageError(`--out must be a .png or .svg file (got "${out}")`, COMMAND_USAGE.qr);
		if (format === "png") await io.writeFile(out, await renderQr(uri, { format: "png-buffer" }));
		else await io.writeFile(out, await renderQr(uri, { format: "svg" }));
		io.stdout.write(opts.json ? `${JSON.stringify({ out, format })}\n` : `wrote ${out}\n`);
		return 0;
	}
	// The terminal renderer may or may not end in a newline; end with exactly one.
	const qr = await renderQr(uri, { format: "terminal" });
	io.stdout.write(opts.json ? `${JSON.stringify({ qr })}\n` : qr.replace(/\n?$/, "\n"));
	return 0;
}

/**
 * `otp code` — the code the seed generates right now.
 * @returns {Promise<number>} The exit code.
 */
async function runCode(opts, io, config, seed) {
	let key;
	try {
		key = base32Decode(seed);
	} catch (err) {
		// The only thrower is the library's base32Decode, whose message names the problem
		// ("base32: invalid character") and never the seed itself.
		throw new OtpError("OTP_SEED_INVALID", `the seed is not valid base32: ${err.message}`);
	}
	const code = totpAt(key, nowOf(io), config.digits, config.algorithm, config.periodSeconds);
	io.stdout.write(opts.json ? `${JSON.stringify({ code })}\n` : `${code}\n`);
	return 0;
}

/**
 * `otp verify <code>` — exit 0 when the code matches (a normal outcome), 1 when it does
 * not. A bad seed or bad options are errors instead: a broken config must never read
 * as "no match".
 * @returns {Promise<number>} The exit code.
 */
async function runVerify(opts, io, config, seed, code) {
	const valid = verifyCode(seed, code, nowOf(io), config) !== undefined;
	io.stdout.write(opts.json ? `${JSON.stringify({ valid })}\n` : valid ? "valid\n" : "invalid\n");
	return valid ? 0 : 1;
}

/**
 * Dispatch one parsed command line. Returns the exit code; throws `UsageError` (exit 2)
 * or propagates library/IO errors (exit 1).
 * @param {string[]} argv
 * @param {ReturnType<typeof defaultIo>} io
 * @returns {Promise<number>}
 */
async function dispatch(argv, io) {
	const first = argv[0];
	// Top level without a subcommand: only the global flags mean anything here.
	if (first === undefined || first.startsWith("-")) {
		const globals = parseArgs(argv, []);
		if (globals.opts.help) {
			io.stdout.write(GENERAL_USAGE);
			return 0;
		}
		if (globals.opts.version) {
			io.stdout.write(`${name} v${version}\n`);
			return 0;
		}
		throw new UsageError(first === undefined ? "a subcommand is required: seed, uri, qr, code or verify" : `unknown subcommand "${first}"`);
	}
	const flags = COMMAND_FLAGS[first];
	if (!flags) throw new UsageError(`unknown subcommand "${first}" (expected seed, uri, qr, code or verify)`);
	const { opts, positional } = parseArgs(argv.slice(1), flags, COMMAND_USAGE[first]);
	if (opts.help) {
		io.stdout.write(COMMAND_USAGE[first]);
		return 0;
	}
	if (opts.version) {
		io.stdout.write(`${name} v${version}\n`);
		return 0;
	}
	checkPositionals(first, positional, COMMAND_POSITIONALS[first]);
	const config = configFrom(opts, { seedBytes: first === "seed" });
	if (first === "seed") return runSeed(opts, io, config);
	// Every other subcommand needs a seed, which never comes from the command line.
	const seed = await readSeed(opts, io, COMMAND_USAGE[first]);
	if (first === "uri") return runUri(opts, io, config, seed);
	if (first === "qr") return runQr(opts, io, config, seed);
	if (first === "code") return runCode(opts, io, config, seed);
	return runVerify(opts, io, config, seed, /** @type {string} */ (positional[0]));
}

/**
 * Run one command line to completion. Returns the exit code: 0 success, 1 a failed
 * verification or an error, 2 a usage error. Errors surface as plain text on stderr in
 * human mode and as one `{"error": {"code", "message"}}` object on stdout under
 * `--json` — the seed value never appears in either.
 * @param {string[]} argv The command line (without the executable and script path).
 * @param {ReturnType<typeof defaultIo>} [io] Injectable I/O; the real streams, filesystem and clock when omitted.
 * @returns {Promise<number>}
 */
export async function run(argv, io = defaultIo()) {
	const json = argv.includes("--json");
	try {
		return await dispatch(argv, io);
	} catch (err) {
		if (err instanceof UsageError) {
			if (json) io.stdout.write(`${JSON.stringify({ error: { code: "OTP_USAGE", message: err.message } })}\n`);
			else io.stderr.write(`otp: ${err.message}\n\n${err.usage ?? GENERAL_USAGE}`);
			return 2;
		}
		const code = err instanceof OtpError ? err.code : "OTP_CLI_ERROR";
		const message = err instanceof Error ? err.message : String(err);
		if (json) io.stdout.write(`${JSON.stringify({ error: { code, message } })}\n`);
		else io.stderr.write(`otp: ${message}\n`);
		return 1;
	}
}

// The main guard: only when executed directly (never on import — importing this
// module must have no side effects).
if (isMainScript()) {
	process.exitCode = await run(process.argv.slice(2), defaultIo());
}
