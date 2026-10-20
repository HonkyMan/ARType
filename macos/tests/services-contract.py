"""Verify the Services declaration agrees with its asynchronous popup delivery."""
import pathlib
import plistlib

root = pathlib.Path(__file__).resolve().parents[1]
with (root / "TypeTide" / "Info.plist").open("rb") as source:
    services = plistlib.load(source)["NSServices"]
action = next(service for service in services if service["NSMessage"] == "translateSelection")
assert action["NSSendTypes"]
assert not action.get("NSReturnTypes"), "Async popup service must not promise a synchronous pasteboard result"
print("Services manifest contract passed")
