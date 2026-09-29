# Third-party and donor notices

The FBS BookWriter donor trees reviewed during development declare the MIT License and copyright 悟空共创. The 26.9.10 package contains adapted donor runtime code in its manuscript governance utilities, including quality auditing, chapter merge/status support, final-draft support, release planning, and the legacy scene-pack compatibility entrypoint. Those adaptations remain subject to the donor MIT notice where applicable.

The package-local module exposed as `glob` is an original, dependency-free compatibility subset written for this package. It is not a bundled copy of the npm `glob` package and does not claim full npm `glob` API compatibility.

The retained path `scripts/wecom/scene-pack-loader.mjs` is a compatibility import path only. Its packaged implementation reads the local scene catalog, performs no WeCom network action, and introduces no additional host dependency. This release targets WorkBuddy only.

No donor user configuration, enterprise configuration, entitlement ledger, runtime state, credential, private prompt, or remote scene-pack cache is included.

Development research also examined InkOS 1.8.0, repository https://github.com/Narcooo/inkos at commit 091048383f411eb99948a8764f42b6fd13006f9b, whose core package declares AGPL-3.0-only. The research checkout, its dependencies, prompts and assets are not included in this expert package. The chapter workflow and SQLite snapshot utilities were independently implemented against this project's methodology-v3 contracts. InkOS informed the engineering comparison of bounded context, review failure handling and state recovery; no InkOS source code or runtime dependency is incorporated by this change. This notice describes the integration performed, not a legal opinion about future reuse.
