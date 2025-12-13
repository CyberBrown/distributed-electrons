# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainers directly or use GitHub's private vulnerability reporting feature
3. Provide a detailed description of the vulnerability
4. Include steps to reproduce if possible

## Security Best Practices

When using this project:

### Environment Variables

- Never commit `.env` files to version control
- Use `.env.example` as a template and create your own `.env` locally
- Rotate API tokens regularly
- Use tokens with minimal required permissions

### Cloudflare API Tokens

Create tokens with only the permissions needed:
- Zone: DNS (Edit) - for DNS record management
- Zone: Zone (Read) - for zone information
- Account: Cloudflare Pages (Edit) - for Pages deployments
- Account: Workers Scripts (Edit) - for Worker deployments

### Deployment

- Review all configuration before deploying to production
- Use separate API tokens for development and production
- Enable Cloudflare's security features (WAF, rate limiting, etc.)

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Security Updates

Security updates will be released as soon as possible after a vulnerability is confirmed.
