# DarkWhispers — Semgrep review

Release: launcher 0.1.2 and the website, 20 October 2026.

The complete, unfiltered Semgrep Community Edition JSON is linked as
[semgrep-report.json](semgrep-report.json). No findings were suppressed.
The release summary includes the exact hashes of the scanned source files.

One API-usage audit note remains:

- Rule: python.lang.security.audit.httpsconnection-detected.httpsconnection-detected
- File: website/tools/verify-deployment.py
- The rule asks the reviewer to check HTTPSConnection security, particularly
  Python versions before 3.4.3 which did not validate certificates by default.
- The production verifier runs on Python 3.12.3. It explicitly passes
  ssl.create_default_context(), which verifies certificates and hostnames.
  It connects only to the fixed darkwhispers.akion.se HTTPS host, encodes
  relative paths, does not follow redirects, and cannot open file URLs.
- Assessment by the development assistant: reviewed API-usage note; no exploitable
  issue identified in this use on the supported runtime. This does not change
  the original scanner result or claim that the complete program is bug-free.

The first scan also flagged three dynamic urllib calls. Those calls were replaced
with the fixed-origin HTTPS client before the final scan.

Rules used: p/security-audit and p/secrets, with telemetry disabled and no
Semgrep account. Community Edition coverage depends on language and rules;
it is not a complete Rust audit or whole-program security analysis.
Rust dependencies and critical Rust installation paths are covered separately
by RustSec, manual review and tests.

References:

- [Python HTTPSConnection certificate verification](https://docs.python.org/3/library/http.client.html#http.client.HTTPSConnection)
- [Semgrep Community Edition scope and limitations](https://github.com/semgrep/semgrep)
