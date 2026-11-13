/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/index.mjs
 *	@Date: 2026-11-12T18:01:59-08:00 (1794535319)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T23:15:06-08:00 (1794554106)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @cldmv/lib-otp — the whole public API: pure RFC 6238/4648 TOTP, the per-person
 * lockout machine, seed/enrolment helpers and the status formatters. The package is
 * ESM-only at source with a thin CJS shim; everything is plain functions over injected
 * inputs (no env, no filesystem, no clock, no module state).
 */

/**
 * Package manifest, imported statically (works from `src/` and, inlined, from the
 * bundled `dist/`). A default import on purpose: Node's ESM JSON modules expose only a
 * default export — named imports from JSON (`import { name } from "../package.json"`)
 * are a bundler feature (vite/esbuild), so they throw a SyntaxError on any plain-Node
 * load of this file (the `lib-otp-dev` condition, `require(esm)`). The cost is that the
 * bundled dist inlines the whole manifest, scripts and all — harmless for a ~1 kB file.
 */
import pkg from "../package.json" with { type: "json" };

/** The package name, `@cldmv/lib-otp`. */
export const name = pkg.name;

/** The package version. */
export const version = pkg.version;

export { OtpError } from "./errors.mjs";

export { STEP_SECONDS, base32Encode, base32Decode, hotp, stepAt, totpAt, safeEqual, matchStep } from "./totp.mjs";

export { DEFAULTS, parseOtpOptions, isOtpMachineConfig } from "./options.mjs";

export { emptyPerson, isPersonState, stepOtp, lockStatus, spendThrough, compactPerson } from "./machine.mjs";

export { verifyCode, currentCode, newSeed, otpauthUri, renderQr } from "./enrol.mjs";

export { describeUser, describeUsers, formatStatus } from "./status.mjs";
