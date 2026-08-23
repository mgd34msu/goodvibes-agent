- **Fixed: an error that is not the model's fault no longer blames the model.** Platform runtime 2.0.23 inside: failure hints name the part that actually failed, so a network, auth, or configuration problem stops sending you to check the model or its key.
- Changed: calendar authentication reports its real state (platform runtime 2.0.23). A calendar connection that cannot actually serve requests shows as broken instead of green, so it is visible before a scheduled action trips over it.
- Changed: a provider's authentication status now folds its routes into one aggregate, so whether a provider can serve requests is answered in one place instead of read off scattered per-route states.
- Changed: catalog providers that publish no routes get routes derived from their environment configuration, so a provider configured only through env variables works instead of sitting invisible.
- Changed: the reasoning-effort setting (`provider.reasoningEffort`) is now served whole by the pinned platform: the level persists across sessions, setting it to null clears it, and the offered options follow the selected model.
- Changed: the bundled daemon moves to 1.28.25, carrying the same platform runtime 2.0.23.
- Changed: a repo-wide prose cleanup rewrites decorative punctuation and filler in comments, docs, and UI text; no behavior change.

GoodVibes Agent 2.0.21 - 2026-08-23
