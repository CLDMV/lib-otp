/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/bin.test.vitest.mjs
 *	@Date: 2026-11-12T22:04:53-08:00 (1794549893)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T23:14:32-08:00 (1794554072)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * Unit tests for the `otp` CLI (src/bin/otp.mjs), entirely through `run(argv, io)` with
 * injected I/O — no real streams, files or clock. The spawned-process tests live in
 * bin-process.test.vitest.mjs; they exercise the real scripts but do not count toward
 * coverage, which is why every branch here is reachable through the injected io.
 */

import { describe, expect, it, vi, afterAll } from "vitest";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { run, defaultIo, isMainScript } from "../src/bin/otp.mjs";
import { base32Decode, name, totpAt, version } from "../src/index.mjs";

/** A valid 20-byte base32 seed (32 characters) — never a real secret, it is a test vector. */
const SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const NOW = 1_700_000_000_000;

/**
 * An io with everything captured: `out`/`err` collect stdout/stderr writes, stdin is a
 * readable over `input`, and the clock is frozen at NOW. Overrides replace whole fields.
 */
function io({ input = "", stdin, ...overrides } = {}) {
	const out = [];
	const err = [];
	return {
		out,
		err,
		stdin: stdin ?? Readable.from([input]),
		stdout: { write: (s) => out.push(s) },
		stderr: { write: (s) => err.push(s) },
		readFile: async () => {
			throw new Error("no seed file configured");
		},
		writeExclusive: async () => {},
		now: () => NOW,
		...overrides
	};
}

const text = (chunks) => chunks.join("");

describe("otp --version / -V", () => {
	it.each([["--version"], ["-V"]])("prints the package version for %s", async (flag) => {
		const t = io();
		await expect(run([flag], t)).resolves.toBe(0);
		expect(text(t.out)).toBe(`${name} v${version}\n`);
		expect(t.err).toEqual([]);
	});

	it("prints the version after a subcommand too", async () => {
		const t = io();
		await expect(run(["code", "--version"], t)).resolves.toBe(0);
		expect(text(t.out)).toBe(`${name} v${version}\n`);
	});
});

describe("otp --help", () => {
	it.each([["--help"], ["-h"]])("prints the general usage for %s", async (flag) => {
		const t = io();
		await expect(run([flag], t)).resolves.toBe(0);
		expect(text(t.out)).toContain("Subcommands:");
		expect(text(t.out)).toContain("--seed-file <path>");
		expect(t.err).toEqual([]);
	});

	it.each([["seed"], ["uri"], ["qr"], ["code"], ["verify"]])("prints per-subcommand usage for otp %s --help", async (command) => {
		const t = io();
		await expect(run([command, "--help"], t)).resolves.toBe(0);
		expect(text(t.out)).toContain(`Usage: otp ${command}`);
	});

	it("prints per-subcommand usage for -h too", async () => {
		const t = io();
		await expect(run(["verify", "-h"], t)).resolves.toBe(0);
		expect(text(t.out)).toContain("Usage: otp verify <code>");
	});
});

