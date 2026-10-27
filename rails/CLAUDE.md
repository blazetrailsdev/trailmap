# trailmap (Rails) — Claude guide

The parent directory's CLAUDE.md applies here too, and its section "`rails/`
is the same site in Rails" says what this app is for: proving that trails
and Rails are similar, that both work, and that they are compatible. They must
produce the same outputs and share solid_queue jobs, bcrypt digests, encrypted
columns and MessagePack payloads.

- Rails 8.0.2 and Ruby 3.3. Write idiomatic Rails, and do not copy a trails
  workaround across.
- Each TypeScript file has one Ruby counterpart, named the Rails way
  (`app/models/concerns/repo-scope.ts` → `app/models/concerns/repo_scope.rb`).
- When the two apps have to differ, add an entry to `DEVIATIONS.md`.
- Run the tests with `bin/rails test`.
