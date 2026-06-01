## Foundation Artifacts

These files are the checked-in canonical artifacts for the current GoodVibes Agent foundation.

- `operator-contract.json` — typed operator/client contract manifest filtered to Agent-relevant routes
- `peer-contract.json` — node-host / peer contract manifest
- `knowledge-graphql.graphql` — canonical knowledge GraphQL schema text
- `knowledge-store.sql` — canonical knowledge SQL schema

Regenerate them with:

```bash
bun run foundation:artifacts
```

The release-gate tests fail if these artifacts drift from the current source.
