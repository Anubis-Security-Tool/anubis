# Device Web passwords

The authenticated management dashboard offers **Web password settings** for
each approved device, including offline devices. Inventory must be freshly
loaded and the full device fingerprint must still match. This is separate from
the management API administrator token, Windows credentials and native
application profile passwords.

Set a unique Web administrator password of at least 16 characters, containing
uppercase, lowercase, number and symbol. Common defaults are rejected by the
server. The dashboard clears the input after submission. Saving uses a revision
check to avoid overwriting another administrator's update and invalidates only
that device's Web administrator sessions. User sessions, enrollment approval
and scoped MCP grants remain unchanged.

**Reveal current Web administrator password** requires an explicit confirmation.
It is returned only over the authenticated management API with `no-store`,
shown for 15 seconds, and cleared on closing settings, stale inventory,
identity/revocation changes or management sign-out. It is not put into links,
localStorage or sessionStorage. Treat an on-screen reveal as a secret; do not
capture or share it.

On the device page choose **User** (default) or **Administrator**. Both refer
to Anubis Web roles in the separate SYSTEM Web workspace, not the account of
the person running the ordinary Desktop application. User sign-in uses a
device-local, protected `web-user-password.txt` in the owning application
profile directory. A compatible local verifier generates a unique initial
password and rereads authorized local edits on each login. This panel cannot
read, write or reset that file and does not claim an old native password export
already implements live file verification.

Administrator sign-in verifies the configured server credential, then requires
the matching App's protected, session-bound role issuance. If that adapter is
missing or refuses the request, sign-in fails; the management token, device
approval and password configuration do not bypass native authorization or DPAPI.
Only the Web administrator may explicitly select policy-authorized additional
Windows workspaces. Such selection discards the SYSTEM token; the selected
profile retains its own application authentication and encrypted data.

The server stores a scrypt verifier and AES-256-GCM-encrypted administrator
password under an independent private server key. See the managed-access SDK
README for exact API, file permissions and private adapter protocol. The User
file and native Windows/profile passwords are not stored in management.

This is a source-only integration change. It needs the matching gateway, App
adapter and dashboard release. The management service caches HTML/CSP at
startup; changing a disk HTML file alone does not update a running service.
Deployment, restart/session impact and rollback require a separate reviewed
release plan. Project: https://github.com/Anubis-Security-Tool.
