# Hosting spike: AdSense vs Vercel Hobby ($0 constraint)

**Status: DECISION REQUIRED FROM USER — touches deployment + money (human gate).**
Blocks Task 3B.3 *activation* (not the code, which is built host-agnostic).

## The conflict

The locked product decision is a free, **ad-supported** reference database
(AdSense on public pages). Vercel's **Hobby plan prohibits commercial use**,
and Vercel support has confirmed ad-based monetization (AdSense) is not allowed
on Hobby deployments — running ads there violates the ToS and risks the project
being suspended. The site currently deploys on Vercel Hobby (free). So "free
site + AdSense + $0 hosting on Vercel" is not a legal combination.

## Options

| Option | $/mo | Commercial OK | Migration effort | Notes |
| --- | --- | --- | --- | --- |
| **A. Vercel Pro** | $20/seat | yes | none | Simplest; breaks the hard $0 constraint. Everything keeps working as-is. |
| **B. Cloudflare Pages/Workers** | $0 | yes (free tier permits commercial) | medium | Next.js 16 App Router via `@opennextjs/cloudflare`. API routes + Supabase SSR must run on the Workers runtime; the daily data GitHub Action is unaffected. Generous free tier. |
| **C. Netlify free** | $0 | yes | medium | Next.js adapter; similar migration shape to B. |
| **D. Keep Vercel Hobby, ship NO ads in v1** | $0 | n/a | none | Defer monetization; revisit when there's revenue to justify Pro. Member subscriptions (the real product) still work. |
| **E. Split: static public site on Cloudflare Pages (ads) + member app stays on Vercel** | $0 | partial | high | Two deploys, shared data, CORS on the API. Over-engineered for now. |

## Recommendation

**Short term: Option D (ship without ads), build the AdSense code now but keep
it behind a disabled flag.** Rationale: the member subscription is the actual
revenue model; AdSense on a pre-launch reference site earns ~nothing yet, so
paying $20/mo (A) or eating a migration (B/C) to enable it now is premature.
The AdSense components (Task 3B.3) are built so that flipping
`NEXT_PUBLIC_ADS_ENABLED=true` activates them — but that flip must coincide
with a move to a commercial-permitted host.

**When ads are worth turning on: Option B (Cloudflare Pages).** It preserves
$0, permits commercial use, and the `@opennextjs/cloudflare` adapter handles
Next.js App Router. Budget ~1 milestone for the migration + edge-runtime audit
of the Supabase SSR/API code. Option A ($20/mo Vercel Pro) is the fallback if
the migration proves costly and the budget can flex.

## What this means for M3B

- 3B.1 / 3B.2 (telemetry intake, R2, BigQuery, referral) are **host-agnostic** —
  built and verifiable regardless of this decision.
- 3B.3 AdSense + consent components are **built but gated** behind
  `NEXT_PUBLIC_ADS_ENABLED` (default off). No ad script loads until both the
  flag is on AND consent is granted. Activation waits on the hosting decision.

Sources: [Vercel community: AdSense on Hobby](https://github.com/vercel/community/discussions/5126) · [Vercel pricing 2026](https://costbench.com/software/developer-tools/vercel/) · [@opennextjs/cloudflare](https://opennext.js.org/cloudflare)
