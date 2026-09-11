# Read-only Attachment Content Specification

## Purpose

Allow MCP clients and models to explicitly read supported Planka card attachments without adding
attachment mutations, exposing Planka credentials, or automatically loading file contents with card
details.

## Requirements

### Requirement: Discoverable attachment resources

The server SHALL add a stable `planka-attachment://{cardId}/{attachmentId}` URI to file attachment
metadata and advertise the corresponding MCP resource template.

#### Scenario: File attachment metadata

- **WHEN** card details include a file attachment
- **THEN** its metadata includes a resource URI containing its card and attachment identifiers

#### Scenario: Link attachment metadata

- **WHEN** card details include a link attachment
- **THEN** its resource URI is null and the server does not fetch the target URL

### Requirement: Explicit read-only access

The server SHALL expose an idempotent read-only attachment tool and `resources/read` callback backed
by the same loader.

#### Scenario: Read a supported file

- **WHEN** the caller supplies a card identifier and an attachment identifier belonging to that card
- **THEN** the server returns UTF-8 text or a base64 blob with the declared MIME type

#### Scenario: Attachment does not belong to the card

- **WHEN** the attachment is absent from the fresh card response
- **THEN** the server rejects the request without downloading a URL

### Requirement: Bounded content transfer

The server SHALL allow only documented MIME types and enforce both metadata and streamed byte limits.

#### Scenario: Oversized content

- **WHEN** metadata, Content-Length, or streamed bytes exceed the MIME-specific limit
- **THEN** the server aborts the read and returns an error without emitting truncated content

#### Scenario: MIME mismatch

- **WHEN** a non-generic HTTP Content-Type differs from attachment metadata
- **THEN** the server rejects the response

### Requirement: Constrained download destinations

The server SHALL fetch only the current file URL returned by Planka from the Planka origin or an
explicitly configured HTTPS origin, and SHALL reject redirects.

#### Scenario: Planka-hosted attachment

- **WHEN** the URL uses the configured Planka origin and expected attachment download path
- **THEN** the server sends the configured Planka download credentials

#### Scenario: Allowlisted object storage

- **WHEN** the URL uses an explicitly allowlisted HTTPS origin
- **THEN** the server downloads it without sending Planka credentials

#### Scenario: Unapproved destination or redirect

- **WHEN** the URL uses another origin, an unexpected Planka path, or returns a redirect
- **THEN** the server rejects the download

### Requirement: Planka v2 authentication

The server SHALL prefer `PLANKA_API_KEY` when configured and preserve email/password JWT fallback.

#### Scenario: User API key

- **WHEN** `PLANKA_API_KEY` is set
- **THEN** API and same-origin download requests use `X-Api-Key` without a login request

#### Scenario: JWT fallback

- **WHEN** no API key is set and valid agent credentials are configured
- **THEN** API requests use Bearer authentication and attachment downloads use the `accessToken`
  cookie
