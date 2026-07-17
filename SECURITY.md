# Security Policy

## Supported Versions

Security fixes are accepted on the default branch. Tagged releases may receive
backports when they are still actively maintained by CamThink.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability. Report it to
the CamThink maintainers through the organization's private security contact or
the GitHub security advisory flow.

Include:

- Affected component and version or commit
- Reproduction steps
- Expected impact
- Any relevant logs with secrets removed

## Secret Handling

Do not commit credentials, tokens, private keys, customer data, device-specific
configuration, proprietary model files, or vendor SDK archives. Runtime secrets
must be supplied through environment variables, deployment tooling, or
gitignored local configuration.
