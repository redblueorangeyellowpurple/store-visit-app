# Staged for deletion — Weekly "Store Updates" section (removed 2026-06-11)

Wilson removed the 🏪 Store Updates section (store cards + photo-history drawer)
from the dashboard Weekly report. These two files became orphans — nothing
imports or calls them anymore:

- `StorePhotosDrawer.tsx` — was `dashboard/src/components/StorePhotosDrawer.tsx`;
  only consumer was the removed WeeklyView section.
- `stores-id-photos-route.ts` — was `dashboard/src/app/api/stores/[id]/photos/route.ts`
  (`GET` photos grouped by ISO week, signed URLs); only consumer was the drawer.

NOT related: the top-nav "Store Updates" tab (`/visits` page) — that stays.
Per-photo comments still work via `/api/photos/[id]/*` + `FeedPhotoLightbox` on `/visits`.

Safe to `rm -rf` this folder once confirmed nothing misses it (it's also in git
history at commit 48184bc and earlier if it ever needs to come back).
