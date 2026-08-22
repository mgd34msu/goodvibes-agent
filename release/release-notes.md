- **Fixed: the daemon installed alongside this Agent is current again.** The daemon dependency moves from 1.28.19 to 1.28.22, so an Agent install no longer carries a daemon three platform releases behind the Agent's own runtime pin.
- Changed: the bundled daemon's daily spending budget now survives restarts, persisting reservations and commits atomically and reloading them at boot instead of forgetting the day's spend.
- Changed: approving a purchase through the bundled daemon is now a real recorded act: a single-use, content-bound owner approval with a five-minute lifetime that checkout entry spends or refuses without.
- Changed: the bundled daemon journals every in-flight checkout phase to disk before proceeding, so a crash mid-checkout leaves a record instead of nothing.
- Changed: at boot the bundled daemon now discloses checkouts interrupted by a crash, settling each by its journaled phase instead of forgetting it. 2.0.17 shipped hours earlier with the stale daemon pin; this release corrects it and changes nothing else.

GoodVibes Agent 2.0.18 - 2026-08-21
