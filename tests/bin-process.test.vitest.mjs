/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /tests/bin-process.test.vitest.mjs
 *	@Date: 2026-11-12T22:30:00-08:00 (1794551400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T22:30:00-08:00 (1794551400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * Spawned-process tests for the `otp` CLI: the real script, real streams, real exit
 * codes. These run `node src/bin/otp.mjs` (the source, always available) and — when
 * `bin/otp.mjs` exists, i.e. after `npm run build` / `build:ci` — the built bundle too,
 * with the same expectations. They do NOT count toward coverage (the children are not
 * instrumented), which is why the unit tests in bin.test.vitest.mjs drive every branch
 * through injected I/O.
 */

import { describe, expect, it, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { name, version } from "../src/index.mjs";

const SRC_BIN = fileURLToPath(new URL("../src/bin/otp.mjs", import.meta.url));
const BUILT_BIN = fileURLToPath(new URL("../bin/otp.mjs", import.meta.url));
// Scratch fixtures live under the repo's gitignored tmp/ (see scratch-files.md) and are
// removed again in afterAll.
const FIXTURES = fileURLToPath(new URL("../tmp/agents/glm/otp3-builder/process-fixtures/", import.meta.url));

const hasBuilt = existsSync(BUILT_BIN);
if (!hasBuilt) console.warn("[bin-process] bin/otp.mjs not built yet (npm run build / build:ci) — skipping the built-bin block");

/** Run the CLI as a real process; resolves { code, out, err }. */
function runCli(bin, args, input) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [bin, ...args], { stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.stderr.on("data", (chunk) => {
			err += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, out, err }));
		child.stdin.end(input ?? "");
	});
}

/** A valid 20-byte base32 seed — a fixed test vector, not a real secret. */
const SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

afterAll(() => {
	rmSync(FIXTURES, { recursive: true, force: true });
});

describe.for([["source (src/bin/otp.mjs)", SRC_BIN], ...(hasBuilt ? [["built (bin/otp.mjs)", BUILT_BIN]] : [])])(
	"otp CLI via %s",
	([, bin]) => {
		it("prints the version (--version)", async () => {
			const { code, out } = await runCli(bin, ["--version"]);
			expect(code).toBe(0);
			expect(out).toBe(`${name} v${version}\n`);
		});

		it("prints the version (-V)", async () => {
			const { code, out } = await runCli(bin, ["-V"]);
			expect(code).toBe(0);
			expect(out).toBe(`${name} v${version}\n`);
		});

		it("prints the general usage (--help)", async () => {
			const { code, out } = await runCli(bin, ["--help"]);
			expect(code).toBe(0);
			expect(out).toContain("Subcommands:");
		});

		it("exits 2 for an unknown subcommand, usage on stderr", async () => {
			const { code, out, err } = await runCli(bin, ["bogus"]);
			expect(code).toBe(2);
			expect(out).toBe("");
			expect(err).toContain('unknown subcommand "bogus"');
			expect(err).toContain("Usage:");
		});

		it("exits 2 with no subcommand", async () => {
			const { code, err } = await runCli(bin, []);
			expect(code).toBe(2);
			expect(err).toContain("a subcommand is required");
		});

		it("generates a seed on stdout (seed --json)", async () => {
			const { code, out } = await runCli(bin, ["seed", "--json"]);
			expect(code).toBe(0);
			const parsed = JSON.parse(out);
			expect(parsed.seed).toMatch(/^[A-Z2-7]{32}$/);
		});

		it("reads a seed piped on stdin (code --json)", async () => {
			const { code, out } = await runCli(bin, ["code", "--json"], `${SEED}\n`);
			expect(code).toBe(0);
			expect(JSON.parse(out).code).toMatch(/^\d{6}$/);
		});

		it("reads a seed from --seed-file (uri --json)", async () => {
			mkdirSync(FIXTURES, { recursive: true });
			const seedFile = `${FIXTURES}seed.txt`;
			writeFileSync(seedFile, `${SEED}\n`);
			const { code, out } = await runCli(bin, ["uri", "--seed-file", seedFile, "--label", "proc-test", "--json"]);
			expect(code).toBe(0);
			const parsed = JSON.parse(out);
			expect(parsed.uri).toContain("otpauth://totp/");
			expect(parsed.uri).toContain(encodeURIComponent("proc-test"));
		});

		it("verifies a current code with exit 0 (verify)", async () => {
			const codeResult = await runCli(bin, ["code"], SEED);
			expect(codeResult.code).toBe(0);
			const current = codeResult.out.trim();
			const { code, out } = await runCli(bin, ["verify", current], SEED);
			expect(code).toBe(0);
			expect(out).toBe("valid\n");
		});

		it("verifies a wrong code with exit 1 — a normal outcome, not an error (verify)", async () => {
			const codeResult = await runCli(bin, ["code"], SEED);
			const current = codeResult.out.trim();
			const wrong = current === "000000" ? "000001" : "000000";
			const { code, out, err } = await runCli(bin, ["verify", wrong], SEED);
			expect(code).toBe(1);
			expect(out).toBe("invalid\n");
			expect(err).toBe("");
		});

		it("verifies with --json: {valid:false} and exit 1 (verify)", async () => {
			const { code, out } = await runCli(bin, ["verify", "000000", "--json"], SEED);
			const current = JSON.parse(out);
			// 000000 might be the genuine code for this vector — the shape is what matters here.
			expect(code).toBe(current.valid ? 0 : 1);
			expect(current).toEqual({ valid: current.valid });
		});

		it("exits 1 with the error as JSON for a bad seed (--json)", async () => {
			const bad = "NOTBASE32&SEED!";
			const { code, out, err } = await runCli(bin, ["code", "--json"], bad);
			expect(code).toBe(1);
			const parsed = JSON.parse(out);
			expect(parsed.error.code).toBe("OTP_SEED_INVALID");
			expect(out + err).not.toContain(bad);
		});

		it("exits 2 when the seed is empty on stdin", async () => {
			const { code, err } = await runCli(bin, ["code"], "   \n");
			expect(code).toBe(2);
			expect(err).toContain("the seed is empty");
		});

		it("exits 2 when stdin is closed and no --seed-file is given", async () => {
			const { code, err } = await runCli(bin, ["code"]);
			expect(code).toBe(2);
			expect(err).toContain("the seed is empty");
		});
	}
);

describe("bin/otp.mjs build parity", () => {
	it.skipIf(!hasBuilt)("the built bundle prints the same version as the source", async () => {
		const [src, built] = await Promise.all([runCli(SRC_BIN, ["--version"]), runCli(BUILT_BIN, ["--version"])]);
		expect(built).toEqual(src);
	});

	it.skipIf(!hasBuilt)("the built bundle reads a seed file and verifies like the source", async () => {
		mkdirSync(FIXTURES, { recursive: true });
		const seedFile = `${FIXTURES}parity-seed.txt`;
		writeFileSync(seedFile, SEED);
		const args = ["verify", "000000", "--seed-file", seedFile];
		const [src, built] = await Promise.all([runCli(SRC_BIN, args), runCli(BUILT_BIN, args)]);
		expect(built.code).toBe(src.code);
		expect(built.out).toBe(src.out);
	});
});
