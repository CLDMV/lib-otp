/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/index.mjs
 *	@Date: 2026-11-12T18:01:59-08:00 (1794535319)
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
 * @cldmv/lib-otp — the whole public API: pure RFC 6238/4648 TOTP, the per-person
 * lockout machine, seed/enrolment helpers and the status formatters. The package is
 * ESM-only at source with a thin CJS shim; everything is plain functions over injected
 * inputs (no env, no filesystem, no clock, no module state).
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Package manifest, read from the package root (works from `src/` and from the bundled `dist/`). */
const pkg = require("../package.json");

/** The package name, `@cldmv/lib-otp`. */
export const name = pkg.name;

/** The package version. */
export const version = pkg.version;

export { OtpError } from "./errors.mjs";

export { STEP_SECONDS, base32Encode, base32Decode, hotp, stepAt, totpAt, safeEqual, matchStep } from "./totp.mjs";

export { DEFAULTS, parseOtpOptions, isOtpMachineConfig } from "./options.mjs";

export { emptyPerson, isPersonState, stepOtp, lockStatus, spendThrough, compactPerson } from "./machine.mjs";

export { verifyCode, newSeed, otpauthUri, renderQr } from "./enrol.mjs";

export { describeUser, describeUsers, formatStatus } from "./status.mjs";
