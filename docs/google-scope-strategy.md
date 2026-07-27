# Which Google scopes to request, and why

Verified against Google's live documentation on 2026-07-26. Every classification below carries the source it came from.

## The model this assumes

**Each user creates their own OAuth client in their own Google Cloud account.** Nothing is shipped with the product — no client id, no client secret, no project. The agent automates the clicking; the credentials belong to the person who made them.

That single fact removes most of the usual OAuth burden:

- **No Google verification is required.** Verification exists so Google can vouch for an app to *other people's* users. When you are the author and the sole user, there is nobody to vouch to. You click through the "Google hasn't verified this app" screen once and that is the end of it.
- **The 100-user cap is irrelevant.** It caps unverified apps at 100 users; a personal app has one.
- **No third-party security assessment.** That obligation attaches to published apps requesting restricted scopes, not to a personal client.

What does *not* go away is the publishing-status trap. See below — it is the single most consequential detail in the whole flow.

## The trap: Testing publishing status expires credentials in 7 days

> "A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of 'Testing' is issued a refresh token expiring in 7 days"
> — [OAuth 2.0 guide](https://developers.google.com/identity/protocols/oauth2)

The documented exemption covers apps requesting only `openid`, `email` and `profile`. Calendar and Gmail scopes are not exempt.

So an app left in **Testing** works perfectly for a week and then dies, and the failure surfaces as an ordinary-looking auth error a week after anyone last touched the setup. Publishing status must be moved to **In production**, which is self-certified and immediate — it is *not* the same thing as verification, and it needs no review.

The flow therefore treats this as a first-class step: it sets the status, then **re-reads it to confirm** rather than assuming the click worked, and reports a plain-language warning if it cannot confirm.

## Scope classification, and why it still matters

Google splits scopes into non-sensitive, sensitive, and restricted ([restricted scope list](https://support.google.com/cloud/answer/13464325)).

| Scope | Tier |
| --- | --- |
| `gmail.send` | sensitive |
| `gmail.readonly` | **restricted** |
| `gmail.modify` | **restricted** |
| `gmail.metadata` | **restricted** |
| `gmail.compose` | **restricted** |
| `https://mail.google.com/` | **restricted** |
| `calendar` (full) | sensitive |
| `calendar.events` | sensitive |
| `calendar.readonly` | sensitive |
| `calendar.events.readonly` | sensitive |

Two facts worth knowing:

- **`gmail.send` is sensitive, not restricted.** Google says so directly: *"gmail.send is a sensitive scope. Projects requesting only sensitive scopes do not need to undergo a third-party security assessment"* ([source](https://support.google.com/cloud/answer/13807380)). Sending is cheap; *reading* mail through the Gmail API is the expensive tier.
- **No Calendar scope is restricted.** The word "Calendar" does not appear on Google's restricted-scope page at all.

For a personal app the tier does not create a fee. It still shapes the request, because the narrowest scope that does the job is the right one regardless — it limits blast radius if the credential leaks, and it keeps the consent screen honest about what the agent can reach.

## What this integration requests

**`https://www.googleapis.com/auth/calendar.events` — and nothing else.**

| Capability | How | OAuth scope needed |
| --- | --- | --- |
| Read and search mail | IMAP + app password | none |
| Send mail | SMTP + app password | none |
| Read calendar | `calendar.events` | sensitive |
| Write calendar | `calendar.events` | sensitive |

Mail runs over IMAP/SMTP with an app password, which is not an OAuth grant at all — no project, no client, no consent screen, no publishing status, and nothing that expires. OAuth is used only for the one thing an app password genuinely cannot do, which is reach the calendar.

`calendar.events` rather than full `calendar` because it grants event read and write without also granting calendar-list management. Both are sensitive, so nothing is gained by the wider one.

A test in `src/test/agent/google/google-setup-flow.test.ts` fails the build if a restricted Gmail scope is ever added to the requested set, so this cannot drift silently.

### What is given up

Compared with requesting `gmail.readonly`:

- **Gmail push/watch channels.** IMAP IDLE gives near-real-time arrival but holds a connection open and is not the same mechanism.
- **Gmail's `q=` search syntax.** IMAP search is weaker — no `category:`, no relevance ranking.
- **Label semantics.** IMAP sees folders, not Gmail's overlapping labels.

If push notification later proves essential, that is a deliberate decision to revisit — not a scope to add quietly.

## Why Google Calendar is read-only on the app-password path

Google refuses HTTP Basic authentication on its CalDAV endpoint:

> "The CalDAV server refuses to authenticate a request unless it arrives over HTTPS with OAuth 2.0 authentication of a Google Account. Attempting to connect over HTTP or using Basic Authentication results in an HTTP `401 Unauthorized` status code."
> — [CalDAV v2 guide](https://developers.google.com/workspace/calendar/caldav/v2/guide)

Confirmed by direct probe: a `PROPFIND` with Basic credentials against `apidata.googleusercontent.com/caldav/v2/...` returns `401` and offers no `WWW-Authenticate: Basic` challenge.

So an app password cannot reach Google Calendar over CalDAV, however it is configured. The app-password path uses the **private iCal address** instead, which needs no credential setup and is read-only. Calendar *writes* are the reason the OAuth path exists.

The CalDAV client in this codebase is still real and still used — it speaks Basic auth for providers that permit it (Fastmail, iCloud, Nextcloud) and Bearer auth for those that require OAuth. It is only Google-plus-app-password that is impossible.

## Shipping a client secret: not applicable here, but worth recording

Google's documentation says embedding a Desktop client's secret in a distributed app is expected — *"the client secret is obviously not treated as a secret"* ([OAuth 2.0 guide](https://developers.google.com/identity/protocols/oauth2)) — and RFC 8252 §8.5 agrees. Its §6 also states that public native clients **MUST** implement PKCE, which this implementation does.

That guidance would matter if the product shipped one shared client. It does not. Each user's secret is theirs, is stored only in their encrypted secret store, and is never compiled into anything.
