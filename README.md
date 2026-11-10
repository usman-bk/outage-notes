# outage-notes

_Built with AI assistance._

A public status page that has to keep working when the thing it reports on is down,
and that never says everything is fine just because it can't check.

Next.js 16 App Router with Cache Components, React 19, TypeScript, Tailwind CSS,
PostgreSQL. Jest covers the rules and real Postgres behaviour. Playwright runs
against the production build, with a proxy that can cut the database mid test.

```
src/lib/board.ts          the cached read, tagged and timed
src/lib/board-source.ts   live, last reading, or unknown
src/lib/store.ts          every SQL statement, including the version check
src/lib/domain.ts         status rollup, uptime, validation
src/app/admin/actions.ts  Server Actions, each checking the operator itself
src/components/forms.tsx  the operator forms
e2e/db-proxy.mjs          the switch that takes the database away
```

## Three answers, not two

A status page has one way to do real damage, which is to show green during an
outage. So a read has three outcomes:

| The database | A saved reading | The page says                                 |
| ------------ | --------------- | --------------------------------------------- |
| answers      |                 | the current status, and saves it to disk      |
| fails        | exists          | "Last confirmed: ...", in grey, with the time |
| fails        | none            | "We can't confirm the current status"         |

The third row is the reason this is not a try/catch returning an empty board. An
empty board has no incidents, and no incidents renders as all systems operational.

The saved reading goes through a temporary file and a rename, so a crash cannot
leave half a file to be read during the outage. It lives on disk rather than in
memory because restarting the app is a common response to an outage.

## The build must not answer

The first version cached a board during `next build`. The build has no database, so
it cached "unknown", shipped it, and every visitor saw it. Pointing the build at a
database is worse, since it bakes in whatever that database said on build day.

`getBoard` now awaits `connection()` first, which keeps the read out of the build.
Any later change that lets it back in fails the first browser test.

## Cached, but not streamed

The obvious Next.js shape is a static shell with the status streamed into a
`<Suspense>` boundary. Streamed content needs JavaScript to appear, and someone
checking a status page in the middle of an outage might be on anything. `/` and
`/history` block instead, with `instant = false`, so the first byte of the HTML
already contains the status. A test loads them with JavaScript off.

The data is still cached. Thirty visitors cost one read. Publishing calls
`updateTag`, so the next visitor waits for fresh data rather than getting the old
page, and that happens only after the commit, because invalidating earlier lets a
reader put the old row straight back. The timer on the cache is there to notice a
database that has come back.

## Two operators, one incident

Incidents get several hands on them at the worst moment. The form carries the
version it was loaded with:

```sql
UPDATE incidents SET status = $1, ..., version = version + 1
WHERE id = $2 AND version = $3
```

Under `READ COMMITTED` the second writer waits on the row lock, re-evaluates the
`WHERE` against what the first one wrote, matches nothing, and gets told. It sees
what the other person posted, and its own text stays in the box. `lets exactly one
of two truly simultaneous posts win` holds both behind a lock until Postgres reports
both waiting, so they really collide, and CI removes the version check on every push
to confirm that test fails.

A retry of a post that already landed also misses on version, and must not be
reported as a clash, so a unique `submission_id` tells the two apart.

## A select that lies

React resets a form after its action runs. A controlled `<select>` then shows its
first option while state still holds the real choice, so after a refused post the
menu read "Investigating" and pressing again would have published that. The forms
submit from `onSubmit` to avoid the reset. The `action` prop stays so that a press
before hydration is a POST, and not a GET with the password in the URL.

## A Server Action is a public endpoint

`proxy.ts` redirects people with no cookie and does nothing else. Every action checks
the operator against the database, because an action is a POST that anyone can send.
One test captures the real request and replays the same bytes with no session, then
with a forged cookie, which gets past `proxy.ts`, and nothing changes. It then sends them
with a real session and they post, otherwise the first two would prove nothing.

The token only says who you are. Removing an operator takes effect on their next
click.

## Uptime that can't flatter itself

Two incidents overlapping for an hour are one hour down, so outages are merged first.
Only major outages count against the number, and a degraded day shows on the bars
without lowering it. The percentage rounds down, so one minute down in ninety days
reads 99.99 and not 100.00, which would contradict the incident list beneath it. A
component added last week is measured from last week.

Times are stored as instants and shown in UTC in the HTML. Once React is running they
change to the reader's own zone, through `useSyncExternalStore`, so hydration does not
disagree with the server.

## Where it stops

- One instance. The cache is in memory and the saved reading is on local disk. More
  than one replica would need a shared `cacheHandlers` entry and shared storage.
- It reports what operators post. It does not monitor anything by itself.
- No email or SMS subscriptions, only an Atom feed and a JSON endpoint.
- Operators are created by the seed script. There is no screen for it.
- The login limit is per email, so someone who knows an address can lock it for 15
  minutes.
- A read that started before a commit could finish after the invalidation. The
  revalidation timer bounds how long that could last. It is not separately tested.

## Running it

Needs Node 24 and PostgreSQL.

    createdb outage_notes
    export DATABASE_URL=postgres://localhost:5432/outage_notes
    export SESSION_SECRET=$(openssl rand -hex 32)
    export COOKIE_SECURE=false
    npm ci
    npm run migrate
    npm run seed
    npm run build
    npm start

Open http://localhost:3000 and sign in from the footer as `mina@example.com` or
`tomas@example.com`, password `demo-password`. Two browsers on one incident shows the
clash.

## Tests

    npm test           # Jest, creates a database named outage_notes_test
    npm run build
    npm run test:e2e   # Playwright, creates a database named outage_notes_e2e_test

`scripts/test-db.mjs` refuses any database name that does not end in `_test`.
