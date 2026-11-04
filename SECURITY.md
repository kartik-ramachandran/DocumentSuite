# Security

## Reporting a vulnerability

Please report vulnerabilities privately through this repository's **Security** tab, using **Report a vulnerability**, rather than opening a public issue.

Include the steps to reproduce the problem and what an attacker could do with it.

## Before you deploy

This service processes untrusted documents using large native tools. **Don't expose it to the internet as it stands.** Run it behind your own gateway, on a private network.

| Area | Current behaviour | What to do |
|---|---|---|
| Authentication | The REST API has none. `/mcp` requires an API key | Put the API behind an authenticating gateway |
| Viewer settings | Anyone can read them, and writes need `Settings__WriteKey` outside development. The compose file runs in development, so it accepts writes with no key | Set the key, and don't store secrets in settings |
| Rate limits | None, and each conversion can use a lot of CPU and memory | Limit requests per client at your gateway, and set container CPU and memory limits |
| Container user | Runs as root | Run it with a non-root user and a read-only filesystem where you can |
| HTML to PDF | Chrome renders uploaded HTML with its sandbox off, which could expose local files or internal network addresses | Isolate the container and restrict its outbound network access, or disable these routes at your gateway |
| CORS | Allows any origin | Restrict it to your own sites in `Program.cs` |
| Viewer documents | Stored temporarily, and protected only by a long random ID | Serve over HTTPS, and don't log request URLs |
| MCP workspace | Everyone with the key shares one folder | Use a separate instance and key for each group of users |
| Swagger UI | Available at `/swagger` in every environment | Disable or restrict it in production |

Other limits worth knowing:

- Redaction can't detect text inside pictures on pages that also have a normal text layer. Check those pages by eye.
- Crop hides content but leaves it in the file.
- Image stamps are visual only, and aren't cryptographic signatures.
