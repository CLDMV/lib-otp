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

"use strict";

if (!process.features?.require_module) {
	const error = new Error(
		`@cldmv/lib-otp: require() needs Node.js ^20.19.0 or >=22.13.0 (this is ${process.version}). On older Node.js, load the package with import() instead.`
	);
	error.code = "ERR_REQUIRE_ESM";
	throw error;
}

module.exports = require("./index.mjs");
