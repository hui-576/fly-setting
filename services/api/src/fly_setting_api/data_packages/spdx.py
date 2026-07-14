from __future__ import annotations

import re

# Auditable allowlist reviewed against the SPDX License List 3.26.
#
# Data packages accept a single license identifier, not an SPDX expression.  The
# subset below deliberately covers the licenses normally encountered in source
# code, open data, maps and government data.  Adding an identifier requires a
# source review against https://spdx.org/licenses/ and a code change; an
# arbitrary manifest value can therefore never become trusted implicitly.
SPDX_LICENSE_LIST_VERSION = "3.26"

SPDX_LICENSE_IDS = frozenset(
    {
        "0BSD",
        "AFL-3.0",
        "AGPL-3.0-only",
        "AGPL-3.0-or-later",
        "Apache-1.1",
        "Apache-2.0",
        "Artistic-2.0",
        "BSD-2-Clause",
        "BSD-2-Clause-Patent",
        "BSD-3-Clause",
        "BSD-3-Clause-Clear",
        "BSL-1.0",
        "CC-BY-3.0",
        "CC-BY-4.0",
        "CC-BY-SA-3.0",
        "CC-BY-SA-4.0",
        "CC0-1.0",
        "CDDL-1.0",
        "CDDL-1.1",
        "EPL-1.0",
        "EPL-2.0",
        "EUPL-1.1",
        "EUPL-1.2",
        "GPL-2.0-only",
        "GPL-2.0-or-later",
        "GPL-3.0-only",
        "GPL-3.0-or-later",
        "ISC",
        "LGPL-2.1-only",
        "LGPL-2.1-or-later",
        "LGPL-3.0-only",
        "LGPL-3.0-or-later",
        "MIT",
        "MIT-0",
        "MPL-2.0",
        "MS-PL",
        "NCSA",
        "ODbL-1.0",
        "OFL-1.1",
        "OGL-UK-1.0",
        "OGL-UK-2.0",
        "OGL-UK-3.0",
        "PDDL-1.0",
        "PostgreSQL",
        "Unlicense",
        "UPL-1.0",
        "WTFPL",
        "Zlib",
    }
)

_LICENSE_REF_PATTERN = re.compile(r"^LicenseRef-[A-Za-z0-9][A-Za-z0-9.-]{0,78}$")


def is_spdx_license_id(value: str) -> bool:
    """Return whether *value* is an explicitly reviewed SPDX license ID."""

    return value in SPDX_LICENSE_IDS


def is_license_ref(value: str) -> bool:
    """Return whether *value* is a package-local SPDX custom license reference."""

    return _LICENSE_REF_PATTERN.fullmatch(value) is not None