describe("usage errors (exit 2)", () => {
	it("refuses to run without a subcommand", async () => {
		const t = io();
		await expect(run([], t)).resolves.toBe(2);
		expect(text(t.err)).toContain("a subcommand is required");
		expect(text(t.err)).toContain("Usage:");
	});

	it("rejects an unknown subcommand", async () => {
		const t = io();
		await expect(run(["bogus"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain('unknown subcommand "bogus"');
	});

	it("rejects an unknown option at the top level", async () => {
		const t = io();
		await expect(run(["--nope"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain('unknown option "--nope"');
	});

	it("rejects a bare top-level --json (no subcommand), as JSON on stdout", async () => {
		const t = io();
		await expect(run(["--json"], t)).resolves.toBe(2);
		expect(JSON.parse(text(t.out)).error.code).toBe("OTP_USAGE");
		expect(t.err).toEqual([]);
	});

	it.each([["--nope"], ["-x"]])("rejects the unknown option %s for a subcommand", async (flag) => {
		const t = io();
		await expect(run(["uri", flag], t)).resolves.toBe(2);
		expect(text(t.err)).toContain(`unknown option "${flag}"`);
		expect(text(t.err)).toContain("Usage: otp uri");
	});

	it("rejects an option missing its value", async () => {
		const t = io();
		await expect(run(["uri", "--label"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain('option "--label" needs a value');
		expect(text(t.err)).toContain("Usage: otp uri");
	});

	it("rejects unexpected positional arguments", async () => {
		const t = io();
		await expect(run(["seed", "extra"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain("seed takes no arguments");
		expect(text(t.err)).toContain("Usage: otp seed");
	});

	it("rejects extra positional arguments on code", async () => {
		const t = io({ input: SEED });
		await expect(run(["code", "1", "2"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain("code takes no arguments");
	});

	it("reports usage errors as JSON on stdout under --json", async () => {
		const t = io();
		await expect(run(["bogus", "--json"], t)).resolves.toBe(2);
		const parsed = JSON.parse(text(t.out));
		expect(parsed.error.code).toBe("OTP_USAGE");
		expect(typeof parsed.error.message).toBe("string");
		expect(t.err).toEqual([]);
	});
});

describe("the seed source rule", () => {
	it("reads the seed from stdin and strips surrounding whitespace", async () => {
		const t = io({ input: `  ${SEED} \n\n` });
		await expect(run(["uri", "--label", "a"], t)).resolves.toBe(0);
		expect(text(t.out)).toContain(encodeURIComponent("a"));
	});

	it("reads the seed from --seed-file", async () => {
		const t = io({ readFile: async () => `${SEED}\n` });
		await expect(run(["uri", "--seed-file", "/path/seed.txt", "--label", "a"], t)).resolves.toBe(0);
		expect(text(t.out)).toContain("otpauth://totp/");
	});

	it("reads stdin when --seed-file is -", async () => {
		const t = io({ input: SEED });
		await expect(run(["code", "--seed-file", "-"], t)).resolves.toBe(0);
		expect(text(t.out)).toMatch(/^\d{6}\n$/);
	});

	it("is a usage error when stdin is a TTY and no --seed-file is given", async () => {
		const t = io({ stdin: { isTTY: true } });
		await expect(run(["code"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain("a terminal is never read");
		expect(text(t.err)).toContain("Usage: otp code");
	});

	it("is a usage error even with --seed-file - when stdin is a TTY", async () => {
		const t = io({ stdin: { isTTY: true } });
		await expect(run(["code", "--seed-file", "-"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain("a terminal is never read");
	});

	it("is a usage error when the seed is empty after trimming", async () => {
		const t = io({ input: "  \n  " });
		await expect(run(["code"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain("the seed is empty");
	});

	it("is an error (exit 1) when the seed file cannot be read", async () => {
		const t = io({
			readFile: async () => {
				throw new Error("EACCES: permission denied");
			}
		});
		await expect(run(["verify", "123456", "--seed-file", "/secret/seed"], t)).resolves.toBe(1);
		expect(text(t.err)).toContain("cannot read the seed file /secret/seed");
		expect(text(t.err)).toContain("EACCES");
	});

	it("is an error (exit 1) when stdin cannot be read", async () => {
		const broken = new Readable({
			read() {
				this.destroy(new Error("stream died"));
			}
		});
		const t = io({ stdin: broken });
		await expect(run(["code"], t)).resolves.toBe(1);
		expect(text(t.err)).toContain("cannot read the seed from stdin");
	});

	it("never echoes the seed value in an error", async () => {
		const bad = "NOTBASE32&VALID!";
		const t = io({ input: bad });
		await expect(run(["verify", "123456"], t)).resolves.toBe(1);
		const everything = text(t.out) + text(t.err);
		expect(everything).not.toContain(bad);
		expect(everything).not.toContain(SEED);
	});

	it("never echoes the seed value when the seed file is unreadable", async () => {
		const t = io({
			readFile: async () => {
				throw new Error("denied");
			}
		});
		await expect(run(["verify", "123456", "--seed-file", "/x"], t)).resolves.toBe(1);
		const everything = text(t.out) + text(t.err);
		expect(everything).not.toContain(SEED);
	});
});

describe("otp seed", () => {
	it("prints the seed once, labeled, without a URI when no label is given", async () => {
		const t = io();
		await expect(run(["seed"], t)).resolves.toBe(0);
		const out = text(t.out);
		expect(out).toContain("shown once");
		expect(out).toMatch(/key: [A-Z2-7]{32}\n/);
		expect(out).not.toContain("uri: otpauth://");
		expect(out).toContain("otp uri --label");
	});

	it("includes the otpauth URI when --label is given", async () => {
		const t = io();
		await expect(run(["seed", "--label", "agent-1"], t)).resolves.toBe(0);
		const out = text(t.out);
		expect(out).toMatch(/key: [A-Z2-7]{32}\n/);
		expect(out).toContain("uri: otpauth://totp/gh-broker:agent-1");
	});

	it("prints {seed} as JSON, and {seed, uri} with --label", async () => {
		const bare = io();
		await expect(run(["seed", "--json"], bare)).resolves.toBe(0);
		const parsedBare = JSON.parse(text(bare.out));
		expect(Object.keys(parsedBare)).toEqual(["seed"]);
		expect(parsedBare.seed).toMatch(/^[A-Z2-7]{32}$/);

		const labeled = io();
		await expect(run(["seed", "--json", "--label", "agent-1"], labeled)).resolves.toBe(0);
		const parsed = JSON.parse(text(labeled.out));
		expect(Object.keys(parsed)).toEqual(["seed", "uri"]);
		expect(parsed.uri).toContain("algorithm=SHA1&digits=6&period=30");
	});

	it("maps --length onto the seed size in bytes (16 bytes → 26 base32 characters)", async () => {
		const t = io();
		await expect(run(["seed", "--length", "16", "--json"], t)).resolves.toBe(0);
		expect(JSON.parse(text(t.out)).seed).toMatch(/^[A-Z2-7]{26}$/);
	});

	it("accepts --length=16 in attached form", async () => {
		const t = io();
		await expect(run(["seed", "--length=16", "--json"], t)).resolves.toBe(0);
		expect(JSON.parse(text(t.out)).seed).toMatch(/^[A-Z2-7]{26}$/);
	});

	it("refuses a length below the 16-byte floor (library error, exit 1)", async () => {
		const t = io();
		await expect(run(["seed", "--length", "15", "--json"], t)).resolves.toBe(1);
		const parsed = JSON.parse(text(t.out));
		expect(parsed.error.code).toBe("OTP_OPTIONS_INVALID");
		expect(parsed.error.message).toContain("at least 16");
	});

	it("refuses a non-numeric length", async () => {
		const t = io();
		await expect(run(["seed", "--length", "abc", "--json"], t)).resolves.toBe(1);
		expect(JSON.parse(text(t.out)).error.code).toBe("OTP_OPTIONS_INVALID");
	});

	it("selects the URI algorithm with --algorithm (case-insensitively)", async () => {
		for (const algorithm of ["SHA256", "sha512"]) {
			const t = io();
			await expect(run(["seed", "--json", "--label", "a", "--algorithm", algorithm], t)).resolves.toBe(0);
			expect(JSON.parse(text(t.out)).uri).toContain(`algorithm=${algorithm.toUpperCase()}`);
		}
	});
});

describe("otp uri", () => {
	it("prints the otpauth URI with the config defaults", async () => {
		const t = io({ input: SEED });
		await expect(run(["uri", "--label", "agent-1"], t)).resolves.toBe(0);
		expect(text(t.out)).toBe(`otpauth://totp/gh-broker:agent-1?secret=${SEED}&issuer=gh-broker&algorithm=SHA1&digits=6&period=30\n`);
	});

	it("maps --issuer, --digits and --period onto the URI", async () => {
		const t = io({ input: SEED });
		await expect(run(["uri", "--label", "a", "--issuer", "My App", "--digits", "8", "--period", "60"], t)).resolves.toBe(0);
		const uri = text(t.out);
		expect(uri).toContain("issuer=My%20App");
		expect(uri).toContain("digits=8");
		expect(uri).toContain("period=60");
	});

	it("prints {uri} as JSON", async () => {
		const t = io({ input: SEED });
		await expect(run(["uri", "--label", "a", "--json"], t)).resolves.toBe(0);
		expect(JSON.parse(text(t.out)).uri).toContain("otpauth://totp/");
	});

	it("is a library error (exit 1) without --label — the URI needs an account label", async () => {
		const t = io({ input: SEED });
		await expect(run(["uri", "--json"], t)).resolves.toBe(1);
		expect(JSON.parse(text(t.out)).error.code).toBe("OTP_URI_LABEL_REQUIRED");
	});

	it("is a library error (exit 1) for a seed that is not base32", async () => {
		const t = io({ input: "not&valid" });
		await expect(run(["uri", "--label", "a", "--json"], t)).resolves.toBe(1);
		expect(JSON.parse(text(t.out)).error.code).toBe("OTP_SEED_INVALID");
		expect(text(t.out)).not.toContain("not&valid");
	});
});

describe("otp qr", () => {
	it("prints the terminal QR to stdout", async () => {
		const t = io({ input: SEED });
		await expect(run(["qr", "--label", "a"], t)).resolves.toBe(0);
		const out = text(t.out);
		expect(out).toContain("▄"); // terminal QR blocks
		expect(out).not.toContain(SEED); // the QR encodes the URI; the seed never appears as text
	});

	it("prints {qr} as JSON", async () => {
		const t = io({ input: SEED });
		await expect(run(["qr", "--label", "a", "--json"], t)).resolves.toBe(0);
		expect(Object.keys(JSON.parse(text(t.out)))).toEqual(["qr"]);
	});

	it("writes an SVG file for a .svg --out (exclusively, never forced by default)", async () => {
		const written = [];
		const t = io({ input: SEED, writeExclusive: async (path, data, opts) => written.push([path, data, opts]) });
		await expect(run(["qr", "--label", "a", "--out", "/tmp/x/qr.svg"], t)).resolves.toBe(0);
		expect(written).toEqual([["/tmp/x/qr.svg", expect.stringContaining("<svg"), { force: false }]]);
		expect(text(t.out)).toBe("wrote /tmp/x/qr.svg\n");
	});

	it("prints {out, format} as JSON for a .svg --out", async () => {
		const t = io({ input: SEED });
		await expect(run(["qr", "--label", "a", "--out", "/x/q.svg", "--json"], t)).resolves.toBe(0);
		expect(JSON.parse(text(t.out))).toEqual({ out: "/x/q.svg", format: "svg" });
	});

	it("writes a real PNG (bytes, not a data URL) for a .png --out", async () => {
		const written = [];
		const t = io({ input: SEED, writeExclusive: async (path, data) => written.push([path, data]) });
		await expect(run(["qr", "--label", "a", "--out", "/x/qr.PNG"], t)).resolves.toBe(0);
		const [path, data] = written[0];
		expect(path).toBe("/x/qr.PNG");
		expect(data).toBeInstanceOf(Uint8Array);
		expect([...data.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // \x89PNG
	});

	it("prints {out, format} as JSON for a .png --out", async () => {
		const t = io({ input: SEED });
		await expect(run(["qr", "--label", "a", "--out", "/x/q.png", "--json"], t)).resolves.toBe(0);
		expect(JSON.parse(text(t.out))).toEqual({ out: "/x/q.png", format: "png" });
	});

	it("passes force: true to the exclusive write under --force", async () => {
		const written = [];
		const t = io({ input: SEED, writeExclusive: async (path, data, opts) => written.push([path, opts]) });
		await expect(run(["qr", "--label", "a", "--out", "/x/q.svg", "--force"], t)).resolves.toBe(0);
		expect(written).toEqual([["/x/q.svg", { force: true }]]);
	});

	it("rejects an attached value on the switch --force", async () => {
		const t = io({ input: SEED });
		await expect(run(["qr", "--label", "a", "--out", "/x/q.svg", "--force=no"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain('option "--force" takes no value');
	});

	it("rejects --force on a subcommand that has no --out", async () => {
		const t = io({ input: SEED });
		await expect(run(["uri", "--force"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain('unknown option "--force"');
	});

	it("rejects a --out that is neither .png nor .svg", async () => {
		const t = io({ input: SEED });
		await expect(run(["qr", "--label", "a", "--out", "/x/qr.gif"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain("--out must be a .png or .svg file");
		expect(text(t.err)).toContain("Usage: otp qr");
	});

	it("reports an existing --out target as OTP_OUT_EXISTS (exit 1)", async () => {
		const t = io({
			input: SEED,
			writeExclusive: async () => {
				const err = new Error("EEXIST: file already exists");
				err.code = "EEXIST";
				throw err;
			}
		});
		await expect(run(["qr", "--label", "a", "--out", "/x/q.svg"], t)).resolves.toBe(1);
		expect(text(t.err)).toContain("already exists");
		expect(text(t.err)).toContain("--force");
	});

	it("reports an existing --out target as JSON with OTP_OUT_EXISTS", async () => {
		const t = io({
			input: SEED,
			writeExclusive: async () => {
				const err = new Error("EEXIST: file already exists");
				err.code = "EEXIST";
				throw err;
			}
		});
		await expect(run(["qr", "--label", "a", "--out", "/x/q.svg", "--json"], t)).resolves.toBe(1);
		const parsed = JSON.parse(text(t.out));
		expect(parsed.error.code).toBe("OTP_OUT_EXISTS");
		expect(parsed.error.message).toContain("/x/q.svg");
	});

	it("reports a failed file write as an error (exit 1)", async () => {
		const t = io({ input: SEED, writeExclusive: async () => Promise.reject(new Error("EACCES: refused")) });
		await expect(run(["qr", "--label", "a", "--out", "/x/q.svg"], t)).resolves.toBe(1);
		expect(text(t.err)).toContain("EACCES");
	});

	it("reports a failed file write as JSON with the generic CLI code", async () => {
		const t = io({ input: SEED, writeExclusive: async () => Promise.reject("boom-string") });
		await expect(run(["qr", "--label", "a", "--out", "/x/q.svg", "--json"], t)).resolves.toBe(1);
		const parsed = JSON.parse(text(t.out));
		expect(parsed.error.code).toBe("OTP_CLI_ERROR");
		expect(parsed.error.message).toBe("boom-string");
	});
});

describe("otp qr --out against the real filesystem (the default writeExclusive)", () => {
	// Real files under the repo's gitignored tmp/ (see scratch-files.md); removed again
	// in afterAll. These run through run() with defaultIo()'s real writeExclusive — only
	// the streams are captured, so stdout stays out of the test log.
	const FIXTURES = fileURLToPath(new URL("../tmp/agents/glm/otp3-fix/fs-fixtures/", import.meta.url));

	/** run() over the real filesystem: real writeExclusive, captured streams, stdin seed. */
	function realIo(input = SEED) {
		const out = [];
		const err = [];
		return {
			out,
			err,
			io: { ...defaultIo(), stdin: Readable.from([input]), stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } }
		};
	}

	afterAll(() => {
		rmSync(FIXTURES, { recursive: true, force: true });
	});

	it("creates the file with mode 0600 — the QR is the seed in disguise", async () => {
		mkdirSync(FIXTURES, { recursive: true });
		const out = `${FIXTURES}mode.png`;
		const t = realIo();
		await expect(run(["qr", "--label", "a", "--out", out], t.io)).resolves.toBe(0);
		expect(readFileSync(out).slice(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		// The create asked for 0600 and the process umask cannot add bits back.
		expect(statSync(out).mode & 0o777).toBe(0o600);
	});

	it("refuses a symlinked --out target instead of writing through it", async () => {
		mkdirSync(FIXTURES, { recursive: true });
		const victim = `${FIXTURES}victim.txt`;
		const link = `${FIXTURES}link.png`;
		writeFileSync(victim, "do not lose me");
		symlinkSync(victim, link);
		const t = realIo();
		await expect(run(["qr", "--label", "a", "--out", link], t.io)).resolves.toBe(1);
		expect(text(t.err)).toContain("already exists");
		expect(text(t.err)).toContain("--force");
		// The symlink's target is untouched — O_EXCL refused the link, it did not follow it.
		expect(readFileSync(victim, "utf8")).toBe("do not lose me");
		expect(statSync(victim).isFile()).toBe(true);
	});

	it("refuses an existing file without --force", async () => {
		mkdirSync(FIXTURES, { recursive: true });
		const out = `${FIXTURES}existing.png`;
		writeFileSync(out, "old content");
		const t = realIo();
		await expect(run(["qr", "--label", "a", "--out", out], t.io)).resolves.toBe(1);
		expect(text(t.err)).toContain("already exists");
		expect(readFileSync(out, "utf8")).toBe("old content");
	});

	it("replaces an existing file with a fresh 0600 file under --force", async () => {
		mkdirSync(FIXTURES, { recursive: true });
		const out = `${FIXTURES}forced.png`;
		writeFileSync(out, "old content");
		const t = realIo();
		await expect(run(["qr", "--label", "a", "--out", out, "--force"], t.io)).resolves.toBe(0);
		expect(readFileSync(out).slice(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		expect(statSync(out).mode & 0o777).toBe(0o600);
	});

	it("creates the file when --force names a target that does not exist yet", async () => {
		mkdirSync(FIXTURES, { recursive: true });
		const out = `${FIXTURES}forced-fresh.png`;
		const t = realIo();
		await expect(run(["qr", "--label", "a", "--out", out, "--force"], t.io)).resolves.toBe(0);
		expect(readFileSync(out).slice(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	});

	it("fails when --force cannot unlink the target (a directory is not a file)", async () => {
		mkdirSync(`${FIXTURES}dir.png`, { recursive: true });
		const t = realIo();
		await expect(run(["qr", "--label", "a", "--out", `${FIXTURES}dir.png`, "--force"], t.io)).resolves.toBe(1);
		expect(text(t.err)).toContain("otp:");
		expect(text(t.out)).toBe("");
	});
});

describe("otp code", () => {
	it("prints the current code, matching totpAt with the config defaults", async () => {
		const expected = totpAt(base32Decode(SEED), NOW, 6, "SHA1", 30);
		const t = io({ input: SEED });
		await expect(run(["code"], t)).resolves.toBe(0);
		expect(text(t.out)).toBe(`${expected}\n`);
	});

	it("maps --digits 8 --period 60 --algorithm SHA1 onto totpAt", async () => {
		const expected = totpAt(base32Decode(SEED), NOW, 8, "SHA1", 60);
		const t = io({ input: SEED });
		await expect(run(["code", "--digits", "8", "--period", "60", "--algorithm", "SHA1"], t)).resolves.toBe(0);
		expect(text(t.out)).toBe(`${expected}\n`);
	});

	it("falls back to the real clock when the io carries none", async () => {
		const t = io({ input: SEED });
		delete t.now;
		await expect(run(["code"], t)).resolves.toBe(0);
		expect(text(t.out)).toMatch(/^\d{6}\n$/);
	});

	it("prints {code} as JSON", async () => {
		const expected = totpAt(base32Decode(SEED), NOW, 6, "SHA1", 30);
		const t = io({ input: SEED });
		await expect(run(["code", "--json"], t)).resolves.toBe(0);
		expect(JSON.parse(text(t.out))).toEqual({ code: expected });
	});

	it("is a library error (exit 1) for a bad seed", async () => {
		const t = io({ input: "!!!" });
		await expect(run(["code", "--json"], t)).resolves.toBe(1);
		expect(JSON.parse(text(t.out)).error.code).toBe("OTP_SEED_INVALID");
	});
});

describe("otp verify <code>", () => {
	const codeAt = (ms, digits = 6) => totpAt(base32Decode(SEED), ms, digits, "SHA1", 30);
	// A code that cannot match at NOW: the current one, or 000000 when that IS the current one.
	const invalidCode = (() => {
		const current = codeAt(NOW);
		return current === "000000" ? "000001" : "000000";
	})();

	it("exits 0 and prints valid for a matching code", async () => {
		const t = io({ input: SEED });
		await expect(run(["verify", codeAt(NOW)], t)).resolves.toBe(0);
		expect(text(t.out)).toBe("valid\n");
	});

	it("exits 1 and prints invalid for a non-matching code — a normal outcome, not an error", async () => {
		const t = io({ input: SEED });
		await expect(run(["verify", invalidCode], t)).resolves.toBe(1);
		expect(text(t.out)).toBe("invalid\n");
		expect(t.err).toEqual([]);
	});

	it("prints {valid: true} as JSON with exit 0", async () => {
		const t = io({ input: SEED });
		await expect(run(["verify", codeAt(NOW), "--json"], t)).resolves.toBe(0);
		expect(JSON.parse(text(t.out))).toEqual({ valid: true });
	});

	it("prints {valid: false} as JSON with exit 1", async () => {
		const t = io({ input: SEED });
		await expect(run(["verify", invalidCode, "--json"], t)).resolves.toBe(1);
		expect(JSON.parse(text(t.out))).toEqual({ valid: false });
	});

	it("treats a malformed code as a normal non-match (exit 1)", async () => {
		const t = io({ input: SEED });
		await expect(run(["verify", "12ab"], t)).resolves.toBe(1);
		expect(text(t.out)).toBe("invalid\n");
	});

	it("honors --digits: a 6-digit code does not verify against an 8-digit config", async () => {
		const t = io({ input: SEED });
		await expect(run(["verify", codeAt(NOW), "--digits", "8"], t)).resolves.toBe(1);
		expect(text(t.out)).toBe("invalid\n");
	});

	it("verifies an 8-digit code when --digits 8 is configured", async () => {
		const t = io({ input: SEED });
		await expect(run(["verify", codeAt(NOW, 8), "--digits", "8"], t)).resolves.toBe(0);
	});

	it("is a usage error without the code argument", async () => {
		const t = io({ input: SEED });
		await expect(run(["verify"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain("verify takes exactly 1 argument");
	});

	it("is a usage error with more than one code argument", async () => {
		const t = io({ input: SEED });
		await expect(run(["verify", "123456", "654321"], t)).resolves.toBe(2);
		expect(text(t.err)).toContain("verify takes exactly 1 argument");
	});

	it("is a library error (exit 1) for a bad seed — a broken config never reads as no-match", async () => {
		const t = io({ input: "!!!" });
		await expect(run(["verify", "123456", "--json"], t)).resolves.toBe(1);
		expect(JSON.parse(text(t.out)).error.code).toBe("OTP_SEED_INVALID");
		expect(text(t.out)).not.toContain('"valid"');
	});
});

describe("the io surface", () => {
	it("defaultIo() wires the real streams, filesystem and clock", () => {
		const real = defaultIo();
		expect(real.stdin).toBe(process.stdin);
		expect(real.stdout).toBe(process.stdout);
		expect(real.stderr).toBe(process.stderr);
		expect(real.now).toBe(Date.now);
		expect(typeof real.readFile).toBe("function");
		expect(typeof real.writeExclusive).toBe("function");
	});

	it("run() falls back to the real io when none is injected (default parameter)", async () => {
		const writes = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});
		try {
			await expect(run(["--version"])).resolves.toBe(0);
		} finally {
			spy.mockRestore();
		}
		expect(writes.join("")).toBe(`${name} v${version}\n`);
	});
});

describe("isMainScript / the main guard", () => {
	const binPath = new URL("../src/bin/otp.mjs", import.meta.url).pathname;

	it("is false under the test runner (imported, not executed)", () => {
		expect(isMainScript()).toBe(false);
	});

	it("is false without a process.argv[1]", () => {
		const real = process.argv[1];
		try {
			process.argv[1] = undefined;
			expect(isMainScript()).toBe(false);
		} finally {
			process.argv[1] = real;
		}
	});

	it("is false for an entry path that does not exist", () => {
		const real = process.argv[1];
		try {
			process.argv[1] = "/definitely/not/a/real/path.mjs";
			expect(isMainScript()).toBe(false);
		} finally {
			process.argv[1] = real;
		}
	});

	it("is true for the module's own path and its file URL", () => {
		const real = process.argv[1];
		try {
			process.argv[1] = binPath;
			expect(isMainScript()).toBe(true);
			process.argv[1] = pathToFileURL(binPath).href;
			expect(isMainScript()).toBe(true);
		} finally {
			process.argv[1] = real;
		}
	});

	it("imports with no side effects (the guard does not fire for an import)", async () => {
		const writes = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});
		try {
			// A query on the URL gives this import a fresh module identity (so the guard
			// really runs) — loaded natively by Node, hence the @vite-ignore.
			const url = `${pathToFileURL(binPath).href}?imported=${Date.now()}`;
			await import(/* @vite-ignore */ url);
		} finally {
			spy.mockRestore();
		}
		expect(writes).toEqual([]);
	});

	it("runs when executed directly: patching argv[1] to the module path fires the guard", async () => {
		const realArgv = process.argv;
		const realExitCode = process.exitCode;
		const writes = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});
		try {
			process.argv = [process.argv[0], binPath, "--version"];
			const url = `${pathToFileURL(binPath).href}?main=${Date.now()}`;
			await import(/* @vite-ignore */ url);
			expect(writes.join("")).toBe(`${name} v${version}\n`);
			expect(process.exitCode).toBe(0);
		} finally {
			spy.mockRestore();
			process.argv = realArgv;
			process.exitCode = realExitCode;
		}
	});
});
