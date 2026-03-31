

# SENTINEL Patrol Intelligence — Build Progress & Next Steps

## Current State Assessment

The system has a solid foundation with the following already built:

**Completed:**
- Authentication (Login, Signup, Forgot/Reset Password, Protected Routes)
- RBAC with admin/supervisor/guard roles (database + UI sidebar filtering)
- Dashboard (Command Center) with stat cards, live map, alerts feed, activity feed, AI insights card
- Guard Management (list, create, detail page with performance charts, scan logs, patrol timeline)
- Patrol Management (list, create, assign guards)
- Incident Management (create, filter, search, resolve/reopen, AI classification display)
- Device Management (list view with battery/connectivity status)
- AI Insights page (severity/type charts, guard rankings, run analysis)
- Reports page (generate AI reports, expandable report cards with stats/sections/recommendations)
- Profile page (edit name, phone, avatar)
- Settings page (company config, user role management, notification preferences, password change)
- Notification Center (popover with mark-read, real-time toast alerts)
- Real-time subscriptions (alerts, scans, incidents, patrols, guards, devices)
- Edge Functions: patrol-analysis and generate-report (both using Lovable AI)
- Multi-tenant RLS on all tables
- Dark cyberpunk theme with glass-card design

## What's Missing / Should Be Built Next

Based on the project memories (NFC patrol system, scalability, security compliance) and gaps in the current codebase, here is the prioritized plan:

---

### Step 1: Seed Demo Data
The dashboard is functional but likely empty. Seed guards, checkpoints, patrols, scan logs, alerts, incidents, and devices for the demo company so the UI looks populated and testable.

- Insert 5-6 guards, 8-10 checkpoints, 4-5 patrols (mixed statuses), 20+ scan logs, 5-6 alerts (mixed severity), 3-4 incidents, and 3 devices into the demo company (`a0000000-...0001`)
- Use a single database migration

### Step 2: Checkpoint Management UI
Checkpoints exist in the database and are shown on the map, but there is no page to manage them (create, edit, delete, assign NFC tag IDs). Add a Checkpoints page accessible to admins/supervisors.

- New page: `src/pages/Checkpoints.tsx`
- Add route to `App.tsx`
- Add sidebar nav item with `minRole: ["admin", "supervisor"]`
- CRUD: list checkpoints, create with name/NFC tag ID/location/patrol assignment, edit, delete

### Step 3: Patrol Status Actions
Patrols can be created but not started, completed, or marked as missed from the UI. Add action buttons on patrol cards.

- Start Patrol: set `status = "in_progress"`, `started_at = now()`
- Complete Patrol: set `status = "completed"`, `completed_at = now()`
- Cancel/Miss: set `status = "missed"`
- Only show actions to admin/supervisor roles

### Step 4: Guard Activation/Deactivation Toggle
The Guards page shows active/inactive status but provides no way to toggle it. Add an activate/deactivate action on the guard detail page.

- Toggle button on `GuardDetail.tsx`
- Update `is_active` field via Supabase

### Step 5: Dashboard Activity Feed — Real Data
The `ActivityFeed` component likely shows placeholder data. Wire it to show the most recent scan logs and patrol updates.

- Query recent scan logs and patrol status changes
- Display as a unified timeline

---

### Technical Details

**Step 1 — Migration SQL:**
A single migration inserting demo data across guards, checkpoints, patrols, scan_logs, alerts, incidents, and devices tables, all referencing `company_id = 'a0000000-0000-0000-0000-000000000001'`.

**Step 2 — New files:**
- `src/pages/Checkpoints.tsx` — Full CRUD page following Guards page pattern
- Update `src/App.tsx` — Add `/checkpoints` route
- Update `src/components/layout/AppSidebar.tsx` — Add nav item

**Step 3 — Modified files:**
- `src/pages/Patrols.tsx` — Add start/complete/miss buttons with Supabase mutations

**Step 4 — Modified files:**
- `src/pages/GuardDetail.tsx` — Add toggle button for `is_active`

**Step 5 — Modified files:**
- `src/components/dashboard/ActivityFeed.tsx` — Replace mock data with real scan_logs + patrols query

