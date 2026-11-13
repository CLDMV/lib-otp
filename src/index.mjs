/**
 *
 *	@Project: @cldmv/lib-otp
 *	@Filename: /src/index.mjs
 *	@Date: 2026-11-12T18:01:59-08:00 (1794535319)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-12T21:36:51-08:00 (1794548211)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Package manifest, read from the package root (works from `src/` and from the bundled `dist/`). */
const pkg = require("../package.json");

/** The package name, `@cldmv/lib-otp`. */
export const name = pkg.name;

/** The package version. */
export const version = pkg.version;
