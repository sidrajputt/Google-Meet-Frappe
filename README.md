# Google Meet for Frappe CRM

Schedule meetings from **Frappe CRM** with a **Google Meet** link and **Google Calendar**
invitations. Installs like any other Frappe app - **no changes to the CRM's own code**.

The app is called `crm_meetings`. Sales teams get a Google-Calendar-style scheduler inside the
CRM; admins connect Google once, and nobody else ever signs in to Google.

## What you get

- **Schedule from the CRM.** A **Meetings** button on the Leads and Deals list pages opens a
  calendar with Agenda, Month, Week and Day views. **Schedule Meeting** on a Lead or Deal creates
  the meeting for that record.
- **Google Meet + Google Calendar.** The meeting is created on the company calendar with a Meet
  link. Guests receive a Google invitation and see it in their own calendar.
- **Guests you choose.** Like Google Calendar's "Add guests": CRM team members, contacts, or any
  email address. The Lead's contact, you and the record owner are pre-selected.
- **You decide who is notified.** Send invitations or not when you schedule, change or cancel. A
  **Notify guests** button sends a note (email and/or CRM notification) whenever you want.
- **Edit, reschedule, cancel.** Changes go straight to Google Calendar and the guests.
- **Reminders.** In-app CRM notifications and email shortly before a meeting starts (30 minutes by
  default, optionally also a day before).
- **On the Lead / Deal timeline.** Every meeting, reschedule and cancellation is posted as a
  comment, with the Meet link.
- **Dashboard.** "Meetings today", "Meetings in the next 7 days", "Meetings", "Meetings by day" and
  "Meetings by status" on the CRM dashboard.
- **"Next Meeting" column** you can add to the Leads and Deals lists.
- **Permissions.** Managers see every meeting. Sales users see only meetings they created or were
  invited to. Only the organizer (or a manager) can edit or cancel.
- **Not only Google.** A **Manual link** provider takes any Zoom / Teams / other URL and invites
  guests by email with a calendar file. Zoom and Microsoft Teams providers can be plugged in - see
  [docs/ADDING_A_PROVIDER.md](docs/ADDING_A_PROVIDER.md).

## Requirements

- A Frappe bench with **Frappe CRM** installed on the site.
- Google's Python libraries (already part of Frappe).
- For Google Meet: a Google Cloud OAuth client (see the admin guide).
- For email reminders: an outgoing Email Account on the site, and the scheduler enabled.

| Frappe | Frappe CRM |
|---|---|
| v15 | 1.x (the `main` branch) |
| v16 / v17 (develop) | 2.0 (develop) |

Built and tested against Frappe 17 (develop) with Frappe CRM 2.0 (develop). Support for Frappe v15
with CRM 1.x was added by checking the code against those sources; it has not been run on a v15
bench yet, so run the tests (see "Development") after installing. Other combinations have not been
tested - see "Compatibility" below.

## Install

From your bench directory:

```bash
bench get-app <git url or path of this folder>
bench --site your-site.com install-app crm_meetings
bench restart
```

`get-app` needs a git repository (a URL, or the path of this folder, which is one). If the assets
were not linked, run `bench build --app crm_meetings`.

The install sets everything up by itself - see "What the install sets up".

## First-time setup (admin, about 10 minutes)

Open **CRM Meetings Settings** in Desk (search for it). It shows a live checklist of what is
connected and what is missing, the exact redirect URI for your site, and a **Test Google
connection** button. The full walk-through is in [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md).

## Using it

| You want to | Do this |
|---|---|
| See all meetings | On the Leads or Deals list, click **Meetings** |
| Schedule for a Lead / Deal | Open it and use **Schedule Meeting** (or **New Meeting** on the **Meetings** tab if your CRM has one) |
| Change or cancel | Open the meeting, then **Edit** or **Cancel meeting** |
| Tell guests something | Open the meeting, then **Notify guests** |
| See it on a dashboard | CRM Dashboard, add the Meetings charts (already added on install) |

## Who sees what

| Role | Can see | Can edit / cancel |
|---|---|---|
| System Manager, Sales Manager, Administrator | Every meeting | Every meeting |
| Sales User | Meetings they created, organize, or were invited to as a team member | Only their own |

Sales users can only schedule on Leads and Deals they are allowed to see in the CRM.

## What the install sets up

All steps are safe to repeat (they run on every migrate) and never overwrite what an admin changed.

- **CRM Meetings Settings** with sensible defaults. If exactly one Google Calendar is connected, it is
  selected automatically.
- **CRM scripts** that add the buttons to the Lead, Deal, Leads-list and Deals-list pages.
- A read-only **Next Meeting** field on Leads and Deals.
- **Dashboard charts**, added to the default CRM dashboard once.
- A **scheduler job** (every 5 minutes) for reminders.
- Meetings made by version 0.0.1 of this app are upgraded automatically.

Uninstalling removes the scripts, the Next Meeting field, the dashboard charts and the quick-entry
layout.

## Compatibility

- The buttons rely on CRM's *Form Script* feature (Form and List scripts).
- The dashboard charts are declared in this app's `crm_dashboard_charts` hook (CRM 2.0's own
  extension hook). CRM 1.x, which is what Frappe v15 runs, has no such hook, so the app fills the
  charts in itself. The charts are added to the default dashboard on install. CRM 1.x's "add
  chart" dialog is built around its own charts, so do not count on adding a removed Meetings chart
  back from the CRM UI.
- CRM's own `get_dashboard` does not fill in contributed charts, so this app wraps that method to
  do it (`override_whitelisted_methods`).
- CRM 1.x notifications have no "Automation" type, so reminders and cancellations use "Assignment".
- If your CRM has its own Meetings tab, switch off **Show a "Schedule Meeting" button on Lead and
  Deal pages** in the settings.

## Development

```bash
bench --site your-site.com set-config allow_tests true
bench --site your-site.com run-tests --app crm_meetings
bench --site your-site.com set-config allow_tests false
```

Tests run in transactions that are rolled back and do not seed sample data into the site. Layout:

```
crm_meetings/
  api.py              whitelisted API used by the UI
  providers/          Google Meet, Manual link, Zoom / Teams placeholders
  notifications.py    in-app notifications, emails, reminders
  permissions.py      who sees what
  dashboard.py        CRM dashboard charts
  install.py          everything set up on install / migrate
  public/             the meetings UI (Vue, no build step) and bridge.js
  meetings/doctype/   CRM Meeting, CRM Meeting Attendee, CRM Meetings Settings
```

## License

MIT
