/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/index.cjs
 *	@Date: 2026-11-12T18:02:01-08:00 (1794535321)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T21:36:51-08:00 (1794548211)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * CommonJS entry point: the generic CLDMV shim over the ESM build.
 *
 * The package exports many distinct values, so `require("@cldmv/lib-otp")` returns the module object
 * (`{ stepOtp, hotp, verifyCode, ... }`), with every export `import` sees.
 *
 * @module @cldmv/lib-otp
 */
"use strict";

if (!process.features?.require_module) {
	const error = new Error(
		`@cldmv/lib-otp: require() needs Node.js ^20.19.0 or >=22.13.0 (this is ${process.version}). On older Node.js, load the package with import() instead.`
	);
	error.code = "ERR_REQUIRE_ESM";
	throw error;
}

// Same exports as `import`. One distinct exported value (aliases of it count once) comes back as that value,
// so require(x)(...) works; anything else comes back as the module object ({ default, ...named }).
const esm = require("./index.mjs");
const values = new Set(
	Object.keys(esm)
		.filter((key) => key !== "__esModule")
		.map((key) => esm[key])
);
module.exports = values.size === 1 ? values.values().next().value : esm;
