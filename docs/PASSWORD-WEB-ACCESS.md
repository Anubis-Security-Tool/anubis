# Password-based Web access

Open an approved computer's `https://device-<id>.anubis.locker/` address directly.
The address identifies the computer; it does not authorize access.

Sign in with the **application password for the SYSTEM workspace**. It is not
your Windows password, management administrator token or an MCP credential.
The SYSTEM service must be running and its managed identity must have been
approved. The gateway does not need an administrator navigation ticket for
ordinary password sign-in.

An unset password is not accepted as remote authentication. Configure the
workspace password from the local Windows desktop's native SYSTEM password
settings. Initial setup is permitted only when the password is truly unset;
changing an existing password requires the old password and local OS-authorized
native admission. No remote password-reset or password-retrieval API is added.

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
