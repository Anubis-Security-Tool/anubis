# Password-based Web access

Open an approved computer's `https://device-<id>.anubis.locker/` address directly.
The address identifies the computer; it does not authorize access.

Choose **User** or **Administrator** on the sign-in form. These are Anubis Web
access roles, not Windows accounts, desktop profile passwords, management
administrator tokens or MCP credentials.
The SYSTEM service must be running and its managed identity must have been
approved. The gateway does not need an administrator navigation ticket for password
sign-in.

Each local managed profile creates its own random initial user password in
`web-user-password.txt` inside its application user-data directory. For the
machine SYSTEM profile, the default location is
`C:\ProgramData\Anubis\Host\AnubisHost\system-profile\anubis\web-user-password.txt`.
An OS-authorized local user can edit this UTF-8 file: use one line containing
12 to 4096 characters. File edits apply to subsequent logins without restarting
the application. The password is not uploaded to the management server. There
is no shared factory password for all computers.

The separate Web administrator password is configured in the authenticated
management dashboard for each device. The controller stores it encrypted and
keeps a salted verification hash. Explicit reveal is administrator-only.
Changing it revokes that device's administrator browser sessions.

These operations do not change Windows passwords, native profile password
hashes, storage keys or DPAPI data. Native desktop profile password changes
remain local OS-authorized operations with old-password verification.

The browser receives a host-only Secure, HttpOnly, SameSite cookie. Reloading
keeps the login; the default session lifetime is eight hours. **Sign out**
revokes the browser session and closes its active connections. Process restarts,
password changes, expiry and device revocation can require another sign-in.
Do not treat successful short checks as proof of uninterrupted long-term access.

When explicitly switching Windows workspaces, the selected profile keeps its own
password and encrypted data. Unavailable sessions are not silently substituted.
MCP authorization is a separate scoped mechanism and is not changed by browser
password login.

## Menu appearance

Sidebar, tab/menu surfaces and Windows workspace controls use the active
application theme's `main`, `main-light`, `text`, `primary` and border variables.
They do not impose a separate black palette. Windows native caption controls
prefer the same `main` background. Custom backgrounds and the supplied artwork
are unchanged.
