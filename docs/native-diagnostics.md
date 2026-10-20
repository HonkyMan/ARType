# Native diagnostic privacy

ARType's application diagnostic events contain operational metadata and fixed
error categories. They do not contain selected text, translations, clipboard
contents, application names, endpoint URLs or credentials. Export is a manual
action; the client has no automatic diagnostic upload.

On Windows, an unhandled exception writes a bounded JSON report under
`%APPDATA%\ARType\crashes` (or the explicit isolated `TYPETIDE_DATA_DIR`).
The report contains only its format version, UTC timestamp, numeric exception
code and flags, and process/thread IDs. It contains no memory dump, stack,
registers, exception parameters, or addresses. The next startup retains the five
newest JSON reports; a new crash may temporarily produce a sixth report.
JSON event export does not silently attach crash reports.

Older clients wrote `.dmp` files containing process memory. This version does
not create, read, upload or delete those legacy files. They may remain in the
old installation's data directory. Review and remove them explicitly if needed;
do not attach unreviewed dumps to support requests.

This policy describes files written by ARType. OS-managed crash reports and
administrator-configured debugging tools have their own policies.
